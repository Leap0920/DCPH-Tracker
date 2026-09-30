/**
 * Motion: ambient drift and drag propagation.
 *
 * Two properties worth pinning down, because both are invisible to a typecheck
 * and expensive to rediscover on a phone:
 *
 *  1. PROPAGATION IS BOUNDED AND ATTENUATED. Dragging one node must tug its web
 *     without launching a whole-graph reflow, and it must never touch a node it
 *     is not connected to.
 *
 *  2. DRIFT HOMES. The settled layout is never mutated by ambient motion, so the
 *     graph cannot slowly wander off-canvas over a long session — the failure
 *     mode that makes "it looks fine for a minute then everything is gone".
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPAGATION,
  breatheScale,
  buildAdjacency,
  composeRenderPositions,
  decayPropagation,
  driftOffset,
  driftParams,
  fillDrift,
  propagate,
} from "@/components/characters/canvas-motion";

/** A tiny graph: 0-1-2-3 chained, plus 4 joined to 2. */
function chain() {
  const edgeS = new Int32Array([0, 1, 2, 2]);
  const edgeT = new Int32Array([1, 2, 3, 4]);
  const n = 5;
  const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
  const positions = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    positions[i * 2] = i * 100;
    positions[i * 2 + 1] = 0;
  }
  return { adj, n, positions, edgeS, edgeT };
}

describe("buildAdjacency", () => {
  it("links each edge in both directions", () => {
    const { adj, n } = chain();
    expect(adj.start.length).toBe(n + 1);
    // node 0 connects only to 1
    const n0 = Array.from(adj.neighbours.slice(adj.start[0], adj.start[1]));
    expect(n0).toEqual([1]);
    // node 2 connects to 1, 3 and 4 — the busiest node
    const n2 = Array.from(adj.neighbours.slice(adj.start[2], adj.start[3])).sort();
    expect(n2).toEqual([1, 3, 4]);
  });

  it("handles isolated nodes without crashing", () => {
    const adj = buildAdjacency(new Int32Array([]), new Int32Array([]), 0, 3);
    expect(adj.start[3]).toBe(0);
    expect(adj.neighbours.length).toBe(0);
  });
});

describe("propagate", () => {
  it("does NOT write the dragged node — the caller owns its position", () => {
    const { adj, n, positions } = chain();
    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);
    // Writing it here would double-apply the displacement once the buffers are
    // summed for painting: home already moved by the full drag.
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("moves a direct neighbour by the configured share", () => {
    const { adj, n, positions } = chain();
    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);
    expect(out[2]).toBeCloseTo(10 * DEFAULT_PROPAGATION.neighbourShare, 6);
  });

  /*
   * The reason this was rewritten. With hops: 2 and 0.42 / 0.34 attenuation, a
   * great-grandchild moved 1.6% of the drag and anything past five hops did not
   * move at all — the reported "only the head moves, children stay put".
   */
  it("carries the whole connected structure, not just two hops", () => {
    // A longer chain: 0-1-2-3-4-5-6
    const edgeS = new Int32Array([0, 1, 2, 3, 4, 5]);
    const edgeT = new Int32Array([1, 2, 3, 4, 5, 6]);
    const n = 7;
    const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
    const positions = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) positions[i * 2] = i * 100;

    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);

    // Hop 6 — a great-great-great-grandchild — must still visibly move. Under
    // the old 2-hop rule this was exactly zero.
    const deepest = out[12];
    expect(deepest).toBeGreaterThan(0);
    // It is still attenuating here (0.92 * 0.88^5 ≈ 48%), and the floor only
    // takes over past that. Either way it must never fall below the floor.
    expect(deepest).toBeGreaterThanOrEqual(10 * DEFAULT_PROPAGATION.minShare - 1e-9);
  });

  /*
   * The "screen moves while I move the nodes" report.
   *
   * A 30% floor over a 24-hop budget meant EVERY node in the component shifted
   * by at least 30% of the drag, so pulling one node slid the entire picture.
   * The floor must now be low enough that the far side of the graph barely
   * stirs, while a direct child still clearly follows.
   */
  it("keeps distant branches nearly still so the view does not slide", () => {
    // A long chain: 0-1-2-3-4-5-6-7-8
    const edgeS = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const edgeT = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const n = 9;
    const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
    const positions = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) positions[i * 2] = i * 100;

    const out = new Float64Array(n * 2);
    propagate(0, 100, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);

    const child = out[2];        // hop 1
    const distant = out[16];     // hop 8
    expect(child).toBeGreaterThan(80);          // clearly follows
    expect(Math.abs(distant)).toBeLessThan(12); // barely moves
    expect(Math.abs(distant) / child).toBeLessThan(0.2);
  });

  it("attenuates with distance rather than moving everything equally", () => {
    const edgeS = new Int32Array([0, 1, 2, 3]);
    const edgeT = new Int32Array([1, 2, 3, 4]);
    const n = 5;
    const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
    const positions = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) positions[i * 2] = i * 100;

    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);

    const hop1 = out[2];
    const hop4 = out[8];
    expect(hop1).toBeGreaterThan(hop4);
    expect(hop4).toBeGreaterThan(0);
  });

  it("never touches a node outside the connected component", () => {
    const dis = buildAdjacency(new Int32Array([]), new Int32Array([]), 0, 3);
    const out = new Float64Array(3 * 2);
    const pos = new Float64Array(3 * 2);
    propagate(0, 10, 0, 0, 0, dis, 3, pos, out, DEFAULT_PROPAGATION);
    expect(out[2]).toBe(0);
    expect(out[4]).toBe(0);
  });

  it("visits each node once even when the graph has cycles", () => {
    // A triangle plus a tail — the classic re-visit trap.
    const edgeS = new Int32Array([0, 1, 0, 2]);
    const edgeT = new Int32Array([1, 2, 2, 3]);
    const n = 4;
    const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
    const positions = new Float64Array(n * 2);
    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);
    // Every connected node got exactly one value — none is a double-count.
    for (const v of [out[2], out[4], out[6]]) {
      expect(v).toBeLessThanOrEqual(10);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("respects the hop cap", () => {
    const { adj, n, positions } = chain();
    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, {
      ...DEFAULT_PROPAGATION,
      hops: 1,
    });
    // With a single hop, node 2 (two away) must not move.
    expect(out[4]).toBe(0);
    // But its direct neighbour still does.
    expect(out[2]).toBeGreaterThan(0);
  });

  it("is bounded by maxDistance", () => {
    const { adj, n, positions } = chain();
    const out = new Float64Array(n * 2);
    propagate(0, 10, 0, 0, 0, adj, n, positions, out, {
      ...DEFAULT_PROPAGATION,
      maxDistance: 10,
    });
    // Nothing is within 10 world px of node 0 except itself.
    expect(out[2]).toBe(0);
  });

  it("clears the buffer first, so a previous drag cannot leak through", () => {
    const dis = buildAdjacency(new Int32Array([]), new Int32Array([]), 0, 5);
    const out = new Float64Array(5 * 2).fill(999);
    const pos = new Float64Array(5 * 2);
    propagate(0, 10, 0, 0, 0, dis, 5, pos, out, DEFAULT_PROPAGATION);
    expect(Array.from(out)).toEqual(new Array(10).fill(0));
  });
});

