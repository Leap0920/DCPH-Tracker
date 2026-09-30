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
  labelVisibilityFor,
  quadControl,
  toScreen,
  type HitCircle,
} from "./canvas-geometry";
import { breatheScale } from "./canvas-motion";

export interface PaintedNode {
  index: number;
  /** Stable colour id resolved to a hex string up front. */
  primary: string;
  darkFill: string;
  lightFill: string;
  border: string;
  /** Soft faction halo colour (rgba string). */
  glow: string;
  r: number;
  tier: 0 | 1 | 2;
  name: string;
  /** Sub-label (alias/role), skipped on the low tier. */
  sub?: string;
  /** The Conan hub node gets a heavier ring, as in the SVG renderer. */
  isConan?: boolean;
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
  dotGrid: boolean;
  /** Selects the theme-appropriate node fill (see PaintedNode.darkFill). */
  isDark: boolean;
  /**
   * The device-pixel-ratio scale the caller applied to the context. `paint`
   * restores it on the way out, so the value has to travel with the options.
   */
  dpr: number;
  /**
   * Ambient clock in ms, advanced only by the idle animation loop. Drives the
   * halo breathing; 0 means "no ambient motion" (reduced motion, or paused).
   */
  ambientMs: number;
  viewport: { w: number; h: number };
}


type LabelBox = { x: number; y: number; w: number; h: number };

/**
 * The smallest a node is ever DRAWN, in CSS px.
 *
 * Below roughly this size a disc stops reading as a node and starts reading as
 * noise. Measured against the real cast at a phone viewport: a 4px floor nearly
 * doubles the number of colliding pairs (6 -> 12) because it inflates the many
 * small cast members into their neighbours, while 3px is free — the same six
 * collisions as no floor at all, with a guaranteed visible dot.
 */
export const MIN_NODE_R_PX = 3;

/**
 * Opacity a NON-highlighted label paints at, inside the visible zoom band.
 *
 * Slightly under full on purpose: names must stay readable over any string, but
 * they must not out-shout the graph they annotate. Highlighted labels (hover,
 * selection, search) keep full strength.
 */
const LABEL_REST_ALPHA = 0.9;

/** Axis-aligned overlap test for label boxes. */
function overlaps(box: LabelBox, placed: readonly LabelBox[]): boolean {
  for (const p of placed) {
    if (
      box.x < p.x + p.w &&
      box.x + box.w > p.x &&
      box.y < p.y + p.h &&
      box.y + box.h > p.y
    ) {
      return true;
    }
  }
  return false;
}

