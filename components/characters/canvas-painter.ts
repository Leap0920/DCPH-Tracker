/**
 * Canvas painter for the character graph.
 *
 * This is the Obsidian approach: the graph is pixels, not DOM. One <canvas>
 * replaces ~2,350 retained SVG elements, so the browser does no per-node layout,
 * no per-node style recalc and no per-node hit-test. Everything the SVG got from
 * CSS — hover rings, selection rings, dimming, labels, the dot grid — is
 * painted here in JS instead.
 *
 * The rule that makes this fast, and the thing the SVG version could not do:
 *
 *   IDLE COSTS NOTHING. `paint()` only runs when something actually changed
 *   (camera, drag, hover, selection, resize). There is no ambient rAF loop and
 *   no unconditional repaint. On the `low` tier nothing redraws between
 *   interactions at all, which is why an idle canvas graph parks completely.
 *
 * All drawing is kept separate from React state so a hover never re-renders the
 * component tree — it calls `requestPaint()` and the next frame repaints.
 */

import {
  Camera,
  clamp,
  effectiveDpr,
  labelOpacityFor,
  quadControl,
  toScreen,
  type HitCircle,
} from "./canvas-geometry";

export interface PaintedNode {
  index: number;
  /** Stable colour id resolved to a hex string up front. */
  primary: string;
  darkFill: string;
  lightFill: string;
  border: string;
  r: number;
  tier: 0 | 1 | 2;
  name: string;
  /** Sub-label (alias/role), skipped on the low tier. */
  sub?: string;
}

export interface PaintedEdge {
  index: number;
  color: string;
  /** Opacity 0..1 resolved by the caller from hover/search/dim state. */
  opacity: number;
  width: number;
}

export interface PaintPalette {
  bg0: string;
  bg1: string;
  dot: string;
  dotRadius: number;
  label: string;
  labelStrong: string;
  labelHalo: string;
  strokeStrong: string;
  /** Line-height-ish base font size in CSS px, before zoom. */
  fontSize: number;
}

export interface PaintOptions {
  cam: Camera;
  nodes: readonly PaintedNode[];
  edges: readonly PaintedEdge[];
  /** World endpoints per edge, interleaved [x,y] per edge. */
  edgeFrom: Float64Array;
  edgeTo: Float64Array;
  /**
   * World node positions, interleaved [x0,y0,x1,y1,...] — the same layout the
   * SVG renderer's `geom.base` uses, so node dragging and edge routing read one
   * buffer. Interleaved rather than split because every consumer already indexes
   * `i * 2` / `i * 2 + 1`, and a split pair invites exactly the bug where both
   * axes get handed the same array.
   */
  positions: Float64Array;
  /** Bow offset index per edge. */
  edgeOff: Float64Array;
  selectedIndex: number;
  hoveredIndex: number;
  /** Index set forced visible by an active search. */
  searchMatches: ReadonlySet<number> | null;
  /** Dim non-targets (a dossier is open or a search is active). */
  dimmed: boolean;
  labelLimit: 0 | 1 | null;
  dotGrid: boolean;
  viewport: { w: number; h: number };
}

