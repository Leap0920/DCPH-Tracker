/**
 * Globe layout: the cast arranged as a sphere around the hub.
 *
 * The radial (galaxy) layout put rings in one plane, which reads as a bullseye
 * on a wide screen and as a flat wheel on a phone. This module lifts the same
 * idea into three dimensions so the graph can be SPUN: the hub sits at the
 * origin, every other node lives on a shell whose radius is its BFS hop
 * distance from the hub, and rotating the view brings different parts of the
 * cast to the front.
 *
 * Two pure pieces, both testable without a canvas:
 *
 *  - `globeLayout` places nodes in 3D. Within a shell the points are spread by
 *    a Fibonacci sphere (even coverage, no clumping at the poles) and then
 *    ordered by faction, so the spiral winds faction-by-faction down the globe
 *    instead of scrambling them.
 *
 *  - `projectGlobe` yaws/pitches the points and projects them to the plane,
 *    returning a depth per node. Callers use depth for alpha, size and draw
 *    order — it is what makes the result read as a solid object rather than a
 *    flat scatter with the same silhouette.
 */

import { buildAdjacency } from "./canvas-motion";

export interface GlobeOptions {
  /** Radial gap between one shell and the next, in world px. */
  shellGap: number;
  /** Minimum surface spacing between neighbours on a shell, in world px. */
  minSpacing: number;
  /** Radians the whole spiral is turned, so the seam never sits dead centre. */
  phase: number;
  /** Deterministic wobble on radius, in world px. */
  jitter: number;
}

export const DEFAULT_GLOBE: GlobeOptions = {
  /*
   * SIZED FROM MEASUREMENT, not taste.
   *
   * At 132/96 the phone fit put 24 pairs of discs on top of one another — the
   * single biggest contributor to the "so messy" report, since overlapping
   * nodes hide their own labels and the whole sphere reads as one mass. These
   * values were picked by rendering the real cast at a phone viewport and
   * counting collisions: 132/96 gives 24, 200/150 gives 6, and 240/180 gives 3
   * at the cost of a smaller fit zoom.
   *
   * 200/150 is the balance — the overlap is essentially gone while the globe
   * still fills the screen, and the drawn-size floor in the painter keeps the
   * slightly smaller fit zoom legible.
   */
  shellGap: 200,
  minSpacing: 150,
  phase: 0.6,
  jitter: 4,
};

/** Golden angle — the Fibonacci sphere's azimuth step. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Stable faction ordering, largest first, so shells fill the same way each load. */
function factionOrder(faction: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of faction) counts.set(f, (counts.get(f) ?? 0) + 1);
  const keys = [...counts.keys()].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : a.localeCompare(b);
  });
  const order = new Map<string, number>();
  keys.forEach((k, i) => order.set(k, i));
  return order;
}

export interface GlobeLayoutResult {
  /** Interleaved [x0,y0,z0,x1,y1,z1,...] world positions. */
  points: Float64Array;
  /** Index of the node at the origin. */
  hub: number;
  /** Radius of the outermost shell — the globe's extent. */
  radius: number;
}

/**
 * Place every node on the globe.
 *
 * @param centerIndex node to put at the origin (the hub)
 * @param seed        per-node hash, used only for deterministic jitter
 */
