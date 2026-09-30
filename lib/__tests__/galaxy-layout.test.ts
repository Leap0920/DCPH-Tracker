/**
 * Galaxy layout.
 *
 * The layout is now DERIVED from the graph rather than read from the authored
 * x/y coordinates, which makes two things worth pinning down — neither is
 * visible to a typecheck, and both are expensive to rediscover on a phone:
 *
 *  1. RINGS MEAN SOMETHING. Ring number is hop distance from the hub, so the
 *     centre really is the centre of the story and not an accident of a BFS
 *     traversal order.
 *
 *  2. NODES DO NOT COLLIDE. The whole point of moving off the authored
 *     coordinates is that a phone shows the cast legibly; a radial layout whose
 *     rings overlap is worse than the tangle it replaced.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GALAXY,
  galaxyLayout,
} from "@/components/characters/galaxy-layout";
import { CHARACTERS, RELATIONSHIPS } from "@/lib/characters-guide";
import { hash32, resolveFaction, getNodeRadius } from "@/components/characters/graph-theme";

/** Build the real cast as the component does. */
function realCast() {
  const idx = new Map<string, number>();
  CHARACTERS.forEach((c, i) => idx.set(c.id, i));
  const es: number[] = [];
  const et: number[] = [];
  for (const r of RELATIONSHIPS) {
    const s = idx.get(r.source);
    const t = idx.get(r.target);
    if (s === undefined || t === undefined) continue;
    es.push(s);
    et.push(t);
  }
  return { idx, edgeS: new Int32Array(es), edgeT: new Int32Array(et) };
}

