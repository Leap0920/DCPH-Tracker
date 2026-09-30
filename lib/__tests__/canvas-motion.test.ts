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
  it("carries the local hierarchy — children and grandchildren follow", () => {
    // A chain: 0-1-2-3-4-5-6-7-8
    const edgeS = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const edgeT = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const n = 9;
    const adj = buildAdjacency(edgeS, edgeT, edgeS.length, n);
    const positions = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) positions[i * 2] = i * 100;

    const out = new Float64Array(n * 2);
    propagate(0, 100, 0, 0, 0, adj, n, positions, out, DEFAULT_PROPAGATION);

    // "Move the head and the children come too": a direct child follows at the
    // configured share, and each hop after it moves strictly less.
    expect(out[2]).toBeGreaterThanOrEqual(
      100 * DEFAULT_PROPAGATION.neighbourShare - 1e-9
    );
    expect(out[4]).toBeGreaterThan(0);
    expect(out[4]).toBeLessThan(out[2]);
    expect(out[6]).toBeLessThan(out[4]);
  });

  /*
   * The "screen moves while I move the nodes" report.
   *
   * A 30% floor over a 24-hop budget meant EVERY node in the component shifted
   * by at least 30% of the drag, so pulling one node slid the entire picture.
   * Lowering the floor to 6% was not enough — measured on the real cast that
   * still moved 102 of 103 nodes, i.e. still the whole screen. The reach must
   * now END: a direct child clearly follows, and past the hop budget a node is
   * untouched rather than nudged.
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
    expect(child).toBeGreaterThan(50);   // clearly follows
    // EXACTLY still, not merely "small". A non-zero floor is what made an
    // earlier fix fail to help: at 6% over 12 hops, 99% of the cast still
    // drifted with the finger, which is indistinguishable from the viewport
    // moving.
    expect(distant).toBe(0);
  });

  /*
   * The regression that matters, measured on the REAL cast.
   *
   * Every synthetic chain above passes under a range of tunings, so none of
   * them would have caught the actual bug: with 0.9/0.72 over 12 hops, dragging
   * Conan moved 102 of 103 characters and 86 of them by more than half the
   * drag. The cast is one connected component, so a "gently attenuating" pull
   * never dies out — and a picture where 99% of the nodes translate with the
   * finger is indistinguishable from the camera panning.
   *
   * The assertion is therefore about PROPORTION, not about any single node.
   */
  it("does not translate most of the real cast when one node is dragged", async () => {
    const { CHARACTERS, RELATIONSHIPS } = await import("@/lib/characters-guide");
    const n = CHARACTERS.length;
    const idx = new Map<string, number>();
    CHARACTERS.forEach((c, i) => idx.set(c.id, i));

    const es: number[] = [];
    const et: number[] = [];
    const degree = new Map<number, number>();
    for (const r of RELATIONSHIPS) {
      const s = idx.get(r.source);
      const t = idx.get(r.target);
      if (s === undefined || t === undefined) continue;
      es.push(s);
      et.push(t);
      degree.set(s, (degree.get(s) ?? 0) + 1);
      degree.set(t, (degree.get(t) ?? 0) + 1);
    }
    const adj = buildAdjacency(
      new Int32Array(es),
      new Int32Array(et),
      es.length,
      n
    );
    const pos = new Float64Array(n * 2);
    CHARACTERS.forEach((c, i) => {
      pos[i * 2] = c.x ?? 0;
      pos[i * 2 + 1] = c.y ?? 0;
    });

    // The worst case: the highest-degree node, Conan, pulls the most nodes.
    const hub = [...degree.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const out = new Float64Array(n * 2);
    propagate(
      hub,
      200,
      0,
      pos[hub * 2],
      pos[hub * 2 + 1],
      adj,
      n,
      pos,
      out,
      DEFAULT_PROPAGATION
    );

    let substantial = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(out[i * 2]) > 100) substantial++; // >50% of the drag
    }
    // The hub is the worst case in the data. Even so, the nodes that follow it
    // by more than half the drag must be its own neighbourhood, not the cast.
    expect(substantial).toBeLessThan(n * 0.4);
    expect(substantial).toBeGreaterThan(0);
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
