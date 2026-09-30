/**
 * Motion for the canvas graph: ambient drift and drag propagation.
 *
 * Two independent effects, both pure so they can be tested without a canvas:
 *
 *  - DRIFT. Each node wanders on two out-of-phase sine pairs, seeded
 *    deterministically from its id, so the layout is stable across reloads and
 *    no two nodes breathe in sync. Amplitude is per-tier: zero on `low` for a
 *    genuinely still graph, a couple of px on `balanced`/`high`.
 *
 *  - PROPAGATION. Obsidian's graph lets a dragged node pull its neighbours along;
 *    you are not moving one dot in isolation, you are tugging the web. A drag
 *    displaces the dragged node fully, its direct neighbours by a share of that
 *    displacement, and theirs by a smaller share again, falling off with hop
 *    distance until it is imperceptible.
 *
 * Positions are kept in one place: `home` is the settled layout, and `render` is
 * what gets painted = home + drift + propagated. Nothing mutates home, so
 * releasing a node always returns the graph to the authored arrangement.
 */

/** Per-node drift seeds. Phase-shifted so no two nodes move together. */
export interface DriftParams {
  fx: number;
  px: number;
  fy: number;
  py: number;
}

/**
 * Deterministic drift params from a 32-bit hash. Two sines per axis, periods
 * between ~20s and ~50s: slow enough to read as alive rather than jittery.
 */
export function driftParams(seed: number): DriftParams {
  const rand = (salt: number) => {
    let x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  return {
    fx: 0.00013 + rand(1) * 0.00012,
    px: rand(2) * Math.PI * 2,
    fy: 0.00011 + rand(3) * 0.00011,
    py: rand(4) * Math.PI * 2,
  };
}

/**
 * Displacement for one node at time `t` (ms) and amplitude `amp` (world px).
 * Four terms, two per axis, so the path is a slow Lissajous rather than a
 * straight line swinging back and forth.
 */
export function driftOffset(
  p: DriftParams,
  t: number,
  amp: number
): { dx: number; dy: number } {
  if (amp === 0) return { dx: 0, dy: 0 };
  const dx =
    Math.sin(t * p.fx + p.px) * amp + Math.sin(t * p.fx * 2.7 + p.px) * amp * 0.4;
  const dy =
    Math.cos(t * p.fy + p.py) * amp * 0.9 + Math.cos(t * p.fy * 2.3 + p.py) * amp * 0.35;
  return { dx, dy };
}

/**
 * Breathing radius multiplier, 1 ± `amount`. Applied to the node's halo so the
 * ambient pulse reads without moving anything — a still graph can still breathe.
 */
export function breatheScale(t: number, periodMs: number, phase: number, amount: number) {
  if (amount === 0) return 1;
  return 1 + Math.sin((t / periodMs) * Math.PI * 2 + phase) * amount;
}

/** Adjacency list from the edge list, both as CSR-style flat arrays. */
export function buildAdjacency(
  edgeS: Int32Array,
  edgeT: Int32Array,
  edgeCount: number,
  nodeCount: number
): { start: Int32Array; neighbours: Int32Array } {
  const degree = new Int32Array(nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    degree[edgeS[e]]++;
    degree[edgeT[e]]++;
  }
  const start = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) start[i + 1] = start[i] + degree[i];

  const cursor = Int32Array.from(start.subarray(0, nodeCount));
  const neighbours = new Int32Array(start[nodeCount]);
  for (let e = 0; e < edgeCount; e++) {
    neighbours[cursor[edgeS[e]]++] = edgeT[e];
    neighbours[cursor[edgeT[e]]++] = edgeS[e];
  }
  return { start, neighbours };
}

export interface PropagationOptions {
  /** Share of the drag a direct neighbour receives. */
  neighbourShare: number;
  /** Share a second-hop node receives (of the neighbour's share). */
  secondHopShare: number;
  /** Hard cap on hops. 2 is plenty; 3+ is invisible. */
  hops: number;
  /** Stop spreading past this world distance from the dragged node. */
  maxDistance: number;
}

export const DEFAULT_PROPAGATION: PropagationOptions = {
  neighbourShare: 0.42,
  secondHopShare: 0.34,
  hops: 2,
  maxDistance: Number.POSITIVE_INFINITY,
};

