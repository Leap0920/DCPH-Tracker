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
 * Two passes, NEAREST CENTRE first in each:
 *  1. A disc the finger is actually on (distance <= drawn radius) wins outright.
 *  2. Only if no disc was touched, `slackPx` (a finger-sized pad in screen px)
 *     widens the search to the nearest centre within reach.
 *
 * This used to return the SMALLEST containing circle, and with a phone-sized
 * slack that quietly re-mapped real taps: a small neighbour sitting ~16px away
 * from the point counted as a "candidate", and being smaller it beat the big
 * node whose disc the finger was on — tapping Amuro opened Karasuma. Nearest
 * centre keeps the fat-finger tolerance without letting a bystander steal a
 * direct hit. Exact ties keep the old preference for the smaller disc, so a
 * node nested inside another stays reachable.
 */
export function hitNode(
  sx: number,
  sy: number,
  cam: Camera,
  circles: readonly HitCircle[],
  slackPx = 0
): number {
  const k = cam.k || 1;
  const slackW = slackPx / k;
  let best = -1;
  let bestD2 = Infinity;
  let bestR = Infinity;
  let slack = -1;
  let slackD2 = Infinity;
  let slackR = Infinity;

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const p = toScreen(c.wx, c.wy, cam);
    // Measure in WORLD units: a node's radius is authored in world px, so the
    // screen offset has to be divided by k before it can be compared against
    // one. Mixing the two would make every target wrong at high zoom.
    const dx = (p.x - sx) / k;
    const dy = (p.y - sy) / k;
    const d2 = dx * dx + dy * dy;
    if (d2 <= c.r * c.r) {
      if (d2 < bestD2 || (d2 === bestD2 && c.r < bestR)) {
        bestD2 = d2;
        bestR = c.r;
        best = i;
      }
      continue;
    }
    // Slack stays in screen px (a finger-sized pad) and converts to world here.
    const reach = c.r + slackW;
    if (d2 <= reach * reach) {
      if (d2 < slackD2 || (d2 === slackD2 && c.r < slackR)) {
        slackD2 = d2;
        slackR = c.r;
        slack = i;
      }
    }
  }
  return best !== -1 ? best : slack;
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

/** The SVG renderer opens desktops centred on the hub at this zoom. */
const HOME_DESKTOP_K = 1.35;

/**
 * The camera a renderer OPENS with — the one framing both renderers share, so
 * changing quality never changes where the graph sits on screen.
 *
 * Phones fill the width edge-to-edge: a portrait viewport has height to spare
 * and the graph is judged against the width, so that is what the opening zoom
 * is derived from (with the height as a hard cap, so nothing clips). Desktops
 * mirror the SVG renderer exactly — centred on the hub at its opening zoom
 * (CONAN at the centre of the screen), the view the highlight work is read in.
 */
export function homeCamera(
  bounds: Bounds,
  hub: { x: number; y: number },
  viewport: { x: number; y: number; w: number; h: number },
  isMobile: boolean,
  minK: number,
  maxK: number
): Camera {
  if (!isMobile) {
    const k = clamp(HOME_DESKTOP_K, minK, maxK);
    return {
      k,
      x: viewport.x + viewport.w / 2 - hub.x * k,
      y: viewport.y + viewport.h / 2 - hub.y * k,
    };
  }
  const screenW = viewport.w + viewport.x * 2;
  const k = clamp(
    Math.min(screenW / (bounds.w || 1), viewport.h / (bounds.h || 1)),
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

/**
 * Whether NAME TEXT is painted at this zoom, as a 0..1 strength.
 *
 * The reader's policy, from the phone: below 33% the map itself is the content
 * and text is noise — nothing is drawn; from 47% up names read clearly; the
 * short band between is a fade so names do not pop. This gates the whole
 * renderer, tier included — the per-tier fade still decides emphasis inside the
 * visible band, but no tier paints through the gate. A FORCED label (hover,
 * selection, search hit) is exempt: one deliberate name is not clutter.
 */
export function labelVisibilityFor(k: number): number {
  const pct = k * 100;
  if (pct < 33) return 0;
  if (pct >= 47) return 1;
  return (pct - 33) / 14;
}

/**
 * Visibility of one relationship string, given what the viewer is focused on.
 *
 * Three narrowing actions, deliberately different:
 *
 *  - A SELECTED CHARACTER is a request to read ONE person's relationships. Every
 *    string that does not touch them is hidden outright. Dimming the rest to
 *    0.42 still left ~200 threads crossing the one web being read — the same
 *    "so messy" that selecting a character is supposed to answer. Hiding is the
 *    deliberate difference between "less loud" and "gone".
 *
 *  - A SEARCH or faction spotlight DIMS what it excludes but keeps it on screen.
 *    The set is the subject and the rest of the web is its context; hiding it
 *    would make the matches read as the whole cast, which they are not.
 *
 *  - HOVER only brightens, and must never hide anything: sweeping the pointer
 *    once blanked most of the graph, which on a phone reads as content
 *    vanishing. Contact is not a narrowing action.
 *
 * A selection outranks a hover — while one character is being read, another
 * character passing under the pointer does not reopen the web.
 */
/**
 * How a picked character's strings relate to the rest of the graph.
 *
 * Strings that are NOT part of the selected character's own web do not vanish:
 * they drop into the background as a desaturated ghost (gray, OUT_OF_WEB_OPACITY)
 * so the shape of the whole cast stays readable behind the one web being read.
 * Still MUCH fainter than the old 0.42 dim — the coloured leftovers were what
 * crossed the web being read.
 */
export const OUT_OF_WEB_OPACITY = 0.1;
export const OUT_OF_WEB_COLOR = "#94A3B8";

export function edgeOpacityFor(
  s: number,
  t: number,
  o: {
    selectedIndex: number;
    hoveredIndex: number;
    searchMatches: ReadonlySet<number> | null;
  }
): number {
  /*
   * Selection is checked FIRST so it outranks an active search or spotlight:
   * picking a character is the most specific thing the viewer can do, and the
   * web being read must not be diluted by whatever filter happened to be on.
   */
  if (o.selectedIndex >= 0) {
    return s === o.selectedIndex || t === o.selectedIndex
      ? 1
      : OUT_OF_WEB_OPACITY;
  }
  if (o.searchMatches !== null) {
    const inSet = (i: number) => o.searchMatches?.has(i) ?? false;
    if (inSet(s) && inSet(t)) return 1;
    if (inSet(s) || inSet(t)) return 0.45;
    return 0.1;
  }
  if (s === o.hoveredIndex || t === o.hoveredIndex) return 1;
  return 0.5;
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
