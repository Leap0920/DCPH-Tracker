/**
 * Renderer selection for the character graph.
 *
 * The canvas port is gated so it can be A/B'd against the SVG path on a real
 * device before it becomes the only path. These pin the policy:
 *
 *  - `high` keeps SVG, so a desktop that can afford the full effect stack sees
 *    no change at all from this port.
 *  - `low` / `balanced` get canvas, which is the whole point — that is where a
 *    budget phone lands.
 *  - `?renderer=` overrides either way, which is the escape hatch that makes the
 *    comparison possible at all.
 */

import { describe, expect, it } from "vitest";
import {
  rendererForTier,
  rendererFromParam,
} from "@/components/characters/CharactersExplorer";

describe("rendererForTier", () => {
  it("keeps the SVG renderer on high, so desktops are untouched", () => {
    expect(rendererForTier("high")).toBe("svg");
  });

  it("serves canvas on the tiers a budget phone actually gets", () => {
    expect(rendererForTier("balanced")).toBe("canvas");
    expect(rendererForTier("low")).toBe("canvas");
  });

  it("falls back to canvas before the tier is known", () => {
    // null means detection has not resolved yet. Canvas is the cheap default;
    // the SVG path is reserved for a deliberate `high`.
    expect(rendererForTier(null)).toBe("canvas");
  });
});

describe("rendererFromParam", () => {
  it("honours an explicit choice", () => {
    expect(rendererFromParam("canvas")).toBe("canvas");
    expect(rendererFromParam("svg")).toBe("svg");
  });

  it("ignores anything else, so a typo falls back to the tier default", () => {
    expect(rendererFromParam(null)).toBeNull();
    expect(rendererFromParam("")).toBeNull();
    expect(rendererFromParam("webgl")).toBeNull();
    expect(rendererFromParam("CANVAS")).toBeNull();
  });

  it("lets the flag beat the tier in both directions", () => {
    // A phone can be pinned to SVG (to reproduce the old stutter) and a desktop
    // pinned to canvas (to inspect the new renderer).
    const forced = rendererFromParam("svg");
    expect(forced ?? rendererForTier("low")).toBe("svg");
    expect(rendererFromParam("canvas") ?? rendererForTier("high")).toBe("canvas");
  });
});