export function globeLayout(
  nodeCount: number,
  edgeS: Int32Array,
  edgeT: Int32Array,
  faction: readonly string[],
  seed: readonly number[],
  centerIndex: number,
  opts: GlobeOptions = DEFAULT_GLOBE
): GlobeLayoutResult {
  const points = new Float64Array(nodeCount * 3);
  if (nodeCount === 0) return { points, hub: centerIndex, radius: 0 };

  const adj = buildAdjacency(edgeS, edgeT, edgeS.length, nodeCount);

  /* Shell = hop distance from the hub. */
  const shell = new Int32Array(nodeCount).fill(-1);
  shell[centerIndex] = 0;
  let frontier: number[] = [centerIndex];
  let depth = 0;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const node of frontier) {
      for (let a = adj.start[node]; a < adj.start[node + 1]; a++) {
        const nb = adj.neighbours[a];
        if (shell[nb] !== -1) continue;
        shell[nb] = depth + 1;
        next.push(nb);
      }
    }
    frontier = next;
    if (frontier.length > 0) depth++;
  }

  /*
   * A node the BFS never reached has no path to the hub. It still has to be
   * drawn, so it goes on the outermost shell rather than being dropped at the
   * origin — where it would sit invisibly inside the hub.
   */
  const outerShell = depth + 1;
  for (let i = 0; i < nodeCount; i++) {
    if (shell[i] === -1) shell[i] = outerShell;
  }

  const groups: number[][] = Array.from({ length: outerShell + 1 }, () => []);
  for (let i = 0; i < nodeCount; i++) groups[shell[i]].push(i);

  const order = factionOrder(faction);

  let prevRadius = 0;
  let radius = 0;

  for (let s = 0; s <= outerShell; s++) {
    const members = groups[s];
    if (members.length === 0) continue;

    if (s === 0) {
      // The hub is the centre of the globe; the camera's fit frames it.
      continue;
    }

    /*
     * Shell radius satisfies two constraints at once:
     *
     *  - radial: clear of the shell inside it by shellGap, so shells never
     *    interpenetrate;
     *  - surface: enough area for the nodes on it. A sphere of radius r has
     *    4*pi*r^2 of surface and each node wants ~minSpacing^2, so
     *    r >= minSpacing * sqrt(n / (4*pi)).
     *
     * Taking the max keeps a crowded shell from swallowing a sparse one.
     */
    const forSurface =
      opts.minSpacing * Math.sqrt(members.length / (4 * Math.PI));
    radius = Math.max(prevRadius + opts.shellGap, forSurface);
    prevRadius = radius;

    /*
     * Faction-sorted before placement: the Fibonacci spiral visits the sphere
     * in a single sweep, so consecutive indices land next to each other. Sorting
     * by faction therefore paints each faction as one continuous band down the
     * globe, which is what makes the arms legible while it spins.
     */
    members.sort((a, b) => {
      const fa = order.get(faction[a]) ?? 0;
      const fb = order.get(faction[b]) ?? 0;
      if (fa !== fb) return fa - fb;
      if (seed[a] !== seed[b]) return seed[a] - seed[b];
      return a - b;
    });

    const count = members.length;
    members.forEach((node, j) => {
      /*
       * Fibonacci sphere: y marches evenly from +1 to -1 and the azimuth turns
       * by the golden angle, which distributes points about as evenly as a
       * sphere allows — no pole clumps, no seam.
       */
      const y = 1 - (2 * (j + 0.5)) / count;
      const ringR = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * j + opts.phase;
      const wobble = ((seed[node] % 991) / 991 - 0.5) * 2 * opts.jitter;
      const rr = radius + wobble;
      points[node * 3] = Math.cos(theta) * ringR * rr;
      points[node * 3 + 1] = y * rr;
      points[node * 3 + 2] = Math.sin(theta) * ringR * rr;
    });
  }

  points[centerIndex * 3] = 0;
  points[centerIndex * 3 + 1] = 0;
  points[centerIndex * 3 + 2] = 0;

  return { points, hub: centerIndex, radius };
}

export interface GlobeProjection {
  /** Interleaved [x,y] screen-plane positions. */
  screen: Float64Array;
  /**
   * Normalised depth per node: +1 is nearest the viewer, -1 the farthest.
   * Drives alpha, size and draw order.
   */
  depth: Float64Array;
}

/**
 * Rotate the globe and project it flat.
 *
 * Yaw turns about the vertical axis, pitch about the horizontal — the two a
 * finger drag maps onto. Rotation is applied about the origin, which is the
 * hub, so the centre of the graph stays pinned to the centre of the view no
 * matter how far the globe is spun.
 */
export function projectGlobe(
  points: Float64Array,
  nodeCount: number,
  yaw: number,
  pitch: number,
  out: GlobeProjection
): GlobeProjection {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  let maxAbs = 0;
  for (let i = 0; i < nodeCount; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];

    // Yaw about Y, then pitch about X.
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;

    out.screen[i * 2] = x1;
    out.screen[i * 2 + 1] = y2;
    out.depth[i] = z2;
    const a = Math.abs(z2);
    if (a > maxAbs) maxAbs = a;
  }

  // Normalise to -1..1 so callers can use depth without knowing the radius.
  if (maxAbs > 0) {
    for (let i = 0; i < nodeCount; i++) out.depth[i] /= maxAbs;
  }
  return out;
}

/**
 * Inverse of the projection's rotation, applied to a screen-space delta.
 *
 * A drag moves a node along the plane FACING THE VIEWER, so the screen delta
 * has to be turned back into world space before it can be added to a 3D
 * position — otherwise dragging a node near the edge of the globe would push it
 * along a world axis instead of along the plane you are looking at.
 */
export function unprojectDelta(
  dx: number,
  dy: number,
  yaw: number,
  pitch: number
): { x: number; y: number; z: number } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Undo pitch (about X), then undo yaw (about Y). The view plane's Z is 0.
  const y1 = dy * cp;
  const z1 = -dy * sp;
  const x1 = dx;
  return {
    x: x1 * cy - z1 * sy,
    y: y1,
    z: x1 * sy + z1 * cy,
  };
}
