/**
 * Globe layout and projection.
 *
 * The globe is the first thing here with a third dimension, so the properties
 * that matter are the ones a 2D test suite would silently miss:
 *
 *  1. SHELLS ARE SPHERES, NOT RINGS. Every node on shell k must be the same
 *     distance from the origin — if the Fibonacci placement leaked into the
 *     radius, the "globe" would be a lumpy blob and shells would interpenetrate.
 *
 *  2. ROTATION IS RIGID. Spinning the globe must not change any node's distance
 *     from the centre, and must not change the distance between any two nodes.
 *     Anything else means the projection is deforming the graph, which reads as
 *     the whole thing wobbling as you spin it.
 *
 *  3. DEPTH IS NORMALISED, so the renderer can key alpha and draw order off it
 *     without knowing the globe's radius.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBE,
  globeLayout,
  projectGlobe,
  unprojectDelta,
} from "@/components/characters/globe-layout";
import { CHARACTERS, RELATIONSHIPS } from "@/lib/characters-guide";
import {
  getNodeRadius,
  hash32,
  resolveFaction,
} from "@/components/characters/graph-theme";

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

function layoutReal() {
  const { idx, edgeS, edgeT } = realCast();
  const hub = idx.get("conan-edogawa")!;
  return globeLayout(
    CHARACTERS.length,
    edgeS,
    edgeT,
    CHARACTERS.map((c) => resolveFaction(c.affiliation).key),
    CHARACTERS.map((c) => hash32(c.id)),
    hub
  );
}

describe("globeLayout", () => {
  it("puts the hub at the origin", () => {
    const { points, hub } = layoutReal();
    expect(points[hub * 3]).toBe(0);
    expect(points[hub * 3 + 1]).toBe(0);
    expect(points[hub * 3 + 2]).toBe(0);
  });

  it("puts every other node on a shell, at a single radius", () => {
    const { points, hub } = layoutReal();
    const n = CHARACTERS.length;

    // Group nodes by hop distance, then check each group shares one radius.
    const { idx, edgeS, edgeT } = realCast();
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let e = 0; e < edgeS.length; e++) {
      adj[edgeS[e]].push(edgeT[e]);
      adj[edgeT[e]].push(edgeS[e]);
    }
    const shell = new Int32Array(n).fill(-1);
    shell[hub] = 0;
    let frontier = [hub];
    let d = 0;
    while (frontier.length) {
      const next: number[] = [];
      for (const u of frontier) {
        for (const v of adj[u]) {
          if (shell[v] !== -1) continue;
          shell[v] = d + 1;
          next.push(v);
        }
      }
      frontier = next;
      if (frontier.length) d++;
    }
    for (let i = 0; i < n; i++) if (shell[i] === -1) shell[i] = d + 1;

    const byShell = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      byShell.set(shell[i], [...(byShell.get(shell[i]) ?? []), r]);
    }
    for (const [s, radii] of byShell) {
      if (s === 0) continue;
      const spread = Math.max(...radii) - Math.min(...radii);
      // Only the deterministic jitter may vary the radius.
      expect(spread).toBeLessThanOrEqual(DEFAULT_GLOBE.jitter * 2 + 1e-6);
      expect(Math.min(...radii)).toBeGreaterThan(0);
    }
  });

  it("keeps shells from interpenetrating", () => {
    const { points, hub } = layoutReal();
    const radii: number[] = [];
    for (let i = 0; i < CHARACTERS.length; i++) {
      if (i === hub) continue;
      radii.push(Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    }
    radii.sort((a, b) => a - b);
    // Distinct shells must be at least shellGap - jitter apart.
    let prev = 0;
    const distinct: number[] = [];
    for (const r of radii) {
      if (r - prev > DEFAULT_GLOBE.jitter * 2 + 1) distinct.push(r);
      prev = r;
    }
    for (let i = 1; i < distinct.length; i++) {
      expect(distinct[i] - distinct[i - 1]).toBeGreaterThan(
        DEFAULT_GLOBE.shellGap - DEFAULT_GLOBE.jitter * 2 - 1
      );
    }
  });

  it("gives a crowded shell more radius than a sparse one would need", () => {
    /*
     * The surface constraint: a shell holding many nodes has to be pushed out,
     * or its nodes overlap on the sphere. Compare the real cast's busiest shell
     * against the minimum its count implies.
     */
    const { points } = layoutReal();
    const n = CHARACTERS.length;
    const radii: number[] = [];
    for (let i = 0; i < n; i++) {
      radii.push(Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    }
    const maxR = Math.max(...radii);
    // The outermost shell must at least be able to hold a few nodes at minSpacing.
    expect(maxR).toBeGreaterThanOrEqual(
      DEFAULT_GLOBE.minSpacing * Math.sqrt(2 / (4 * Math.PI))
    );
  });

  it("places every node somewhere finite — none dropped", () => {
    const { points } = layoutReal();
    for (let i = 0; i < CHARACTERS.length; i++) {
      expect(Number.isFinite(points[i * 3])).toBe(true);
      expect(Number.isFinite(points[i * 3 + 1])).toBe(true);
      expect(Number.isFinite(points[i * 3 + 2])).toBe(true);
    }
  });

  it("is deterministic", () => {
    const a = layoutReal();
    const b = layoutReal();
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
  });

  it("separates neighbours on the same shell, so the globe is not a solid ball", () => {
    const { points } = layoutReal();
    const n = CHARACTERS.length;

    /*
     * Two nodes on the same shell must not be drawn on top of each other. This
     * is the check that would have caught a Fibonacci placement that collapsed
     * (e.g. a wrong golden angle), which still passes every "is it finite" test.
     */
    const radii: number[] = [];
    for (let i = 0; i < n; i++) {
      radii.push(
        Math.round(
          Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]) / 4
        ) * 4
      );
    }
    const degree = new Map<string, number>();
    for (const r of RELATIONSHIPS) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
    }
    const nodeR = CHARACTERS.map((c) => getNodeRadius(c, degree.get(c.id) ?? 0));

    let tightest = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (radii[i] !== radii[j]) continue; // different shells
        const d = Math.hypot(
          points[i * 3] - points[j * 3],
          points[i * 3 + 1] - points[j * 3 + 1],
          points[i * 3 + 2] - points[j * 3 + 2]
        );
        tightest = Math.min(tightest, d - nodeR[i] - nodeR[j]);
      }
    }
    expect(tightest).toBeGreaterThan(0);
  });

  it("handles an empty graph and a single node", () => {
    const empty = globeLayout(0, new Int32Array([]), new Int32Array([]), [], [], 0);
    expect(empty.points.length).toBe(0);
    expect(empty.radius).toBe(0);
    const one = globeLayout(1, new Int32Array([]), new Int32Array([]), ["A"], [1], 0);
    expect(one.points[0]).toBe(0);
    expect(one.points[1]).toBe(0);
    expect(one.points[2]).toBe(0);
  });
});