/** Is this node drawn in its highlight state? */
function emphasised(i: number, o: PaintOptions): boolean {
  return (
    i === o.selectedIndex || i === o.hoveredIndex || (o.searchMatches?.has(i) ?? false)
  );
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
  /** The scale the caller already applied; every transform here composes with
   *  it so drawing stays in CSS px while the backing store stays crisp. */
  const dpr = o.dpr;

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
  /*
   * Compose the camera WITH the device-pixel-ratio scale, never replace it.
   *
   * The caller sets the context to `scale(dpr)` so everything below can be
   * written in CSS pixels. A bare `setTransform(k, 0, 0, k, cam.x, cam.y)` threw
   * that scale away, so the whole graph drew at 1/dpr of its intended size —
   * measured against a 2x phone that is exactly the reported symptom: the fit
   * computed an 81%-wide graph and the screen showed 40%, parked up and to the
   * left because the camera offset was likewise unscaled.
   *
   * Multiplying through keeps one transform for every node and edge, so pan and
   * zoom stay a single setTransform rather than 2,350 element updates.
   */
  ctx.setTransform(k * dpr, 0, 0, k * dpr, cam.x * dpr, cam.y * dpr);

  // World-space viewport, used to cull before drawing.
  const minWX = -cam.x / k - 64;
  const maxWX = (viewport.w - cam.x) / k + 64;
  const minWY = -cam.y / k - 64;
  const maxWY = (viewport.h - cam.y) / k + 64;

  /* ── strings ── */
  ctx.lineCap = "round";
  for (const e of o.edges) {
    /*
     * A string at zero opacity is not drawn at all — no stroke, no cost. When a
     * character is selected every unrelated thread is hidden, so this is the
     * common case rather than a corner: on a phone it is most of the web, and
     * stroking invisible paths would pay for exactly the frame the hide is
     * meant to simplify.
     */
    if (e.opacity <= 0) continue;
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

  const orderedNodes = o.nodes;

  for (const n of orderedNodes) {
    const wx = o.positions[n.index * 2];
    const wy = o.positions[n.index * 2 + 1];
    if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;

    /*
     * A minimum DRAWN radius, in screen px. A node's world radius is 10-24, so
     * at the zoom that fits a 103-node globe on a phone the smallest cast
     * members render under 4px and the whole thing reads as scattered dust —
     * part of what "so messy" meant. Clamping the drawn size keeps every node a
     * visible dot at any zoom; the size hierarchy still reads when you zoom in
     * far enough for the real radii to exceed the floor.
     */
    const nr = Math.max(n.r, MIN_NODE_R_PX / k);
    if (nr < 1.5) continue;

    const isSel = n.index === o.selectedIndex;
    const isHov = n.index === o.hoveredIndex;
    const isMatch = o.searchMatches?.has(n.index) ?? false;
    const emphasised = isSel || isHov || isMatch;
    /*
     * A spotlight dims what it is NOT about. Hover deliberately does not — a
     * pointer crossing the graph must never blank it out — but a search or a
     * faction pick is a deliberate narrowing, and leaving the rest at full
     * strength would mean the chosen group does not stand out at all, which is
     * the only reason to pick it.
     *
     * An emphasised node is always opaque: it is the thing being looked for.
     */
    const dimmed = o.searchMatches !== null && !isMatch;
    ctx.globalAlpha = emphasised ? 1 : dimmed ? 0.18 : 1;

    // Faction glow — the soft halo the SVG version got from a radial gradient.
    // Drawn first, in screen-compensated radius so it stays a constant visual
    // weight at any zoom.
    //
    // It breathes: each node's halo swells and settles on its own period, phase
    // offset by index so the whole cast never pulses in unison. This is the
    // canvas equivalent of the SVG's breathing ring, and costs one multiplication
    // per node rather than 103 infinite CSS animations.
    const breathe = o.ambientMs > 0 ? breatheScale(o.ambientMs, 4200, n.index * 0.7, 0.16) : 1;
    const glowR = (nr + 12) * k * breathe;
    if (glowR > 2) {
      const g = ctx.createRadialGradient(wx, wy, nr * 0.6, wx, wy, glowR);
      g.addColorStop(0, n.glow);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(wx, wy, glowR, 0, Math.PI * 2);
      ctx.fill();
      calls++;
    }

    // Body. The fill is theme-aware: hardcoding darkFill made every node render
    // as a dark disc on the light theme, which flattened the whole palette.
    ctx.beginPath();
    ctx.arc(wx, wy, nr, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? n.primary : o.isDark ? n.darkFill : n.lightFill;
    ctx.fill();
    // Conan reads as the hub with a heavier ring; the SVG did the same.
    ctx.lineWidth = emphasised ? 3 : n.isConan ? 3.5 : 2;
    ctx.strokeStyle = emphasised ? pal.strokeStrong : n.border;
    ctx.stroke();
    calls += 2;

    // Core dot
    ctx.beginPath();
    ctx.arc(wx, wy, nr > 16 ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = emphasised ? pal.strokeStrong : n.primary;
    ctx.fill();
    calls++;

    // State ring — merged hover/selection/search highlight, like the SVG's
    // state-ring <circle>.
    if (emphasised) {
      ctx.beginPath();
      ctx.arc(wx, wy, nr + 7, 0, Math.PI * 2);
      ctx.strokeStyle = pal.strokeStrong;
      ctx.lineWidth = 2;
      ctx.stroke();
      calls++;
    }

  }


  /* ── labels ───────────────────────────────────────────────────
   * A dedicated pass AFTER every node body is down, so the label set is not
   * biased by draw order.
   *
   * The tier policy used to gate names by node importance: on the `low` tier
   * labelLimit = 0, so only the 20 largest of 319 nodes were ever named. That
   * was inherited from the SVG renderer, where hiding a label costs nothing —
   * here the name IS the content, and a graph of unnamed dots is useless. So
   * every node is a candidate.
   *
   * What is still worth suppressing is TEXT THAT OVERLAPS TEXT. Labels are
   * admitted in importance order (hub, then major, then cast) and each one that
   * would collide with an already-placed box is dropped. Because a dropped name
   * comes back the moment you zoom in, nothing is lost permanently.
   *
   * `measureText` is the only way to know a label's real width on canvas, so it
   * is called once per candidate and cached for the frame.
   */
  const boxes: LabelBox[] = [];
  const candidates: { n: PaintedNode; wx: number; wy: number }[] = [];

  for (const n of orderedNodes) {
    const wx = o.positions[n.index * 2];
    const wy = o.positions[n.index * 2 + 1];
    if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
    candidates.push({ n, wx, wy });
  }
  // Most important first, so when two labels collide the one that survives is
  // the one a reader is more likely to be looking for.
  candidates.sort((a, b) => a.n.tier - b.n.tier || b.n.r - a.n.r);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  /* The zoom gate below is a flat policy — the map is the content while the
     view is wide, so no ordinary name is painted under 33%, however important
     its node. A highlighted name is exempt: one deliberate name is not noise. */
  const gate = labelVisibilityFor(k);

  for (const { n, wx, wy } of candidates) {
    const emph = emphasised(n.index, o);
    if (!emph && gate <= 0) continue;

    /*
     * Opacity: the zoom gate decides WHETHER text is painted; the highlight
     * decides how loud. Inside the band a name is drawn — a highlighted one at
     * full strength, the rest a touch under it so text never out-shouts the
     * graph — or dropped by the collision test below. No per-label fuzziness:
     * the old per-tier fade would only dim names that are legible at a fixed
     * screen size anyway.
     */
    const op = emph ? 1 : gate * LABEL_REST_ALPHA;

    /*
     * LABELS DO NOT SCALE WITH THE CAMERA — and that was the readability bug.
     *
     * Everything else here is drawn in world units and the camera transform
     * scales it, so a node naturally grows as you zoom in. Text must not: at the
     * zoom the phone fit picks (k ~ 0.33) an 11px label rendered at 3.7px, which
     * is not small type, it is a grey smudge. Feeding the font size through
     * 1/k cancels the camera scale exactly, so a name is 11px ON SCREEN at any
     * zoom, and zooming in is what buys room for more of them rather than
     * making the existing ones legible.
     *
     * With the text at a fixed screen size, the collision test finally measures
     * what it is comparing, so the labels that survive are the ones that fit.
     */
    const size = n.tier === 0 ? fontBase + 1 : fontBase;
    const worldSize = size / k;
    ctx.font = `${n.tier === 0 ? 700 : 600} ${worldSize}px ui-sans-serif, system-ui, sans-serif`;

    const wpx = ctx.measureText(n.name).width;
    const gapPx = 12;
    const screenW = wpx * k;
    const sx = wx * k + cam.x;
    const sy = wy * k + cam.y;
    const nodeR = Math.max(n.r, MIN_NODE_R_PX / k) * k;

    /*
     * TWO PLACEMENTS, NOT ONE.
     *
     * Historically a label went below its node or nowhere, so a name was lost
     * the moment the node under it happened to sit in a crowded band — and on a
     * globe every shell IS a crowded band, which is why so few names survived.
     * Mirroring the label to the top of the node when the underside is taken is
     * free (it is text either way) and roughly doubles how many of the cast can
     * be named at once.
     *
     * Below is tried first because it is the reading people expect, and because
     * the halo is tuned for it.
     */
    const belowY = sy + nodeR + gapPx + size * 0.5;
    const aboveY = sy - nodeR - gapPx - size * 0.5;
    let placed = false;
    let ty2 = (belowY - cam.y) / k; // back to world units for drawing
    let dir = 1; // +1 below, -1 above — the sub-label hangs on the same side
    for (const [screenY, d] of [
      [belowY, 1],
      [aboveY, -1],
    ] as const) {
      const box: LabelBox = {
        x: sx - screenW / 2 - 2,
        y: screenY - size * 0.62,
        w: screenW + 4,
        h: size * 1.24,
      };
      if (overlaps(box, boxes)) continue;
      boxes.push(box);
      ty2 = (screenY - cam.y) / k;
      dir = d;
      placed = true;
      break;
    }
    if (!placed) continue;

    // Halo first so the name stays readable over any string behind it.
    ctx.globalAlpha = op * 0.9;
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = pal.labelHalo;
    ctx.strokeText(n.name, wx, ty2);
    ctx.globalAlpha = op;
    ctx.fillStyle = emph ? pal.labelStrong : pal.label;
    ctx.fillText(n.name, wx, ty2);
    calls += 2;

    if (n.sub) {
      ctx.font = `400 ${Math.round(worldSize * 0.78)}px ui-monospace, monospace`;
      ctx.globalAlpha = op * 0.65;
      ctx.fillStyle = pal.label;
      ctx.fillText(n.sub, wx, ty2 + worldSize * 1.05 * dir);
      calls++;
    }
  }
  ctx.globalAlpha = 1;


  ctx.restore();
  /*
   * Reset to the DPR scale, NOT the identity.
   *
   * The caller's context is scaled by the device pixel ratio so `paint` can work
   * in CSS pixels. Ending on setTransform(1,0,0,1,0,0) threw that away, so
   * every frame after the first drew at 1/dpr scale — on a 3x phone that is a
   * third of the intended size in the top-left corner, which is exactly what
   * "the graph is a cluster in the corner and things vanish when I zoom" looked
   * like. The DPR reset belongs to sizeCanvas, so restore it here.
   */
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
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
