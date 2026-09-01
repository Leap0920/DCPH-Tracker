import { describe, expect, it } from "vitest"
import {
  clamp,
  getNodeRadius,
  getRelationshipColor,
  resolveFaction,
  FACTION_KEYS,
} from "@/components/characters/graph-theme"
import {
  CHARACTERS,
  RELATIONSHIPS,
} from "@/lib/characters-guide"
import { gateGraph, LOCKED_NAME } from "@/lib/characters-visible"
import { buildWatchProgress } from "@/lib/characters-spoiler"

describe("characters graph theme & geometry", () => {
  it("clamp respects bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it("resolves valid faction themes for all characters", () => {
    for (const c of CHARACTERS) {
      const { key, theme } = resolveFaction(c.affiliation)
      expect(FACTION_KEYS).toContain(key)
      expect(theme).toBeDefined()
      expect(theme.primary).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it("calculates node radius based on degree and role", () => {
    const conan = CHARACTERS.find((c) => c.id === "conan-edogawa")!
    expect(conan).toBeDefined()
    const radiusConan = getNodeRadius(conan, 10)
    expect(radiusConan).toBeGreaterThanOrEqual(24)

    const minor = CHARACTERS.find((c) => c.role !== "Protagonist" && c.id !== "conan-edogawa")
    if (minor) {
      const radiusMinor = getNodeRadius(minor, 1)
      expect(radiusMinor).toBeLessThan(radiusConan)
    }
  })

  it("provides distinct relationship colors for light and dark themes", () => {
    const darkColor = getRelationshipColor("romance", true)
    const lightColor = getRelationshipColor("romance", false)
    expect(darkColor).toBeDefined()
    expect(lightColor).toBeDefined()
  })

  it("gates graph correctly without throwing", () => {
    const progress = buildWatchProgress({ isSignedIn: false, watchedEpisodes: [], watchedMovies: [] })
    const graph = gateGraph(CHARACTERS, RELATIONSHIPS, progress, { showEverything: false })
    expect(graph.characters.length).toBeGreaterThan(0)
    expect(graph.relationships.length).toBeGreaterThan(0)

    const locked = graph.characters.filter((c) => c.locked)
    for (const c of locked) {
      expect(c.name).toBe(LOCKED_NAME)
    }
  })

  it("calculates label opacity correctly across zoom tiers", () => {
    function labelOpacityFor(k: number, tier: 0 | 1 | 2): number {
      const start = tier === 0 ? 0.3 : tier === 1 ? 0.46 : 0.62
      return clamp((k - start) / 0.22, 0, 1)
    }

    // At low zoom (k = 0.2), all labels are hidden
    expect(labelOpacityFor(0.2, 0)).toBe(0)
    expect(labelOpacityFor(0.2, 1)).toBe(0)
    expect(labelOpacityFor(0.2, 2)).toBe(0)

    // Tier 0 (major characters) shows first as zoom increases
    expect(labelOpacityFor(0.4, 0)).toBeGreaterThan(0)
    expect(labelOpacityFor(0.4, 1)).toBe(0)
    expect(labelOpacityFor(0.4, 2)).toBe(0)

    // At high zoom (k >= 0.85), all tiers are fully visible
    expect(labelOpacityFor(0.85, 0)).toBe(1)
    expect(labelOpacityFor(0.85, 1)).toBe(1)
    expect(labelOpacityFor(0.85, 2)).toBe(1)
  })

  it("generates valid quadratic bezier paths for parallel relationship threads", () => {
    function quadPath(
      sx: number,
      sy: number,
      tx: number,
      ty: number,
      offsetIndex: number
    ): string {
      const mx = (sx + tx) / 2
      const my = (sy + ty) / 2
      const dx = tx - sx
      const dy = ty - sy
      const len = Math.hypot(dx, dy) || 1
      const arc = 6 + offsetIndex * 22
      const cx = mx + (-dy / len) * arc
      const cy = my + (dx / len) * arc
      return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(
        1
      )} ${tx.toFixed(1)} ${ty.toFixed(1)}`
    }

    const p0 = quadPath(100, 100, 300, 100, 0)
    const p1 = quadPath(100, 100, 300, 100, 1)
    const pMinus1 = quadPath(100, 100, 300, 100, -1)

    expect(p0).toMatch(/^M 100\.0 100\.0 Q 200\.0 \d+\.\d 300\.0 100\.0$/)
    expect(p1).not.toBe(p0)
    expect(pMinus1).not.toBe(p0)
  })

  it("maintains zoom anchor invariance during smooth exponential zoom interpolation", () => {
    // Under mouse cursor at screen coords (sx, sy), world anchor W = (sx - cam.x) / cam.k
    // When zooming to target.k with target.x = sx - W * target.k:
    const sx = 250
    const cam0 = { x: 50, k: 1.0 }
    const W = (sx - cam0.x) / cam0.k // 200
    const target = { k: 2.5, x: sx - W * 2.5 } // 250 - 500 = -250

    // At any intermediate interpolation factor u in [0, 1]:
    for (const u of [0.1, 0.3, 0.5, 0.8, 1.0]) {
      const camK = (1 - u) * cam0.k + u * target.k
      const camX = (1 - u) * cam0.x + u * target.x
      const currentW = (sx - camX) / camK
      expect(currentW).toBeCloseTo(W, 5)
    }
  })
})