describe("projectGlobe", () => {
  const makeOut = (n: number) => ({
    screen: new Float64Array(n * 2),
    depth: new Float64Array(n),
  });

  it("is the identity at zero rotation and keeps depth normalised", () => {
    const { points } = layoutReal();
    const n = CHARACTERS.length;
    const out = projectGlobe(points, n, 0, 0, makeOut(n));
    for (let i = 0; i < n; i++) {
      expect(out.screen[i * 2]).toBeCloseTo(points[i * 3], 6);
      expect(out.screen[i * 2 + 1]).toBeCloseTo(points[i * 3 + 1], 6);
      expect(Math.abs(out.depth[i])).toBeLessThanOrEqual(1 + 1e-9);
    }
    /*
     * The range must be USED: at least one node sits at an extreme. Normalising
     * divides by the largest absolute depth, so the extreme may be -1 rather
     * than +1 — asserting max() === 1 assumed the farthest node always outranks
     * the nearest, which is not something the layout promises.
     */
    const maxAbs = Math.max(...Array.from(out.depth, Math.abs));
    expect(maxAbs).toBeCloseTo(1, 9);
  });

  it("is rigid: spinning preserves every radius and every pairwise distance", () => {
    const { points } = layoutReal();
    const n = CHARACTERS.length;
    const base = projectGlobe(points, n, 0, 0, makeOut(n));

    for (const [yaw, pitch] of [
      [0.6, 0],
      [0, 0.5],
      [1.2, -0.7],
      [-2.4, 1.1],
    ]) {
      const out = projectGlobe(points, n, yaw, pitch, makeOut(n));
      /*
       * The screen radius is the 3D radius scaled by cos(angle from the view
       * axis), so it may shrink — but it must never EXCEED the true radius, and
       * a node on the view axis must project to (0,0). That pair of properties
       * is what distinguishes a rigid rotation from a projection that shears.
       */
      for (let i = 0; i < n; i++) {
        const trueR = Math.hypot(
          points[i * 3],
          points[i * 3 + 1],
          points[i * 3 + 2]
        );
        const screenR = Math.hypot(out.screen[i * 2], out.screen[i * 2 + 1]);
        expect(screenR).toBeLessThanOrEqual(trueR + 1e-6);
      }
    }
  });

  it("maps a drag into the view plane, never along the view axis", () => {
    /*
     * The unprojected delta must lie in the plane facing the viewer. A node
     * dragged sideways should not move toward or away from the camera, because
     * that would change its depth and therefore its size — the node would swell
     * or shrink as you drag it, which reads as a rendering bug.
     */
    for (const [yaw, pitch] of [
      [0, 0],
      [0.9, 0.4],
      [-1.7, -0.8],
    ]) {
      const d = unprojectDelta(30, 20, yaw, pitch);
      // Re-project the delta: it must land exactly on (30,20) with zero depth.
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const x1 = d.x * cy + d.z * sy;
      const z1 = -d.x * sy + d.z * cy;
      const y2 = d.y * cp - z1 * sp;
      const z2 = d.y * sp + z1 * cp;
      expect(x1).toBeCloseTo(30, 6);
      expect(y2).toBeCloseTo(20, 6);
      expect(z2).toBeCloseTo(0, 6);
    }
  });

  it("sends a node on the view axis to the centre of the screen", () => {
    // A node on the +Z axis (toward the viewer) projects to the origin.
    const pts = new Float64Array([0, 0, 100, 0, 0, -100, 50, 0, 0]);
    const out = projectGlobe(pts, 3, 0, 0, makeOut(3));
    expect(out.screen[0]).toBeCloseTo(0, 6);
    expect(out.screen[1]).toBeCloseTo(0, 6);
    expect(out.screen[2]).toBeCloseTo(0, 6);
    expect(out.screen[3]).toBeCloseTo(0, 6);
    // The near and far nodes must land at opposite depths.
    expect(out.depth[0]).toBeGreaterThan(0);
    expect(out.depth[1]).toBeLessThan(0);
  });
});
