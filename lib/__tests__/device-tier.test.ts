import { describe, expect, it } from "vitest"
import {
  TIERS,
  TIER_COPY,
  classifyDevice,
  downgrade,
  isQualityTier,
  isStruggling,
  minTier,
  type DeviceSignals,
} from "@/lib/device-tier"
import { GRAPH_QUALITY, labelTierLimit } from "@/components/characters/graph-quality"

describe("device tier detection", () => {
  it("leaves a fast, mouse-driven desktop on high", () => {
    const { tier, reasons } = classifyDevice({
      cores: 16,
      memoryGB: 8,
      coarsePointer: false,
      dpr: 1,
      screenArea: 1920 * 1080,
    })
    expect(tier).toBe("high")
    expect(reasons).toHaveLength(1)
  })

  it("caps every touch device at balanced, however fast it claims to be", () => {
    expect(
      classifyDevice({ cores: 12, memoryGB: 8, coarsePointer: true }).tier
    ).toBe("balanced")
    expect(
      classifyDevice({
        cores: 12,
        memoryGB: 8,
        coarsePointer: true,
        dpr: 3,
        screenArea: 430 * 932,
      }).tier
    ).toBe("balanced")
  })

  it("drops weak hardware to low", () => {
    expect(classifyDevice({ cores: 2, memoryGB: 2 }).tier).toBe("low")
    expect(classifyDevice({ cores: 8, memoryGB: 2 }).tier).toBe("low")
    expect(classifyDevice({ cores: 2, memoryGB: 8 }).tier).toBe("low")
  })

  it("treats 4 GB / 4 cores / high-DPI as mid-range", () => {
    expect(classifyDevice({ cores: 4, memoryGB: 8 }).tier).toBe("balanced")
    expect(classifyDevice({ cores: 8, memoryGB: 4 }).tier).toBe("balanced")
    expect(
      classifyDevice({ cores: 8, memoryGB: 8, dpr: 3, screenArea: 390 * 844 }).tier
    ).toBe("balanced")
  })

  it("honours reduced motion and data saving above any hardware fact", () => {
    expect(classifyDevice({ cores: 16, memoryGB: 8, reduceMotion: true }).tier).toBe("low")
    expect(classifyDevice({ cores: 16, memoryGB: 8, saveData: true }).tier).toBe("low")
    expect(classifyDevice({ cores: 16, memoryGB: 8, effectiveType: "3g" }).tier).toBe("low")
    expect(classifyDevice({ cores: 16, memoryGB: 8, effectiveType: "4g" }).tier).toBe("high")
  })

  it("never reports a tier with no reason attached", () => {
    const cases: DeviceSignals[] = [
      {},
      { cores: 8 },
      { memoryGB: 3 },
      { saveData: false, effectiveType: "4g", cores: 8, memoryGB: 8 },
    ]
    for (const signals of cases) {
      const { tier, reasons } = classifyDevice(signals)
      expect(TIERS).toContain(tier)
      expect(reasons.length).toBeGreaterThan(0)
    }
  })

  it("orders the ladder and its helpers consistently", () => {
    expect(TIERS).toEqual(["high", "balanced", "low"])
    expect(downgrade("high")).toBe("balanced")
    expect(downgrade("balanced")).toBe("low")
    expect(downgrade("low")).toBe("low")
    expect(minTier("high", "low")).toBe("low")
    expect(minTier("balanced", "balanced")).toBe("balanced")
  })

  it("recognises stored tiers and rejects anything else", () => {
    expect(isQualityTier("high")).toBe(true)
    expect(isQualityTier("ultra")).toBe(false)
    expect(isQualityTier(undefined)).toBe(false)
  })

  it("calls a device struggling only on real evidence", () => {
    expect(isStruggling(null)).toBe(false)
    expect(isStruggling({ meanMs: 16, p95Ms: 20, frames: 200 })).toBe(false)
    expect(isStruggling({ meanMs: 18, p95Ms: 40, frames: 200 })).toBe(true)
    expect(isStruggling({ meanMs: 30, p95Ms: 33, frames: 200 })).toBe(true)
  })
})

describe("graph quality tiers", () => {
  it("gives every tier a complete, honest budget", () => {
    for (const tier of TIERS) {
      const q = GRAPH_QUALITY[tier]
      expect(q.particles).toBeGreaterThanOrEqual(0)
      expect(q.driftAmp).toBeGreaterThanOrEqual(0)
      expect(q.collideIters).toBeGreaterThan(0)
      expect(q.edgeFrameDivisor).toBeGreaterThanOrEqual(1)
      expect(q.particleCadence).toBeGreaterThanOrEqual(1)
      expect(TIER_COPY[tier].label.length).toBeGreaterThan(0)
    }
  })

  it("keeps the low tier genuinely still", () => {
    const low = GRAPH_QUALITY.low
    expect(low.driftAmp).toBe(0)
    expect(low.particles).toBe(0)
    expect(low.breathe).toBe(false)
    expect(low.ripple).toBe(false)
  })

  it("stops the 103 breathing rings below high, so a phone never repaints every node", () => {
    // The breathing halo is one infinite, non-composited SVG animation per node.
    // Only the tier a desktop explicitly picks may keep them.
    expect(GRAPH_QUALITY.balanced.breathe).toBe(false)
    expect(GRAPH_QUALITY.low.breathe).toBe(false)
    expect(GRAPH_QUALITY.high.breathe).toBe(true)
  })

  it("escalates cost monotonically from low to high", () => {
    expect(GRAPH_QUALITY.high.particles).toBeGreaterThan(GRAPH_QUALITY.balanced.particles)
    expect(GRAPH_QUALITY.balanced.particles).toBeGreaterThan(GRAPH_QUALITY.low.particles)
    expect(GRAPH_QUALITY.high.driftAmp).toBeGreaterThan(GRAPH_QUALITY.balanced.driftAmp)
    expect(GRAPH_QUALITY.balanced.edgeFrameDivisor).toBeGreaterThan(
      GRAPH_QUALITY.high.edgeFrameDivisor - 1
    )
  })

  it("maps a label policy to the weakest tier it still paints", () => {
    expect(labelTierLimit("all")).toBeNull()
    expect(labelTierLimit("major")).toBe(1)
    expect(labelTierLimit("principal")).toBe(0)
  })
})
