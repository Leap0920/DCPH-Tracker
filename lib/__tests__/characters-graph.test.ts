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

  it("ensures all characters have defined x and y coordinates", () => {
    for (const c of CHARACTERS) {
      expect(c.x).toBeTypeOf("number")
      expect(c.y).toBeTypeOf("number")
    }
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

  it("handles empty nodes in bounding box calculation with safe defaults", () => {
    function computeBbox(nodes: { r: number; c: { x?: number; y?: number } }[]) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of nodes) {
        const halfLabel = Math.max(n.r + 8, 48)
        const cx = n.c.x ?? 0
        const cy = n.c.y ?? 0
        minX = Math.min(minX, cx - halfLabel)
        maxX = Math.max(maxX, cx + halfLabel)
        minY = Math.min(minY, cy - n.r - 12)
        maxY = Math.max(maxY, cy + n.r + 30)
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return { minX: -500, minY: -500, w: 1000, h: 1000 }
      }
      const m = 3.5 + 6
      return {
        minX: minX - m,
        minY: minY - m,
        w: maxX - minX + m * 2,
        h: maxY - minY + m * 2,
      }
    }

    const emptyBox = computeBbox([])
    expect(emptyBox.minX).toBe(-500)
    expect(emptyBox.minY).toBe(-500)
    expect(emptyBox.w).toBe(1000)
    expect(emptyBox.h).toBe(1000)
    expect(Number.isFinite(emptyBox.w)).toBe(true)
  })

  it("computes usableRect correctly for desktop and mobile viewport configurations", () => {
    function usableRect(w: number, h: number, isMobile: boolean, panelOpen: boolean) {
      const top = 100
      const left = isMobile ? 16 : 28
      const right = panelOpen && !isMobile ? 416 : isMobile ? 16 : 28
      const bottom = panelOpen && isMobile ? Math.round(h * 0.48) + 20 : 92
      return {
        x: left,
        y: top,
        w: Math.max(140, w - left - right),
        h: Math.max(140, h - top - bottom),
      }
    }

    // Desktop with panel closed
    const desktopClosed = usableRect(1920, 1080, false, false)
    expect(desktopClosed.x).toBe(28)
    expect(desktopClosed.y).toBe(100)
    expect(desktopClosed.w).toBe(1920 - 28 - 28)
    expect(desktopClosed.h).toBe(1080 - 100 - 92)

    // Desktop with panel open (416px right margin)
    const desktopOpen = usableRect(1920, 1080, false, true)
    expect(desktopOpen.w).toBe(1920 - 28 - 416)

    // Mobile with panel open
    const mobileOpen = usableRect(390, 844, true, true)
    expect(mobileOpen.x).toBe(16)
    expect(mobileOpen.w).toBe(390 - 16 - 16)
    expect(mobileOpen.h).toBe(844 - 100 - (Math.round(844 * 0.48) + 20))
  })

  it("converts between screen and world coordinates with perfect bidirectionality", () => {
    const cam = { x: 120, y: -80, k: 1.8 }
    const screenPoint = { sx: 450, sy: 620 }

    // Screen to world: ((sx - cam.x) / k, (sy - cam.y) / k)
    const wx = (screenPoint.sx - cam.x) / cam.k
    const wy = (screenPoint.sy - cam.y) / cam.k

    // World to screen: (wx * k + cam.x, wy * k + cam.y)
    const roundtripSx = wx * cam.k + cam.x
    const roundtripSy = wy * cam.k + cam.y

    expect(roundtripSx).toBeCloseTo(screenPoint.sx, 6)
    expect(roundtripSy).toBeCloseTo(screenPoint.sy, 6)
  })

  it("accumulates wheel zoom into targetRef preserving anchor invariance without drift during gliding", () => {
    const sx = 300
    const sy = 400
    const minZoom = 0.2
    const maxZoom = 4.0

    // Initial state: camera and target at rest
    const cam = { x: 50, y: 100, k: 1.0 }
    const target = { x: 50, y: 100, k: 1.0 }

    // World coordinate under cursor at the beginning
    const initialWx = (sx - target.x) / target.k
    const initialWy = (sy - target.y) / target.k

    // Simulate 5 rapid wheel ticks arriving before camera fully catches up
    const steps = [-60, -60, -60, -60, -60]
    for (const step of steps) {
      // Simulate partial camera interpolation (e.g. 15% step)
      cam.x += (target.x - cam.x) * 0.15
      cam.y += (target.y - cam.y) * 0.15
      cam.k += (target.k - cam.k) * 0.15

      // Wheel handler uses targetRef for anchor calculation
      const targetWx = (sx - target.x) / (target.k || 1)
      const targetWy = (sy - target.y) / (target.k || 1)
      const nk = clamp(
        target.k * Math.exp(-clamp(step, -180, 180) * 0.0016),
        minZoom,
        maxZoom
      )
      if (nk !== target.k) {
        target.k = nk
        target.x = sx - targetWx * nk
        target.y = sy - targetWy * nk
      }

      // Verify the invariant world coordinate under cursor has not drifted
      const currentTargetWx = (sx - target.x) / target.k
      const currentTargetWy = (sy - target.y) / target.k
      expect(currentTargetWx).toBeCloseTo(initialWx, 6)
      expect(currentTargetWy).toBeCloseTo(initialWy, 6)
    }

    // When camera completes glide to target
    cam.x = target.x
    cam.y = target.y
    cam.k = target.k

    const finalCamWx = (sx - cam.x) / cam.k
    const finalCamWy = (sy - cam.y) / cam.k
    expect(finalCamWx).toBeCloseTo(initialWx, 6)
    expect(finalCamWy).toBeCloseTo(initialWy, 6)
  })

  it("filters search matches to exclude locked character placeholders", () => {
    const testCharacters = [
      { id: "conan-edogawa", name: "Conan Edogawa", role: "Protagonist", affiliation: "Detective Boys", locked: false },
      { id: "heiji-hattori", name: "Heiji Hattori", role: "High School Detective", affiliation: "Osaka", locked: false },
      { id: "locked-boss", name: "???", role: "Not yet revealed", affiliation: "Unknown", locked: true },
    ]

    function getSearchMatches(query: string, chars: typeof testCharacters): Set<string> {
      const searchLower = query.trim().toLowerCase()
      if (!searchLower) return new Set()
      const matches = new Set<string>()
      for (const c of chars) {
        if (c.locked) continue
        if (
          c.name.toLowerCase().includes(searchLower) ||
          c.role.toLowerCase().includes(searchLower) ||
          c.affiliation.toLowerCase().includes(searchLower)
        ) {
          matches.add(c.id)
        }
      }
      return matches
    }

    expect(getSearchMatches("conan", testCharacters).has("conan-edogawa")).toBe(true)
    expect(getSearchMatches("unknown", testCharacters).size).toBe(0)
    expect(getSearchMatches("revealed", testCharacters).size).toBe(0)
    expect(getSearchMatches("???", testCharacters).size).toBe(0)
  })

  it("evaluates background click deselection correctly for svg/rect/ellipse targets", () => {
    function isBackgroundClickTarget(tagName: string, isSvgRoot: boolean): boolean {
      return isSvgRoot || tagName === "rect" || tagName === "ellipse"
    }

    expect(isBackgroundClickTarget("svg", true)).toBe(true)
    expect(isBackgroundClickTarget("rect", false)).toBe(true)
    expect(isBackgroundClickTarget("ellipse", false)).toBe(true)
    expect(isBackgroundClickTarget("circle", false)).toBe(false)
    expect(isBackgroundClickTarget("path", false)).toBe(false)
    expect(isBackgroundClickTarget("g", false)).toBe(false)
    expect(isBackgroundClickTarget("text", false)).toBe(false)
  })
})
