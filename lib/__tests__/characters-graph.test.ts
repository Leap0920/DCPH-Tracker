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
})
