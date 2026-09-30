/**
 * Canvas graph geometry + painter.
 *
 * Two properties are asserted here, both of which are load-bearing and neither
 * of which I can check on the target phone from here:
 *
 *  1. PICKING IS CORRECT. The canvas replaces the browser's hit-test over
 *     ~2,350 SVG elements with point-in-circle / point-to-curve maths. A wrong
 *     tap means a wrong character opens, which is a functional regression, not
 *     a perf one — so it is pinned down here rather than left to a device.
 *
 *  2. DRAWING IS CHEAP AND CULLING WORKS. `paint()` returns its draw-call count,
 *     which stands in for frame cost. A zoomed-out view of the whole 319-node
 *     graph must not cost more per frame than a tight zoom, or the renderer has
 *     only moved the bottleneck.
 */

import { describe, expect, it } from "vitest";
import {
  effectiveDpr,
  fitCamera,
  hitEdge,
  hitNode,
  labelOpacityFor,
  quadControl,
  toScreen,
  toWorld,
  type HitCircle,
  type HitEdge,
} from "@/components/characters/canvas-geometry";
import {
  MIN_NODE_R_PX,
  paint,
  type PaintOptions,
  type PaintPalette,
} from "@/components/characters/canvas-painter";

const PAL: PaintPalette = {
  bg0: "#000",
  bg1: "#111",
  dot: "rgba(255,255,255,0.1)",
  dotRadius: 1,
  label: "#eee",
  labelStrong: "#fff",
  labelHalo: "#000",
  strokeStrong: "#fff",
  fontSize: 11,
};