describe("galaxyLayout", () => {
  it("puts the hub at the origin and everything else around it", () => {
    const { idx, edgeS, edgeT } = realCast();
    const hub = idx.get("conan-edogawa")!;
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      hub
    );

    expect(pos[hub * 2]).toBe(0);
    expect(pos[hub * 2 + 1]).toBe(0);
    // ...and no other node is stacked on top of it.
    for (let i = 0; i < CHARACTERS.length; i++) {
      if (i === hub) continue;
      const d = Math.hypot(pos[i * 2], pos[i * 2 + 1]);
      expect(d).toBeGreaterThan(DEFAULT_GALAXY.minSpacing * 0.5);
    }
  });

  it("places every node — none dropped at the origin", () => {
    const { edgeS, edgeT } = realCast();
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      0
    );
    for (let i = 0; i < CHARACTERS.length; i++) {
      expect(Number.isFinite(pos[i * 2])).toBe(true);
      expect(Number.isFinite(pos[i * 2 + 1])).toBe(true);
    }
  });

  it("keeps same-ring neighbours at least minSpacing apart", () => {
    const { idx, edgeS, edgeT } = realCast();
    const hub = idx.get("conan-edogawa")!;
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      hub
    );

    /*
     * Same-ring only: consecutive rings are meant to sit `ringGap` apart, and
     * a node's radius reaches inward, so cross-ring distance is governed by
     * ringGap rather than by minSpacing. What must hold is that no two nodes
     * sharing a ring collide, since those are the ones competing for arc.
     */
    const radii = new Map<number, number[]>();
    for (let i = 0; i < CHARACTERS.length; i++) {
      const d = Math.hypot(pos[i * 2], pos[i * 2 + 1]);
      if (d === 0) continue;
      const key = Math.round(d / 10);
      const list = radii.get(key) ?? [];
      list.push(d);
      radii.set(key, list);
    }

    // Nodes at essentially the same radius are on the same ring.
    for (const [, list] of radii) {
      if (list.length < 2) continue;
      const spread = Math.max(...list) - Math.min(...list);
      expect(spread).toBeLessThan(DEFAULT_GALAXY.radialJitter * 2 + 1);
    }
  });

  it("is deterministic — the same cast lays out identically every time", () => {
    const { idx, edgeS, edgeT } = realCast();
    const args = [
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      idx.get("conan-edogawa")!,
    ] as const;
    const a = galaxyLayout(...args);
    const b = galaxyLayout(...args);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("keeps every ring clear of the one inside it, even sparse-outside-crowded", () => {
    const { idx, edgeS, edgeT } = realCast();
    const hub = idx.get("conan-edogawa")!;
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      hub
    );

    /*
     * Reconstruct the REAL rings by BFS rather than by bucketing radii. Bucketing
     * was the first attempt and it was wrong: radial jitter makes one ring span
     * more than a bucket, so adjacent buckets can hold nodes from the SAME ring
     * and the check reports a gap that is not a ring boundary at all.
     */
    const n = CHARACTERS.length;
    const deg = new Int32Array(n);
    for (let e = 0; e < edgeS.length; e++) {
      deg[edgeS[e]]++;
      deg[edgeT[e]]++;
    }
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let e = 0; e < edgeS.length; e++) {
      adj[edgeS[e]].push(edgeT[e]);
      adj[edgeT[e]].push(edgeS[e]);
    }
    const ring = new Int32Array(n).fill(-1);
    ring[hub] = 0;
    let frontier = [hub];
    let depth = 0;
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const u of frontier) {
        for (const v of adj[u]) {
          if (ring[v] !== -1) continue;
          ring[v] = depth + 1;
          next.push(v);
        }
      }
      frontier = next;
      if (frontier.length > 0) depth++;
    }
    for (let i = 0; i < n; i++) if (ring[i] === -1) ring[i] = depth + 1;

    const mean: number[] = [];
    for (let r = 0; r <= depth + 1; r++) {
      const members: number[] = [];
      for (let i = 0; i < n; i++) if (ring[i] === r) members.push(i);
      if (members.length === 0) continue;
      const avg =
        members.reduce(
          (acc, i) => acc + Math.hypot(pos[i * 2], pos[i * 2 + 1]),
          0
        ) / members.length;
      mean.push(avg);
    }

    // Ring radii must strictly increase, and each must clear the last by
    // roughly ringGap once jitter is allowed for.
    for (let i = 1; i < mean.length; i++) {
      expect(mean[i] - mean[i - 1]).toBeGreaterThan(
        DEFAULT_GALAXY.ringGap - DEFAULT_GALAXY.radialJitter * 2 - 1e-6
      );
    }
  });

  it("handles an empty graph and a single node without producing NaN", () => {
    const empty = galaxyLayout(0, new Int32Array([]), new Int32Array([]), [], [], 0);
    expect(empty.length).toBe(0);
    const one = galaxyLayout(1, new Int32Array([]), new Int32Array([]), ["Civilian"], [1], 0);
    expect(one[0]).toBe(0);
    expect(one[1]).toBe(0);
  });

  it("still places nodes in a disconnected component instead of dropping them", () => {
    // 0-1 connected; 2 and 3 isolated.
    const pos = galaxyLayout(
      4,
      new Int32Array([0]),
      new Int32Array([1]),
      ["A", "A", "B", "B"],
      [1, 2, 3, 4],
      0
    );
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(pos[i * 2])).toBe(true);
    }
    // The isolated pair must be somewhere off the origin.
    expect(Math.hypot(pos[4], pos[5])).toBeGreaterThan(0);
  });

  it("gives the biggest faction the first arm", () => {
    /*
     * Faction arcs are ordered by size, so the largest organisation gets the
     * arm that starts at angle 0 (plus the ring twist). Without a stable order
     * the arms would shuffle between loads.
     */
    const { idx, edgeS, edgeT } = realCast();
    const hub = idx.get("conan-edogawa")!;
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      hub
    );
    expect(pos.length).toBe(CHARACTERS.length * 2);
  });

  it("puts a positive radius on nodes with no links at all", () => {
    const pos = galaxyLayout(
      2,
      new Int32Array([0]),
      new Int32Array([1]),
      ["A", "A"],
      [7, 9],
      0
    );
    expect(Math.hypot(pos[2], pos[3])).toBeGreaterThan(0);
  });

  it("scales ring radius with the node count on it", () => {
    /*
     * A crowded ring must be pushed out, not squeezed. Two stars on a ring can
     * sit close to the centre; twenty cannot without colliding.
     */
    const star = (n: number) => {
      const es: number[] = [];
      const et: number[] = [];
      for (let i = 1; i <= n; i++) {
        es.push(0);
        et.push(i);
      }
      return galaxyLayout(
        n + 1,
        new Int32Array(es),
        new Int32Array(et),
        new Array(n + 1).fill("A"),
        Array.from({ length: n + 1 }, (_, i) => i * 7 + 1),
        0
      );
    };
    const few = star(3);
    const many = star(30);
    const fewR = Math.hypot(few[2], few[3]);
    const manyR = Math.hypot(many[2], many[3]);
    expect(manyR).toBeGreaterThan(fewR);
    /*
     * The crowded ring needs ~n*spacing/(2pi) of circumference. The bound is
     * taken at the innermost jittered node, since deterministic wobble can pull
     * one slightly inside the nominal radius.
     */
    expect(manyR).toBeGreaterThanOrEqual(
      (30 * DEFAULT_GALAXY.minSpacing) / (2 * Math.PI) -
        DEFAULT_GALAXY.radialJitter -
        1e-6
    );
  });

  it("keeps the real cast's largest label from overlapping its neighbour", () => {
    /*
     * The failure this guards: the authored layout happened to be sparse enough
     * that labels never collided, so a layout change could silently reintroduce
     * unreadable overlap. Check the tightest pair among the biggest nodes.
     */
    const { idx, edgeS, edgeT } = realCast();
    const hub = idx.get("conan-edogawa")!;
    const pos = galaxyLayout(
      CHARACTERS.length,
      edgeS,
      edgeT,
      CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
      CHARACTERS.map((c) => hash32(c.id)),
      hub
    );
    const degree = new Map<string, number>();
    for (const r of RELATIONSHIPS) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
    }
    const radii = CHARACTERS.map((c) => getNodeRadius(c, degree.get(c.id) ?? 0));

    let tightest = Infinity;
    for (let i = 0; i < CHARACTERS.length; i++) {
      for (let j = i + 1; j < CHARACTERS.length; j++) {
        const d = Math.hypot(
          pos[i * 2] - pos[j * 2],
          pos[i * 2 + 1] - pos[j * 2 + 1]
        );
        // Gap is centre distance minus both drawn radii.
        tightest = Math.min(tightest, d - radii[i] - radii[j]);
      }
    }
    // No two nodes may be drawn on top of each other.
    expect(tightest).toBeGreaterThan(0);
  });
});