describe("decayPropagation", () => {
  it("shrinks towards zero and eventually reports settled", () => {
    const buf = new Float64Array([10, -10, 4, 4]);
    let guard = 0;
    let max = decayPropagation(buf, 0.9);
    while (max > 0.05 && guard++ < 500) {
      max = decayPropagation(buf, 0.9);
    }
    expect(guard).toBeLessThan(500);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);
  });

  it("reports zero immediately when there is nothing to settle", () => {
    const buf = new Float64Array(8);
    expect(decayPropagation(buf, 0.9)).toBe(0);
  });
});

describe("drift", () => {
  it("gives different nodes different phases, so they never move in lockstep", () => {
    const a = driftParams(1);
    const b = driftParams(2);
    expect(a.px).not.toBe(b.px);
    expect(a.py).not.toBe(b.py);
  });

  it("is deterministic for a given seed, so the layout is stable across reloads", () => {
    expect(driftParams(42)).toEqual(driftParams(42));
  });

  it("stays inside the amplitude envelope", () => {
    const p = driftParams(7);
    const amp = 2.4;
    let maxSeen = 0;
    for (let t = 0; t < 200000; t += 137) {
      const { dx, dy } = driftOffset(p, t, amp);
      maxSeen = Math.max(maxSeen, Math.abs(dx), Math.abs(dy));
    }
    // Two terms per axis at full weight would be 1.4 * amp; assert we stay near
    // that and never explode.
    expect(maxSeen).toBeLessThanOrEqual(amp * 1.45);
  });

  it("is exactly zero at zero amplitude, which is the still-graph case", () => {
    const p = driftParams(3);
    expect(driftOffset(p, 12345, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("fills a buffer without touching the settled layout", () => {
    const params = [driftParams(1), driftParams(2)];
    const out = new Float64Array(4);
    fillDrift(params, out, 5000, 2.4);
    expect(out.some((v) => v !== 0)).toBe(true);
    // Zero amplitude must blank it rather than leave stale values behind.
    fillDrift(params, out, 9000, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
});

describe("composeRenderPositions", () => {
  it("sums home + propagated + drift into the output", () => {
    const home = new Float64Array([100, 200]);
    const prop = new Float64Array([5, -5]);
    const drift = new Float64Array([1, 2]);
    const out = new Float64Array(2);
    composeRenderPositions(home, out, prop, drift, 1);
    expect(out[0]).toBe(106);
    expect(out[1]).toBe(197);
  });

  it("never mutates the home buffer — the graph cannot wander off", () => {
    const home = new Float64Array([100, 200]);
    const prop = new Float64Array([5, -5]);
    const out = new Float64Array(2);
    composeRenderPositions(home, out, prop, null, 1);
    expect(Array.from(home)).toEqual([100, 200]);
  });

  it("treats a null drift buffer as zero drift", () => {
    const home = new Float64Array([1, 2]);
    const prop = new Float64Array([0, 0]);
    const out = new Float64Array(2);
    composeRenderPositions(home, out, prop, null, 1);
    expect(Array.from(out)).toEqual([1, 2]);
  });
});

describe("breatheScale", () => {
  it("oscillates within the requested envelope", () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 10000; t += 37) {
      const v = breatheScale(t, 4200, 0, 0.16);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(1 - 0.16 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1 + 0.16 + 1e-9);
  });

  it("is exactly 1 at zero amount, so reduced motion changes nothing", () => {
    expect(breatheScale(1234, 4200, 0.5, 0)).toBe(1);
  });
});