/**
 * Accumulate one drag step's propagation into `out` (interleaved x/y, one entry
 * per node). This is a BFS over the adjacency, each hop attenuated, so the
 * whole cost is O(edges) once per pointer move — not per frame per node.
 *
 * The dragged node itself is written with the full displacement, which is what
 * makes it feel attached to the finger rather than to a spring.
 */
export function propagate(
  dragIndex: number,
  dx: number,
  dy: number,
  dragX: number,
  dragY: number,
  adj: { start: Int32Array; neighbours: Int32Array },
  nodeCount: number,
  /**
   * Interleaved world positions [x0,y0,x1,y1,...] — the SAME layout the painter
   * and the drag handler use. Taking separate nodeX/nodeY arrays here is what
   * previously allowed a caller to hand the same buffer for both and collapse
   * the graph onto a diagonal.
   */
  positions: Float64Array,
  out: Float64Array,
  opts: PropagationOptions = DEFAULT_PROPAGATION
): void {
  out.fill(0);
  out[dragIndex * 2] = dx;
  out[dragIndex * 2 + 1] = dy;

  let frontier = new Set<number>([dragIndex]);
  let share = 1;

  for (let hop = 1; hop <= opts.hops; hop++) {
    share *= hop === 1 ? opts.neighbourShare : opts.secondHopShare;
    if (share < 0.01) return;
    const next = new Set<number>();

    for (const node of frontier) {
      const from = adj.start[node];
      const to = adj.start[node + 1];
      for (let a = from; a < to; a++) {
        const nb = adj.neighbours[a];
        if (out[nb * 2] !== 0 || out[nb * 2 + 1] !== 0) continue;
        const ddx = positions[nb * 2] - dragX;
        const ddy = positions[nb * 2 + 1] - dragY;
        if (ddx * ddx + ddy * ddy > opts.maxDistance * opts.maxDistance) continue;
        out[nb * 2] = dx * share;
        out[nb * 2 + 1] = dy * share;
        next.add(nb);
      }
    }
    if (next.size === 0) return;
    frontier = next;
  }
  void nodeCount;
}

/**
 * Compose the painted positions: home + propagated + drift.
 *
 * Written into a caller-owned buffer so a frame allocates nothing. `amp === 0`
 * short-circuits to a plain copy, which is what an idle `low` graph does.
 */
export function composeRenderPositions(
  home: Float64Array,
  out: Float64Array,
  propagated: Float64Array,
  drift: Float64Array | null,
  count: number
): void {
  if (!drift) {
    for (let i = 0; i < count * 2; i++) out[i] = home[i] + propagated[i];
    return;
  }
  for (let i = 0; i < count * 2; i++) {
    out[i] = home[i] + propagated[i] + drift[i];
  }
}

/** Fill a drift buffer for time `t`. No-op buffer contents when amp is 0. */
export function fillDrift(
  params: DriftParams[],
  out: Float64Array,
  t: number,
  amp: number
): void {
  if (amp === 0) {
    out.fill(0);
    return;
  }
  for (let i = 0; i < params.length; i++) {
    const { dx, dy } = driftOffset(params[i], t, amp);
    out[i * 2] = dx;
    out[i * 2 + 1] = dy;
  }
}

/**
 * Ease a propagated offset back to zero after release.
 *
 * `k` is the per-frame decay. Returns the largest remaining magnitude, so the
 * caller can stop animating once the graph has settled — otherwise a released
 * drag would leave an idle loop running forever.
 */
export function decayPropagation(propagated: Float64Array, k: number): number {
  let max = 0;
  for (let i = 0; i < propagated.length; i += 2) {
    const x = propagated[i] * k;
    const y = propagated[i + 1] * k;
    // Snap to zero once invisible, so it never asymptotes forever.
    propagated[i] = Math.abs(x) < 0.05 ? 0 : x;
    propagated[i + 1] = Math.abs(y) < 0.05 ? 0 : y;
    const m = Math.abs(propagated[i]) + Math.abs(propagated[i + 1]);
    if (m > max) max = m;
  }
  return max;
}
