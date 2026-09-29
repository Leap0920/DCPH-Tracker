/**
 * Pure geometry for the canvas graph renderer.
 *
 * The SVG renderer expressed the camera as CSS transforms and let the browser
 * hit-test. Canvas does neither, so both live here as plain functions:
 *
 *  - `toScreen` / `toWorld` invert the camera transform.
 *  - `hitNode` / `hitEdge` replace the browser's layout + hit-test pass over
 *    ~2,350 SVG elements.
 *  - `quadControl` returns the bow control point for a red-string so the canvas
 *    draws exactly the curve the SVG <path> did.
 *
 * Everything here is side-effect free and dependency-free so it can be tested
 * without a DOM or a canvas — which is the only way to be confident about the
 * part of the renderer that matters most (correct picking) before shipping it
 * to a device I cannot measure on.
 */

export interface Camera {
  /** Screen-space translation, px. */
  x: number;
  y: number;
  /** Uniform scale. */
  k: number;
}

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, k: 1 };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** World point -> screen (container-local) point. */
export function toScreen(
  wx: number,
  wy: number,
  cam: Camera
): { x: number; y: number } {
  return { x: wx * cam.k + cam.x, y: wy * cam.k + cam.y };
}

/** Screen (container-local) point -> world point. */
export function toWorld(
  sx: number,
  sy: number,
  cam: Camera
): { x: number; y: number } {
  const k = cam.k || 1;
  return { x: (sx - cam.x) / k, y: (sy - cam.y) / k };
}

/**
 * Bow control point for a red string, mirroring quadPath() in CharactersWeb.
 * Multi-type pairs are offset along the segment normal by BASE_BOW +
 * offsetIndex * PARALLEL_GAP, so parallel threads bow apart instead of
 * overlapping.
 */
export function quadControl(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  offsetIndex: number,
  baseBow = 6,
  parallelGap = 22
): { x: number; y: number } {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const arc = baseBow + offsetIndex * parallelGap;
  return { x: mx + (-dy / len) * arc, y: my + (dx / len) * arc };
}

export interface HitCircle {
  /** Index into the renderer's node array. */
  index: number;
  /** Current world position. */
  wx: number;
  wy: number;
  /** World radius. */
  r: number;
}

/**
 * Topmost node under the screen point, or -1.
 *
 * Scans BACKWARD so the last matching (highest-index) node wins, and returns the
 * smallest containing circle so a node drawn inside another is still reachable.
 * `slackPx` widens every radius in screen space, which is what makes a 6px
 * node tappable with a finger instead of a stylus.
 */
export function hitNode(
  sx: number,
  sy: number,
  cam: Camera,
  circles: readonly HitCircle[],
  slackPx = 0
): number {
  const k = cam.k || 1;
  let best = -1;
  let bestR = Infinity;

  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    const p = toScreen(c.wx, c.wy, cam);
    // Measure in WORLD units: a node's radius is authored in world px, so the
    // screen offset has to be divided by k before it can be compared against
    // one. Mixing the two would make every target wrong at high zoom.
    const dx = (p.x - sx) / k;
    const dy = (p.y - sy) / k;
    // Slack stays in screen px (a finger-sized pad) and converts to world here.
    const reach = c.r + slackPx / k;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    if (c.r < bestR) {
      bestR = c.r;
      best = i;
    }
  }
  return best;
}

/** Squared distance from p to segment ab. */
function distToSegment2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/**
 * Approximate distance from a screen point to a quadratic curve, by sampling.
 *
 * Exact bezier projection is overkill here: the curve is a shallow bow, 8
 * samples are well inside one screen pixel, and hit-testing runs at most once
 * per pointermove.
 */
export function distToQuad2(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  samples = 8
): number {
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const x = u * u * sx + 2 * u * t * cx + t * t * tx;
    const y = u * u * sy + 2 * u * t * cy + t * t * ty;
    best = Math.min(best, (px - x) ** 2 + (py - y) ** 2);
  }
  return best;
}

export interface HitEdge {
  index: number;
  /** Current world endpoints. */
  swx: number;
  swy: number;
  twx: number;
  twy: number;
  /** Bow offset index, for the parallel-thread curve. */
  off: number;
}

/** Nearest edge under the screen point, or -1. Edges are thin; slackPx widens. */
export function hitEdge(
  sx: number,
  sy: number,
  cam: Camera,
  edges: readonly HitEdge[],
  slackPx = 8
): number {
  const k = cam.k || 1;
  const reach = slackPx / k;
  const reach2 = reach * reach;
  let best = -1;
  let bestD2 = Infinity;

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const a = toScreen(e.swx, e.swy, cam);
    const b = toScreen(e.twx, e.twy, cam);
    const ctrl = quadControl(e.swx, e.swy, e.twx, e.twy, e.off);
    const c = toScreen(ctrl.x, ctrl.y, cam);
    const d2 = distToQuad2(sx, sy, a.x, a.y, c.x, c.y, b.x, b.y);
    if (d2 > reach2) continue;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

export interface Bounds {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/**
 * Camera that fits `bounds` into a viewport rect with margin.
 *
 * Margin is a share of the smaller viewport axis, so a phone in portrait and a
 * desktop in landscape both keep the same visual breathing room.
 */
export function fitCamera(
  bounds: Bounds,
  viewport: { x: number; y: number; w: number; h: number },
  minK: number,
  maxK: number,
  marginShare = 0.06
): Camera {
  const margin = Math.min(viewport.w, viewport.h) * marginShare;
  const availW = Math.max(1, viewport.w - margin * 2);
  const availH = Math.max(1, viewport.h - margin * 2);
  const k = clamp(
    Math.min(availW / (bounds.w || 1), availH / (bounds.h || 1)),
    minK,
    maxK
  );
  return {
    k,
    x: viewport.x + viewport.w / 2 - (bounds.minX + bounds.w / 2) * k,
    y: viewport.y + viewport.h / 2 - (bounds.minY + bounds.h / 2) * k,
  };
}

/**
 * Device pixel ratio to actually render at.
 *
 * A 3x phone would ask for a 9x-pixel-per-CSS-px backing store, which costs 9x
 * the fill rate for a graph nobody reads at that density. Clamping keeps text
 * legible while cutting the most expensive thing the canvas does.
 */
export function effectiveDpr(raw: number, cap = 2): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return clamp(raw, 1, cap);
}

/**
 * Zoom at which a label of `tier` becomes worth painting. Mirrors
 * labelOpacityFor() so the canvas and the SVG agree on what is legible.
 */
export function labelOpacityFor(k: number, tier: 0 | 1 | 2): number {
  if (tier === 0) return 1;
  if (tier === 1) return clamp(k / 0.55, 0.75, 1);
  return clamp((k - 0.35) / 0.25, 0, 1);
}

/** Nodes fully outside the viewport, given a world-space margin. */
export function cullNodes(
  indices: Iterable<number>,
  cam: Camera,
  viewport: { w: number; h: number },
  xs: Float64Array,
  ys: Float64Array,
  margin = 64
): number[] {
  const k = cam.k || 1;
  const minWX = -cam.x / k - margin / k;
  const minWY = -cam.y / k - margin / k;
  const maxWX = (viewport.w - cam.x) / k + margin / k;
  const maxWY = (viewport.h - cam.y) / k + margin / k;
  const out: number[] = [];
  for (const i of indices) {
    const x = xs[i];
    const y = ys[i];
    if (x < minWX || x > maxWX || y < minWY || y > maxWY) continue;
    out.push(i);
  }
  return out;
}