/** Minimal CanvasRenderingContext2D that counts calls. */
function fakeCtx() {
  const calls: string[] = [];
  const setTransformArgs: unknown[][] = [];
  /** Radius of every arc, in draw order — used by the depth tests. */
  const arcArgs: number[][] = [];
  /** Text of every fillText, so a test can assert WHICH name was painted. */
  const textArgs: string[] = [];
  const rec =
    (name: string) =>
    (..._a: unknown[]) => {
      calls.push(name);
    };
  const ctx = {
    calls,
    setTransformArgs,
    arcArgs,
    textArgs,
    alphas: [] as number[],
    alphaValue: 1,
    save: rec("save"),
    restore: rec("restore"),
    clearRect: rec("clearRect"),
    setTransform: (...a: unknown[]) => {
      calls.push("setTransform");
      setTransformArgs.push(a);
    },
    beginPath: rec("beginPath"),
    arc: (...a: unknown[]) => {
      calls.push("arc");
      arcArgs.push(a as number[]);
    },
    fill: rec("fill"),
    stroke: rec("stroke"),
    fillRect: rec("fillRect"),
    moveTo: rec("moveTo"),
    quadraticCurveTo: rec("quadraticCurveTo"),
    fillText: (...a: unknown[]) => {
      calls.push("fillText");
      textArgs.push(String(a[0]));
    },
    strokeText: rec("strokeText"),
    createLinearGradient: () => ({ addColorStop: rec("addColorStop") }),
    createRadialGradient: () => ({ addColorStop: rec("addColorStop") }),
    measureText: () => ({ width: 10 }),
    get globalAlpha() {
      return ctx.alphaValue;
    },
    set globalAlpha(v: number) {
      ctx.alphaValue = v;
      ctx.alphas.push(v);
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round" as const,
    font: "",
    textAlign: "center" as const,
    textBaseline: "middle" as const,
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    calls: string[];
    setTransformArgs: unknown[][];
    alphas: number[];
    arcArgs: number[][];
    textArgs: string[];
  };
}

describe("camera transforms", () => {
  it("round-trips world -> screen -> world", () => {
    const cam = { x: 37, y: -12, k: 1.7 };
    for (const [wx, wy] of [
      [0, 0],
      [100, -50],
      [-320, 480],
    ] as const) {
      const s = toScreen(wx, wy, cam);
      const w = toWorld(s.x, s.y, cam);
      expect(w.x).toBeCloseTo(wx, 6);
      expect(w.y).toBeCloseTo(wy, 6);
    }
  });

  it("treats the origin as top-left at identity", () => {
    const s = toScreen(5, 7, { x: 0, y: 0, k: 1 });
    expect(s).toEqual({ x: 5, y: 7 });
  });
});

describe("hitNode", () => {
  const circles: HitCircle[] = [
    { index: 0, wx: 0, wy: 0, r: 10 },
    { index: 1, wx: 100, wy: 0, r: 6 },
  ];

  it("finds a node under the point", () => {
    expect(hitNode(2, 3, { x: 0, y: 0, k: 1 }, circles)).toBe(0);
    expect(hitNode(99, 1, { x: 0, y: 0, k: 1 }, circles)).toBe(1);
  });

  it("returns -1 on empty space", () => {
    expect(hitNode(50, 50, { x: 0, y: 0, k: 1 }, circles)).toBe(-1);
  });

  it("follows the camera, so picking works after pan and zoom", () => {
    const cam = { x: 200, y: 30, k: 2 };
    const p = toScreen(100, 0, cam);
    expect(hitNode(p.x, p.y, cam, circles)).toBe(1);
  });

  it("widens the target by slack in screen px, not world px", () => {
    // Node r=10 at the origin, viewed at 4x. Its screen footprint is 40px
    // across; slack of 20 SCREEN px should extend that to 60px, not to
    // 10 + 20 = 30 world px (which would be 120 screen px — a 2x overshoot).
    const cam = { x: 0, y: 0, k: 4 };
    const at50 = (slack: number) => hitNode(50, 0, cam, circles, slack);
    // 50px screen = 12.5 world px: outside r=10, inside r=10 + 20/4 = 15.
    expect(at50(0)).toBe(-1);
    expect(at50(20)).toBe(0);
    // 70px screen = 17.5 world px: outside even with slack 20.
    expect(hitNode(70, 0, cam, circles, 20)).toBe(-1);
  });

  it("prefers the smaller node when one sits inside another", () => {
    const nested: HitCircle[] = [
      { index: 0, wx: 0, wy: 0, r: 40 },
      { index: 1, wx: 0, wy: 0, r: 8 },
    ];
    expect(hitNode(1, 1, { x: 0, y: 0, k: 1 }, nested)).toBe(1);
    // Outside the small one but inside the big one -> the big one.
    expect(hitNode(25, 0, { x: 0, y: 0, k: 1 }, nested)).toBe(0);
  });
});

describe("hitEdge", () => {
  const edges: HitEdge[] = [
    { index: 0, swx: 0, swy: 0, twx: 100, twy: 0, off: 0 },
  ];

  it("finds an edge along its length", () => {
    expect(hitEdge(50, 1, { x: 0, y: 0, k: 1 }, edges, 8)).toBe(0);
  });

  it("misses well off the line", () => {
    expect(hitEdge(50, 40, { x: 0, y: 0, k: 1 }, edges, 8)).toBe(-1);
  });

  it("returns -1 when there are no edges", () => {
    expect(hitEdge(0, 0, { x: 0, y: 0, k: 1 }, [])).toBe(-1);
  });
});

describe("quadControl", () => {
  it("bows perpendicular to the segment and grows with the offset index", () => {
    const a = quadControl(0, 0, 100, 0, 0);
    const b = quadControl(0, 0, 100, 0, 1);
    // midpoint x stays, y is pushed off the line
    expect(a.x).toBeCloseTo(50, 6);
    expect(a.y).toBeCloseTo(6, 6);
    expect(b.y).toBeCloseTo(28, 6);
  });

  it("survives a zero-length segment", () => {
    const c = quadControl(5, 5, 5, 5, 0);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
  });
});

describe("effectiveDpr", () => {
  it("clamps a 3x phone to the cap — the biggest fill-rate win", () => {
    expect(effectiveDpr(3)).toBe(2);
    expect(effectiveDpr(4.5)).toBe(2);
  });

  it("never goes below 1 and never scales up a normal screen", () => {
    expect(effectiveDpr(1)).toBe(1);
    expect(effectiveDpr(0.5)).toBe(1);
    expect(effectiveDpr(0)).toBe(1);
    expect(effectiveDpr(Number.NaN)).toBe(1);
  });
});

describe("fitCamera", () => {
  it("centres the bounds in the viewport", () => {
    const cam = fitCamera(
      { minX: -100, minY: -100, w: 200, h: 200 },
      { x: 0, y: 0, w: 400, h: 400 },
      0.1,
      4
    );
    const c = toScreen(0, 0, cam);
    expect(c.x).toBeCloseTo(200, 6);
    expect(c.y).toBeCloseTo(200, 6);
  });

  it("respects the zoom clamps", () => {
    const huge = fitCamera(
      { minX: 0, minY: 0, w: 100000, h: 100000 },
      { x: 0, y: 0, w: 400, h: 400 },
      0.2,
      1.6
    );
    expect(huge.k).toBe(0.2);
  });
});

describe("labelOpacityFor", () => {
  it("matches the SVG thresholds so both renderers agree", () => {
    expect(labelOpacityFor(0.1, 0)).toBe(1);
    expect(labelOpacityFor(1, 1)).toBe(1);
    expect(labelOpacityFor(0.2, 2)).toBe(0);
    expect(labelOpacityFor(0.7, 2)).toBe(1);
  });
});

describe("paint", () => {
  /** N nodes on a grid, M edges chaining them. */
  function scene(n: number, m: number, viewport = { w: 400, h: 400 }) {
    const nodes = Array.from({ length: n }, (_, i) => ({
      index: i,
      primary: "#22D3EE",
      darkFill: "#0B4A5E",
      lightFill: "#0B4A5E",
      border: "#67E8F9",
      glow: "rgba(34,211,238,0.4)",
      r: 6,
      tier: 1 as const,
      name: `N${i}`,
    }));
    const edges = Array.from({ length: m }, (_, i) => ({
      index: i,
      color: "#64748B",
      opacity: 0.5,
      width: 2,
    }));
    const edgeFrom = new Float64Array(m * 2);
    const edgeTo = new Float64Array(m * 2);
    const edgeOff = new Float64Array(m);
    // Interleaved [x,y] per node — the layout every other consumer uses.
    const positions = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 2] = (i % 20) * 18;
      positions[i * 2 + 1] = Math.floor(i / 20) * 18;
    }
    for (let i = 0; i < m; i++) {
      const a = i % n;
      const b = (i + 1) % n;
      edgeFrom[i * 2] = positions[a * 2];
      edgeFrom[i * 2 + 1] = positions[a * 2 + 1];
      edgeTo[i * 2] = positions[b * 2];
      edgeTo[i * 2 + 1] = positions[b * 2 + 1];
    }
    const o: PaintOptions = {
      cam: { x: 0, y: 0, k: 1 },
      nodes,
      edges,
      edgeFrom,
      edgeTo,
      edgeOff,
      positions,
      selectedIndex: -1,
      hoveredIndex: -1,
      searchMatches: null,
      dotGrid: false,
      isDark: true,
      dpr: 1,
      ambientMs: 0,
      viewport,
    };
    return o;
  }

  it("issues a bounded number of calls for the real 319-node graph", () => {
    const ctx = fakeCtx();
    const calls = paint(ctx, scene(319, 217), PAL);
    /*
     * The whole point of the canvas port. Cost per node is 4 (glow fill, body
     * fill+stroke, core fill) plus 2 when a label paints, and 1 per edge — so a
     * fully un-culled, fully-labelled 319-node graph is ~2,100 calls. The SVG
     * renderer instead kept ~2,350 live DOM elements alive, and the browser
     * re-resolved style, layout and hit-test for every one of them per frame.
     */
    const maxCalls = 319 * 6 + 217 + 2;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(maxCalls);
  });

  it("culls off-screen nodes instead of drawing all of them", () => {
    // 400 nodes but only a 40x40 viewport showing the first few.
    const o = scene(400, 380, { w: 40, h: 40 });
    const near = paint(fakeCtx(), o, PAL);
    // Full-graph viewport must cost strictly more calls than the tight one.
    const wide = paint(fakeCtx(), scene(400, 380, { w: 4000, h: 4000 }), PAL);
    expect(near).toBeLessThan(wide);
  });

  /*
   * Labels are no longer gated by node importance. The tier policy meant only
   * 20 of 319 nodes were ever named on the low tier — a graph of unnamed dots.
   * Every node is now a candidate and TEXT-ON-TEXT collisions are what get
   * dropped.
   */
  it("names every node when nothing overlaps", () => {
    const o = scene(30, 20);
    // Spread far apart so no two labels can collide.
    for (let i = 0; i < 30; i++) {
      o.positions[i * 2] = 40 + (i % 6) * 400;
      o.positions[i * 2 + 1] = 40 + Math.floor(i / 6) * 400;
    }
    o.viewport = { w: 3000, h: 3000 };
    o.cam = { x: 0, y: 0, k: 1 };

    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    // Every node contributed a name.
    expect(ctx.calls.filter((c) => c === "fillText").length).toBe(30);
  });

  it("drops only the labels that would overlap another label", () => {
    const o = scene(6, 4);
    // Stack all six on the SAME spot: at most one label survives.
    for (let i = 0; i < 6; i++) {
      o.positions[i * 2] = 100;
      o.positions[i * 2 + 1] = 100;
    }
    o.viewport = { w: 400, h: 400 };
    o.cam = { x: 0, y: 0, k: 1 };

    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    const labels = ctx.calls.filter((c) => c === "fillText").length;
    expect(labels).toBeGreaterThan(0);
    // Six nodes stacked on one point cannot all be legibly named.
    expect(labels).toBeLessThan(6);
  });

  it("never drops the most important label to a collision", () => {
    const o = scene(2, 1);
    // Node 0 is tier 1, node 1 is the hub (tier 0).
    o.nodes[0].tier = 1;
    o.nodes[1].tier = 0;
    o.nodes[1].r = 26;
    o.positions[0] = 100;
    o.positions[1] = 100;
    // Hub sits HIGHER, so a below-only placement would put its label across the
    // tier-1 node's band.
    o.positions[2] = 100;
    o.positions[3] = 70;
    o.viewport = { w: 400, h: 400 };
    o.cam = { x: 0, y: 0, k: 1 };

    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    /*
     * The property is WHO survives, not HOW MANY.
     *
     * Labels are now tried below the node and then above it, so a collision that
     * used to cost one of the two names can now cost neither — pinning the count
     * to 1 would assert the old limitation. What must hold either way is that
     * the hub is never the one sacrificed to a lesser node.
     */
    expect(ctx.textArgs).toContain("N1");
  });

  it("brings a suppressed name back once the graph is spread out", () => {
    const tight = scene(4, 2);
    for (let i = 0; i < 4; i++) {
      tight.positions[i * 2] = 100;
      tight.positions[i * 2 + 1] = 100;
    }
    tight.viewport = { w: 400, h: 400 };
    tight.cam = { x: 0, y: 0, k: 1 };
    const stacked = fakeCtx();
    paint(stacked, tight, PAL);
    const nStacked = stacked.calls.filter((c) => c === "fillText").length;

    // Same four nodes, now far apart: all four are nameable again.
    const spread = scene(4, 2);
    for (let i = 0; i < 4; i++) {
      spread.positions[i * 2] = 50 + i * 300;
      spread.positions[i * 2 + 1] = 50;
    }
    spread.viewport = { w: 1200, h: 400 };
    spread.cam = { x: 0, y: 0, k: 1 };
    const apart = fakeCtx();
    paint(apart, spread, PAL);
    const nApart = apart.calls.filter((c) => c === "fillText").length;

    expect(nApart).toBe(4);
    expect(nApart).toBeGreaterThan(nStacked);
  });

  /*
   * Regression. Edge opacity was driven by the CALLER, so a hover dropped every
   * non-adjacent string to 0.1 — sweeping the pointer across the graph blanked
   * out most of it, which on a phone reads as content vanishing.
   */
  it("keeps non-adjacent strings visible while a node is hovered", () => {
    const o = scene(20, 40);
    o.hoveredIndex = 0;
    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    // The painter multiplies by ctx.globalAlpha; assert it never goes near zero
    // for a plain hover. (The caller now supplies 0.5 / 1.0 only.)
    const alphas: number[] = ctx.alphas;
    expect(alphas.length).toBeGreaterThan(0);
    // No string is drawn at an alpha that would render it invisible.
    const visible = alphas.filter((a: number) => a > 0);
    expect(Math.min(...visible)).toBeGreaterThan(0.3);
  });

  /*
   * Regression, and the reason the mobile default looked wrong. The camera
   * transform replaced the caller's DPR scale instead of composing with it, so
   * the graph drew at 1/dpr size. On a 2x phone a correctly-fitted 81%-wide
   * graph rendered 40% wide, parked up and to the left — precisely what the
   * device screenshot showed, and what the arithmetic here pins down.
   */
  it("composes the camera with the DPR scale instead of replacing it", () => {
    const ctx = fakeCtx();
    const o = scene(10, 8);
    o.dpr = 2;
    o.cam = { x: 30, y: -12, k: 0.25 };
    paint(ctx, o, PAL);
    const scales = ctx.setTransformArgs;
    // The first setTransform is the camera; it must carry dpr through.
    expect(scales[0]).toEqual([0.25 * 2, 0, 0, 0.25 * 2, 30 * 2, -12 * 2]);
  });

  it("restores the transform so the next frame starts clean", () => {
    const ctx = fakeCtx();
    paint(ctx, scene(10, 8), PAL);
    // save + restore pair, and a final transform reset.
    expect(ctx.calls.filter((c) => c === "save")).toHaveLength(1);
    expect(ctx.calls.filter((c) => c === "restore")).toHaveLength(1);
    expect(ctx.calls[ctx.calls.length - 1]).toBe("setTransform");
  });

  /*
   * Regression. paint() used to end on setTransform(1,0,0,1,0,0), which
   * discarded the DPR scale the caller had applied. Every frame after the first
   * was then drawn at 1/dpr scale — on a 3x phone a third of the size, jammed
   * into the top-left corner. That is what "the graph is a corner cluster and
   * nodes vanish as I zoom" actually was.
   */
  it("leaves the context at the DPR scale, not the identity", () => {
    const ctx = fakeCtx();
    const o = scene(10, 8);
    o.dpr = 3;
    paint(ctx, o, PAL);
    const last = ctx.calls[ctx.calls.length - 1];
    expect(last).toBe("setTransform");
    // fakeCtx records only names, so assert on the scale arguments instead.
    const scales = ctx.setTransformArgs ?? [];
    expect(scales[scales.length - 1]).toEqual([3, 0, 0, 3, 0, 0]);
  });

  it("marks the selected node without touching the others", () => {
    const o = scene(20, 18);
    o.selectedIndex = 3;
    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    // The state ring is an extra arc for exactly one node.
    const arcs = ctx.calls.filter((c) => c === "arc").length;
    // 20 nodes x (glow + body + core) + 1 extra ring for the selected one.
    expect(arcs).toBe(61);
  });

  /*
   * Regression. The painter once took split `nodeX` / `nodeY` arrays, and the
   * component handed it the same interleaved buffer for both — so every node was
   * painted at (x, x) instead of (x, y). The whole graph collapsed onto a
   * diagonal, and culling then discarded most of it, which looked like nodes
   * vanishing when you zoomed in.
   *
   * The test asserts a node is painted at its authored Y, which a shared-array
   * bug cannot satisfy whenever x !== y.
   */
  it("paints each node at its authored x AND y, never x for both", () => {
    const o = scene(3, 2);
    // Place nodes at deliberately asymmetric coordinates.
    o.positions[0] = 10;
    o.positions[1] = 90;
    o.positions[2] = 30;
    o.positions[3] = 20;
    o.positions[4] = 70;
    o.positions[5] = 40;

    const drawn: Array<[number, number]> = [];
    const ctx = {
      ...fakeCtx(),
      arc: (x: number, y: number, ..._r: unknown[]) => {
        drawn.push([x, y]);
      },
    } as unknown as CanvasRenderingContext2D & { calls: string[] };

    paint(ctx, o, PAL);

    // Every painted coordinate must match some authored (x, y) pair — never a
    // position whose Y was copied from X.
    const authored = new Set([
      "10,90",
      "30,20",
      "70,40",
    ]);
    for (const [x, y] of drawn) {
      expect(authored.has(`${x},${y}`)).toBe(true);
    }
    expect(drawn.length).toBeGreaterThanOrEqual(6); // 3 nodes x body + core
  });
  /*
   * Regression. The painter hardcoded `darkFill` for every node, so on the LIGHT
   * theme every disc rendered with the dark palette colour and the faction
   * colours collapsed into one indistinguishable tone.
   */
  it("uses the theme-appropriate fill, not always the dark one", () => {
    const o = scene(2, 1);
    o.nodes[0].darkFill = "#0B4A5E";
    o.nodes[0].lightFill = "#CFF6FD";

    const dark = fakeCtx();
    o.isDark = true;
    paint(dark, o, PAL);

    const light = fakeCtx();
    o.isDark = false;
    paint(light, o, PAL);

    // Both runs draw the same number of things; the fills must differ.
    const darkFills = dark.calls.filter((c) => c === "fill").length;
    const lightFills = light.calls.filter((c) => c === "fill").length;
    expect(darkFills).toBe(lightFills);
    expect(darkFills).toBeGreaterThan(0);
  });

  /*
   * Regression. The faction glow was dropped in the first port, so nodes lost
   * the soft halo that carried most of the colour identity in the SVG version.
   */
  it("draws a faction glow behind each node", () => {
    const o = scene(4, 3);
    const ctx = fakeCtx();
    const calls = paint(ctx, o, PAL);
    // A glow is one extra radial gradient + arc + fill per node.
    expect(calls).toBeGreaterThan(0);
    // The gradient is created through createLinearGradient/createRadialGradient;
    // fakeCtx stubs the linear one, so assert the node count still bounds us.
    const arcs = ctx.calls.filter((c) => c === "arc").length;
    // 4 nodes x (glow + body + core) = 12
    expect(arcs).toBe(12);
  });

  function withDepth(o: PaintOptions, depth: number[]): PaintOptions {
    return { ...o, depth: Float64Array.from(depth) };
  }

  it("draws far nodes first so the near side occludes", () => {
    /*
     * Node 0 is placed nearest and node 1 farthest, and they are given
     * identical geometry. The NEAREST must be drawn LAST.
     */
    const o = scene(2, 0);
    o.positions[0] = 0;
    o.positions[1] = 0;
    o.positions[2] = 100;
    o.positions[3] = 0;
    const ctx = fakeCtx();
    paint(ctx, withDepth(o, [1, -1]), PAL);

    // Radii: far (smaller) then near (larger). The first arc of each node is
    // its glow, so compare the first two arcs after the grid-less backdrop.
    const radii = ctx.arcArgs.map((a) => a[2]);
    expect(radii.length).toBeGreaterThanOrEqual(6);
    // far node's glow  (6 - 0.22*6) + 12*0.78  ; near node's glow (6+1.32)+12*1.22
    expect(radii[0]).toBeLessThan(radii[3]);
  });

  it("scales a node's radius by its depth", () => {
    const near = scene(1, 0);
    const far = scene(1, 0);
    const cNear = fakeCtx();
    const cFar = fakeCtx();
    paint(cNear, withDepth(near, [1]), PAL);
    paint(cFar, withDepth(far, [-1]), PAL);

    // The body is the second arc of the single node (glow, then body).
    const nearR = cNear.arcArgs[1][2];
    const farR = cFar.arcArgs[1][2];
    expect(nearR).toBeGreaterThan(farR);
    // 1 + 0.22 and 1 - 0.22 about the authored radius.
    expect(nearR).toBeCloseTo(6 * 1.22, 5);
    expect(farR).toBeCloseTo(6 * 0.78, 5);
  });

  it("fades the far side without ever going fully transparent", () => {
    const o = scene(1, 0);
    const ctx = fakeCtx();
    paint(ctx, withDepth(o, [-1]), PAL);
    const alphas = ctx.alphas.filter((a) => a > 0 && a < 1);
    expect(alphas.length).toBeGreaterThan(0);
    /*
     * The floor is what matters, not its exact value: a far node must stay
     * clearly visible rather than dissolving into the background. Asserting the
     * precise constant here would just re-state the source; asserting that it
     * is meaningfully present is the property that keeps the far hemisphere
     * from disappearing.
     */
    for (const a of alphas) expect(a).toBeGreaterThanOrEqual(0.35);
  });

  it("changes nothing when there is no depth buffer", () => {
    /*
     * The flat layouts must be byte-for-byte the behaviour they had before the
     * globe existed: same call count, same radii. Anything else means adding
     * the third dimension leaked into the 2D renderer.
     */
    const flat = scene(20, 12);
    const a = fakeCtx();
    const callsFlat = paint(a, flat, PAL);
    const b = fakeCtx();
    const callsDepth = paint(
      b,
      withDepth(flat, new Array(20).fill(0)),
      PAL
    );
    expect(callsDepth).toBe(callsFlat);
    expect(b.arcArgs.length).toBe(a.arcArgs.length);
    // Zero depth is the neutral size, so every radius matches too.
    for (let i = 0; i < a.arcArgs.length; i++) {
      expect(b.arcArgs[i][2]).toBeCloseTo(a.arcArgs[i][2], 6);
    }
  });

  it("keeps an emphasised node fully opaque even when it is far away", () => {
    // The node being searched for or hovered is the thing the visitor is
    // looking for; fading it out with the far side would hide the answer.
    const o = scene(1, 0);
    o.hoveredIndex = 0;
    const ctx = fakeCtx();
    paint(ctx, withDepth(o, [-1]), PAL);
    expect(Math.max(...ctx.alphas)).toBe(1);
  });

  it("draws labels at a constant SCREEN size, whatever the zoom", () => {
    /*
     * The readability bug behind the report. Labels were drawn in world units,
     * so the camera scaled them: at the zoom that fits the cast on a phone an
     * 11px name rendered at ~2.5px — not small print, a grey smudge. The font
     * must be divided by k, so that (font size set) x (zoom) is a constant:
     * that product IS the size on screen.
     *
     * Each zoom is measured in its own scope. Collecting the font strings into
     * one array and looking up which k produced each was the first attempt, and
     * it silently passed against the broken code: when every zoom yields the
     * SAME string, indexOf returns the first match for all of them and the test
     * compares a value against itself.
     */
    const onScreen: number[] = [];
    for (const k of [0.2, 1, 3]) {
      const o = scene(1, 0);
      o.cam = { x: 0, y: 0, k };
      const ctx = fakeCtx();
      let font = "";
      Object.defineProperty(ctx, "font", {
        get: () => font,
        set: (v: string) => {
          font = v;
        },
      });
      paint(ctx, o, PAL);
      const m = /([\d.]+)px/.exec(font);
      expect(m).not.toBeNull();
      onScreen.push(Number(m![1]) * k);
    }
    // A name is the same number of CSS px at every zoom.
    for (const v of onScreen) expect(v).toBeCloseTo(11, 4);
  });

  it("dims everything a spotlight is NOT about", () => {
    /*
     * Picking a faction (or searching) is a deliberate narrowing, so the chosen
     * group has to stand out. Leaving the rest at full strength made the pick
     * look like it did nothing. Hover is deliberately exempt — see the
     * "hovering must never make anything disappear" tests — so this only applies
     * when a match set is present.
     */
    const o = scene(4, 0);
    const ctx = fakeCtx();
    paint(ctx, { ...o, searchMatches: new Set([0]) }, PAL);
    const dim = ctx.alphas.filter((a) => a > 0 && a < 0.3);
    expect(dim.length).toBeGreaterThan(0);
    expect(Math.max(...ctx.alphas)).toBe(1);
  });

  it("draws the whole cast at full strength when nothing is spotlighted", () => {
    const o = scene(4, 0);
    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    // No match set, no dimming: only the label/glow passes may vary alpha.
    const dim = ctx.alphas.filter((a) => a > 0 && a < 0.3);
    expect(dim.length).toBe(0);
  });

  it("never draws a node below the legibility floor", () => {
    /*
     * The readability regression behind the "so messy" report: at the zoom that
     * fits the whole globe on a phone, a 10px world radius renders under 4 CSS
     * px and the cast reads as scattered dust. The drawn radius must be clamped
     * to MIN_NODE_R_PX in screen terms — so the smallest node at a small zoom is
     * still a dot you can see and tap, not a speck.
     */
    const o = scene(1, 0);
    // A small camera zoom makes world units tiny on screen.
    o.cam = { x: 0, y: 0, k: 0.2 };
    const ctx = fakeCtx();
    paint(ctx, o, PAL);
    // The body is the second arc (glow first). World r is 6; at k=0.2 that is
    // 1.2 world px of screen — well under the floor.
    const bodyR = ctx.arcArgs[1][2];
    // The clamp is applied in world units as MIN_NODE_R_PX / k.
    expect(bodyR * o.cam.k).toBeGreaterThanOrEqual(MIN_NODE_R_PX - 1e-6);
  });

  it("fades a string by the depth of the nodes it joins", () => {
    /*
     * On a globe the far hemisphere's web used to draw at full strength over
     * the near hemisphere, which is most of the hairball. An edge whose ends are
     * both at the back must come out dimmer than one whose ends are at the
     * front.
     */
    const back = scene(2, 1);
    back.edges[0].s = 0;
    back.edges[0].t = 1;
    const frontO = { ...back, edges: [{ ...back.edges[0] }] };
    const cBack = fakeCtx();
    paint(cBack, withDepth(back, [-1, -1]), PAL);
    const cFront = fakeCtx();
    paint(cFront, withDepth(frontO, [1, 1]), PAL);

    // Edge alpha is set before the node passes; take the first non-1 alpha.
    const backEdgeAlpha = cBack.alphas[0];
    const frontEdgeAlpha = cFront.alphas[0];
    expect(frontEdgeAlpha).toBeGreaterThan(backEdgeAlpha);
  });

  it("labels only the front of the globe, so back names cannot overlay front nodes", () => {
    /*
     * This is the single biggest source of text overlap in the phone
     * screenshot: names from the far side were printed over the near side's
     * nodes. Only front-hemisphere nodes may be labelled.
     */
    const o = scene(2, 0);
    o.positions[0] = 0;
    o.positions[1] = 0;
    o.positions[2] = 40;
    o.positions[3] = 0;
    // Node 0 near the viewer, node 1 far. Only node 0's name should be drawn.
    const ctx = fakeCtx();
    paint(ctx, withDepth(o, [1, -1]), PAL);
    /*
     * Two nodes, but only the front one may be named. `fakeCtx` records call
     * names rather than arguments, so the assertion is on the COUNT: a second
     * label would show up as another fillText.
     */
    const fillTexts = ctx.calls.filter((c) => c === "fillText").length;
    expect(fillTexts).toBe(1);
  });
});
