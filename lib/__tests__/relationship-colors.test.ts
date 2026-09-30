/**
 * The relationship-type palette must actually reach the canvas.
 *
 * Regression: the first canvas port imported `getRelationshipColor` but never
 * called it — every edge was built with `color: ""` and fell back to one grey at
 * paint time, so all 217 red strings rendered in the same colour and the
 * relationship-type palette was thrown away.
 *
 * This asserts the resolver is real and theme-aware, which is what the component
 * now calls at graph-build time.
 */

import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_COLORS,
  getRelationshipColor,
} from "@/components/characters/graph-theme";
import type { RelationshipType } from "@/lib/characters-guide";

const TYPES = Object.keys(RELATIONSHIP_COLORS) as RelationshipType[];

describe("relationship colours", () => {
  it("covers every relationship type", () => {
    expect(TYPES.length).toBeGreaterThanOrEqual(8);
    for (const t of TYPES) {
      expect(RELATIONSHIP_COLORS[t]).toBeDefined();
    }
  });

  it("gives each type its own colour, so the graph is readable by eye", () => {
    const dark = TYPES.map((t) => getRelationshipColor(t, true));
    expect(new Set(dark).size).toBe(TYPES.length);
  });

  it("resolves to a real colour for an unknown type rather than throwing", () => {
    const fallback = getRelationshipColor(
      "not_a_real_type" as RelationshipType,
      true
    );
    expect(fallback).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
  });

  it("differs between themes where the palette requires it", () => {
    // Theme-aware by design: some authored colours vanish on one background.
    let themeSpecific = 0;
    for (const t of TYPES) {
      if (getRelationshipColor(t, true) !== getRelationshipColor(t, false)) {
        themeSpecific++;
      }
    }
    expect(themeSpecific).toBeGreaterThan(0);
  });
});
