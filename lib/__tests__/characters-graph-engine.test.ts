import { describe, expect, it } from "vitest";
import Graph from "graphology";
import type { GraphNodeAttrs, GraphEdgeAttrs } from "@/lib/characters-graph-engine";
import {
  buildGraphSpec,
  fallbackPosition,
  pairKey,
  withAlpha,
  BASE_CURVATURE,
} from "@/lib/characters-graph-engine";
import { CHARACTERS, RELATIONSHIPS } from "@/lib/characters-guide";

describe("characters-graph-engine", () => {
  it("builds one spec node per character with authored positions", () => {
    const spec = buildGraphSpec(CHARACTERS, RELATIONSHIPS);
    expect(spec.nodes.length).toBe(CHARACTERS.length);
    for (const n of spec.nodes) {
      expect(Number.isFinite(n.attrs.x)).toBe(true);
      expect(Number.isFinite(n.attrs.y)).toBe(true);
    }
  });

  it("creates one spec edge per relationship between known characters", () => {
    const spec = buildGraphSpec(CHARACTERS, RELATIONSHIPS);
    expect(spec.edges.length).toBe(RELATIONSHIPS.length);
    const keys = new Set(spec.edges.map((e) => e.key));
    expect(keys.size).toBe(RELATIONSHIPS.length);
  });

  it("separates renderer program names from relationship categories", () => {
    const spec = buildGraphSpec(CHARACTERS, RELATIONSHIPS);
    const programs = new Set(["curved"]);
    for (const edge of spec.edges) {
      // Sigma dispatches by attrs.type, not by defaultEdgeType when type exists.
      expect(programs.has(edge.attrs.type)).toBe(true);
      expect(edge.attrs).toHaveProperty(
        "relationshipType",
        RELATIONSHIPS.find((r) => r.id === edge.key)!.type,
      );
    }
  });

  it("gives parallel threads alternating signed curvature", () => {
    const spec = buildGraphSpec(CHARACTERS, RELATIONSHIPS);
    const byPair = new Map<string, number>();
    for (const e of spec.edges) {
      const key = pairKey({ source: e.source, target: e.target });
      byPair.set(key, (byPair.get(key) ?? 0) + 1);
    }
    const multiPair = [...byPair.entries()].find(([, n]) => n > 1);
    expect(multiPair).toBeDefined();
    const curvatures = spec.edges
      .filter(
        (e) =>
          pairKey({ source: e.source, target: e.target }) === multiPair![0]
      )
      .map((e) => e.attrs.curvature);
    expect(new Set(curvatures).size).toBe(curvatures.length);
    expect(curvatures.some((c) => c < 0)).toBe(true);
    expect(curvatures.some((c) => c > 0)).toBe(true);
  });

  it("falls back to a deterministic spiral for unpositioned characters", () => {
    const a = fallbackPosition("some-id", 0);
    const b = fallbackPosition("some-id", 1);
    expect(a.x).not.toBe(b.x);
    expect(Number.isFinite(a.x)).toBe(true);
  });

  it("uses the locked palette for locked characters", () => {
    const gated = CHARACTERS.map((c) => ({
      ...c,
      locked: c.id === "conan-edogawa",
    }));
    const spec = buildGraphSpec(gated as typeof CHARACTERS, []);
    const conan = spec.nodes.find((n) => n.key === "conan-edogawa");
    expect(conan?.attrs.locked).toBe(true);
  });

  it("keeps BASE_CURVATURE positive and small", () => {
    expect(BASE_CURVATURE).toBeGreaterThan(0);
    expect(BASE_CURVATURE).toBeLessThan(1);
  });
});