/**
 * One full repaint. Returns the number of draw calls issued, which the tests
 * assert against — it is the cheapest proxy for "how much work did that frame
 * cost" without needing a device.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  o: PaintOptions,
  pal: PaintPalette
): number {
  let calls = 0;
  const { cam, viewport } = o;
  const k = cam.k || 1;

  ctx.save();
  ctx.clearRect(0, 0, viewport.w, viewport.h);
  calls++;

  /* ── backdrop: vertical gradient + optional dot grid ── */
  const grad = ctx.createLinearGradient(0, 0, 0, viewport.h);
  grad.addColorStop(0, pal.bg0);
  grad.addColorStop(1, pal.bg1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  calls++;

  if (o.dotGrid) {
    ctx.fillStyle = pal.dot;
    const step = 26;
    for (let y = step / 2; y < viewport.h; y += step) {
      for (let x = step / 2; x < viewport.w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, pal.dotRadius, 0, Math.PI * 2);
        ctx.fill();
        calls++;
      }
    }
  }

  /* ── camera transform ── */
  // Applied once, so every node/edge below is drawn in world coordinates and
  // the rasteriser does the projection. This is the single transform that makes
  // pan/zoom cheap: it is one setTransform, not 2,350 element updates.
  ctx.setTransform(k, 0, 0, k, cam.x, cam.y);

  // World-space viewport, used to cull before drawing.
  const minWX = -cam.x / k - 64;
  const maxWX = (viewport.w - cam.x) / k + 64;
  const minWY = -cam.y / k - 64;
  const maxWY = (viewport.h - cam.y) / k + 64;

  /* ── strings ── */
  ctx.lineCap = "round";
  for (const e of o.edges) {
    const sx = o.edgeFrom[e.index * 2];
    const sy = o.edgeFrom[e.index * 2 + 1];
    const tx = o.edgeTo[e.index * 2];
    const ty = o.edgeTo[e.index * 2 + 1];
    // Cull whole edges when both ends are off-screen: a shallow bow between two
    // off-screen points cannot re-enter the viewport on its own.
    const bothLeft = sx < minWX && tx < minWX;
    const bothRight = sx > maxWX && tx > maxWX;
    const bothAbove = sy < minWY && ty < minWY;
    const bothBelow = sy > maxWY && ty > maxWY;
    if (bothLeft || bothRight || bothAbove || bothBelow) continue;

    const ctrl = quadControl(sx, sy, tx, ty, o.edgeOff[e.index]);
    ctx.globalAlpha = e.opacity;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.width / k;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, tx, ty);
    ctx.stroke();
    calls++;
  }
  ctx.globalAlpha = 1;

  /* ── nodes ── */
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontBase = pal.fontSize;

  for (const n of o.nodes) {
    const wx = o.positions[n.index * 2];
    const wy = o.positions[n.index * 2 + 1];
    if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;

    const isSel = n.index === o.selectedIndex;
    const isHov = n.index === o.hoveredIndex;
    const isMatch = o.searchMatches?.has(n.index) ?? false;
    const emphasised = isSel || isHov || isMatch;

    // Body
    ctx.beginPath();
    ctx.arc(wx, wy, n.r, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? n.primary : n.darkFill;
    ctx.fill();
    ctx.lineWidth = emphasised ? 3 : 2;
    ctx.strokeStyle = emphasised ? pal.strokeStrong : n.border;
    ctx.stroke();
    calls += 2;

    // Core dot
    ctx.beginPath();
    ctx.arc(wx, wy, n.r > 16 ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = emphasised ? pal.strokeStrong : n.primary;
    ctx.fill();
    calls++;

    // State ring — merged hover/selection/search highlight, like the SVG's
    // state-ring <circle>.
    if (emphasised) {
      ctx.beginPath();
      ctx.arc(wx, wy, n.r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = pal.strokeStrong;
      ctx.lineWidth = 2;
      ctx.stroke();
      calls++;
    }

    // Label, below the node. Font size is compensated so text stays a constant
    // SCREEN size regardless of zoom — the same trick as the SVG halo width.
    const op = labelOpacityFor(k, n.tier);
    if (op > 0 && (o.labelLimit === null || n.tier <= o.labelLimit)) {
      const size = fontBase;
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
      const ty2 = wy + n.r + 12 + size * 0.5;

      // Halo first, so the label stays readable over any string behind it.
      ctx.globalAlpha = op * 0.85;
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.labelHalo;
      ctx.strokeText(n.name, wx, ty2);
      ctx.globalAlpha = op;
      ctx.fillStyle = emphasised ? pal.labelStrong : pal.label;
      ctx.fillText(n.name, wx, ty2);
      calls += 2;

      if (n.sub) {
        ctx.font = `400 ${Math.round(size * 0.78)}px ui-monospace, monospace`;
        ctx.globalAlpha = op * 0.6;
        ctx.fillStyle = pal.label;
        ctx.fillText(n.sub, wx, ty2 + size * 1.05);
        calls++;
      }
    }
  }

  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return calls;
}

/**
 * Size a canvas backing store for the current DPR.
 *
 * Returns the ratio actually applied, so the caller can scale its world-space
 * math consistently. Clamping DPR is the single biggest fill-rate win on a
 * 3x phone.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  rawDpr: number,
  cap = 2
): number {
  const dpr = effectiveDpr(rawDpr, cap);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}

export type { HitCircle };
