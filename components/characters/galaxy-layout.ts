/**
 * Galaxy layout: the cast as concentric rings around a hub, with factions
 * forming the arms.
 *
 * The authored data carries hand-placed x/y coordinates, and on a wide screen
 * they read as a loose web. On a phone — tall, narrow, and often the only way
 * anyone sees this page — the same coordinates read as a tangle of cobwebs with
 * no centre to hold onto. This module derives a layout from the GRAPH instead:
 *
 *   - The hub (highest-degree node, Conan) sits at the origin.
 *   - Ring number is BFS hop distance from the hub, so "how far from the story's
 *     centre" is a literal radius.
 *   - Nodes within a ring are ordered by faction, so each faction occupies a
 *     contiguous arc. Rotating each ring slightly further than the last turns
 *     those arcs into spiral arms.
 *
 * Pure and deterministic: same input, same layout, every reload. Nothing here
 * touches the DOM or the canvas, so it can be tested directly.
 */

import { buildAdjacency } from "./canvas-motion";

export interface GalaxyOptions {
  /** Minimum gap between node centres on the same ring, in world px. */
  minSpacing: number;
  /** Minimum radial gap between consecutive rings, in world px. */
  ringGap: number;
  /** Radians each ring is rotated past the one inside it — the spiral. */
  twist: number;
  /** Deterministic wobble on radius, in world px, so rings are not rulers. */
  radialJitter: number;
  /** Deterministic wobble on angle, in radians. */
  angularJitter: number;
}

export const DEFAULT_GALAXY: GalaxyOptions = {
  /*
   * 78 world px between neighbours. Nodes are drawn at radius 10-24 with a
   * label beneath, so anything much tighter overlaps on a phone once the fit
   * zoom brings the whole cast onto a ~380px-wide viewport.
   */
  minSpacing: 84,
  ringGap: 104,
  twist: 0.38,
  radialJitter: 7,
  angularJitter: 0.012,
};

/** A stable ordering key for each faction, so arms land the same way each load. */
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

/**
 * Place every node on the galaxy.
 *
 * @param centerIndex node to put at the origin (the hub)
 * @param seed        per-node hash, used only for deterministic jitter
 */
export function galaxyLayout(
  nodeCount: number,
  edgeS: Int32Array,
  edgeT: Int32Array,
  faction: readonly string[],
  seed: readonly number[],
  centerIndex: number,
  opts: GalaxyOptions = DEFAULT_GALAXY
): Float64Array {
  const positions = new Float64Array(nodeCount * 2);
  if (nodeCount === 0) return positions;

  const adj = buildAdjacency(edgeS, edgeT, edgeS.length, nodeCount);

  /* Ring = hop distance from the hub. */
  const ring = new Int32Array(nodeCount).fill(-1);
  ring[centerIndex] = 0;
  let frontier: number[] = [centerIndex];
  let depth = 0;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const node of frontier) {
      for (let a = adj.start[node]; a < adj.start[node + 1]; a++) {
        const nb = adj.neighbours[a];
        if (ring[nb] !== -1) continue;
        ring[nb] = depth + 1;
        next.push(nb);
      }
    }
    frontier = next;
    if (frontier.length > 0) depth++;
  }

  /*
   * Anything the BFS never reached is a separate component with no path to the
   * hub. It still has to be drawn, so it goes on the outermost ring rather than
   * being silently dropped at the origin.
   */
  const outerRing = depth + 1;
  for (let i = 0; i < nodeCount; i++) {
    if (ring[i] === -1) ring[i] = outerRing;
  }

  const groups: number[][] = Array.from({ length: outerRing + 1 }, () => []);
  for (let i = 0; i < nodeCount; i++) groups[ring[i]].push(i);

  const order = factionOrder(faction);

  let radius = 0;
  for (let r = 0; r <= outerRing; r++) {
    const members = groups[r];
    if (members.length === 0) continue;

    if (r > 0) {
      /*
       * Radius has to satisfy two things at once: enough circumference that
       * neighbours on this ring are `minSpacing` apart, and at least `ringGap`
       * clear of the ring inside it. Taking the max of the two is what keeps
       * a crowded ring from colliding with a sparse one.
       */
      const forSpacing = (members.length * opts.minSpacing) / (2 * Math.PI);
      radius = Math.max(radius + opts.ringGap, forSpacing);
    }

    /*
     * Faction-sorted, then seed-sorted: same faction sits next to same faction,
     * so the arm is contiguous, and the order inside it never changes between
     * loads.
     */
    members.sort((a, b) => {
      const fa = order.get(faction[a]) ?? 0;
      const fb = order.get(faction[b]) ?? 0;
      if (fa !== fb) return fa - fb;
      if (seed[a] !== seed[b]) return seed[a] - seed[b];
      return a - b;
    });

    const count = members.length;
    // Rotate further out with each ring — this is the spiral.
    const twist = opts.twist * r;

    members.forEach((node, j) => {
      if (r === 0) {
        positions[node * 2] = 0;
        positions[node * 2 + 1] = 0;
        return;
      }
      const base = twist + ((j + 0.5) / count) * Math.PI * 2;
      // Deterministic per-node wobble, signed into [-1, 1].
      const jitterA = ((seed[node] % 1000) / 1000 - 0.5) * 2 * opts.angularJitter;
      const jitterR = ((seed[node] % 997) / 997 - 0.5) * 2 * opts.radialJitter;
      const angle = base + jitterA;
      const rr = radius + jitterR;
      positions[node * 2] = Math.cos(angle) * rr;
      positions[node * 2 + 1] = Math.sin(angle) * rr;
    });
  }

  return positions;
}
