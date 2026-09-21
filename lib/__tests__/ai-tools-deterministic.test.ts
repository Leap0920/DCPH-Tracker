import { describe, expect, it } from "vitest"
import { CANON_TYPE_LABELS, MAX_EPISODE, canonTypeForEpisode } from "@/lib/canon-guide"
import { STORY_ARCS, type StoryArc } from "@/lib/arcs-guide"
import {
  CHARACTERS,
  RELATIONSHIPS,
  RELATIONSHIP_META,
  getCharacterById,
  getSpoilerMeta,
  type Character,
  type Relationship,
} from "@/lib/characters-guide"
import { arcForRange } from "@/lib/ai/tools/arc-for-range"
import { classifyEpisode } from "@/lib/ai/tools/classify-episode"
import { lookupCharacter } from "@/lib/ai/tools/lookup-character"

/** Mirrors the tool's rule: an ongoing arc runs to the end of the tracked range. */
function arcEnd(arc: StoryArc): number {
  return arc.episodeEnd ?? MAX_EPISODE
}

/**
 * The arcs the tools should report for [start, end], derived independently here
 * from STORY_ARCS so the expectation never hardcodes a slug.
 */
function expectedArcs(start: number, end: number): StoryArc[] {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return STORY_ARCS.filter((arc) => arc.episodeStart <= hi && arcEnd(arc) >= lo).sort(
    (a, b) => a.order - b.order
  )
}

function fixtureArc(overrides: Partial<StoryArc> = {}): StoryArc {
  return {
    slug: "fixture-arc",
    order: 1,
    title: "Fixture Arc",
    era: "Testing",
    episodeStart: 1,
    episodeEnd: 10,
    mangaRange: "Ch. 1-10",
    years: "2000",
    status: "complete",
    tagline: "A fixture arc.",
    summary: "A fixture arc.",
    keyCharacters: [],
    highlights: [],
    ...overrides,
  }
}

describe("classifyEpisode", () => {
  it("classifies one literal anchor per canon type", () => {
    expect(classifyEpisode(1).canonType).toBe("manga_canon")
    expect(classifyEpisode(6).canonType).toBe("filler")
    expect(classifyEpisode(1187).canonType).toBe("anime_canon")
  })

  it("agrees with canonTypeForEpisode on the anchors", () => {
    for (const episode of [1, 6, 1187]) {
      expect(classifyEpisode(episode).canonType).toBe(canonTypeForEpisode(episode))
    }
  })

  it("classifies every episode from 1 to MAX_EPISODE", () => {
    for (let episode = 1; episode <= MAX_EPISODE; episode++) {
      const result = classifyEpisode(episode)
      expect(result.valid, `episode ${episode}`).toBe(true)
      expect(result.canonType, `episode ${episode}`).not.toBeNull()
      expect(result.canonType, `episode ${episode}`).toBe(canonTypeForEpisode(episode))
      expect(result.canonLabel, `episode ${episode}`).toBe(
        CANON_TYPE_LABELS[result.canonType as keyof typeof CANON_TYPE_LABELS]
      )
    }
  })

  it("rejects numbers outside the tracked range", () => {
    for (const episode of [0, -1, MAX_EPISODE + 1, 1.5, Number.NaN]) {
      const result = classifyEpisode(episode)
      expect(result.valid, `episode ${episode}`).toBe(false)
      expect(result.canonType, `episode ${episode}`).toBeNull()
      expect(result.canonLabel, `episode ${episode}`).toBeNull()
      expect(result.arcs, `episode ${episode}`).toEqual([])
      expect(result.sentence.toLowerCase(), `episode ${episode}`).toContain(
        "outside the tracked range"
      )
    }
  })

  it("states the canon label in the sentence", () => {
    expect(classifyEpisode(1).sentence).toBe("Episode 1 is Manga Canon.")
    for (const episode of [6, 1187]) {
      const result = classifyEpisode(episode)
      expect(result.sentence).toBe(`Episode ${episode} is ${result.canonLabel}.`)
    }
  })

  it("keeps arc membership consistent with STORY_ARCS", () => {
    for (const arc of STORY_ARCS) {
      const slugs = classifyEpisode(arc.episodeStart).arcs.map((entry) => entry.slug)
      expect(slugs, `episode ${arc.episodeStart}`).toContain(arc.slug)
      expect(slugs, `episode ${arc.episodeStart}`).toEqual(
        expectedArcs(arc.episodeStart, arc.episodeStart).map((entry) => entry.slug)
      )
    }
  })

  it("reports no arc for a number no arc covers", () => {
    expect(classifyEpisode(MAX_EPISODE + 1).arcs).toEqual([])
  })

  it("reads the arcs it is handed, not the module array", () => {
    const arcs = [fixtureArc({ slug: "only-arc", episodeStart: 5, episodeEnd: 20, order: 3 })]
    expect(classifyEpisode(10, arcs).arcs).toEqual([{ slug: "only-arc", title: "Fixture Arc" }])
    expect(classifyEpisode(10, []).arcs).toEqual([])
  })
})

describe("arcForRange", () => {
  it("returns exactly the overlapping arcs for a single-arc range", () => {
    const result = arcForRange(1, 50)
    expect(result.map((entry) => entry.slug)).toEqual(expectedArcs(1, 50).map((arc) => arc.slug))
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns exactly the overlapping arcs for a range spanning several arcs", () => {
    const result = arcForRange(100, 500)
    expect(result.map((entry) => entry.slug)).toEqual(expectedArcs(100, 500).map((arc) => arc.slug))
    expect(result.length).toBeGreaterThan(1)
  })

  it("clips each overlap to the requested range", () => {
    for (const entry of arcForRange(100, 500)) {
      expect(entry.overlapStart).toBe(Math.max(100, entry.episodeStart))
      expect(entry.overlapEnd).toBe(Math.min(500, entry.episodeEnd))
      expect(entry.overlapStart).toBeLessThanOrEqual(entry.overlapEnd)
    }
  })

  it("swaps a reversed range", () => {
    expect(arcForRange(500, 100)).toEqual(arcForRange(100, 500))
  })

  it("treats a single argument as a one-episode range", () => {
    expect(arcForRange(300)).toEqual(arcForRange(300, 300))
    expect(arcForRange(300).length).toBeGreaterThan(0)
  })

  it("resolves an ongoing arc's end to MAX_EPISODE", () => {
    const ongoing = STORY_ARCS.find((arc) => arc.episodeEnd === null)
    expect(ongoing, "STORY_ARCS should still contain an ongoing arc").toBeDefined()
    const result = arcForRange(ongoing!.episodeStart)
    expect(result).toHaveLength(1)
    expect(result[0].episodeEnd).toBe(MAX_EPISODE)
  })

  it("resolves a fixture arc's null end to MAX_EPISODE", () => {
    const arcs = [
      fixtureArc({ slug: "ongoing", order: 1, episodeStart: 900, episodeEnd: null }),
    ]
    expect(arcForRange(1000, 1000, arcs)).toEqual([
      {
        slug: "ongoing",
        title: "Fixture Arc",
        episodeStart: 900,
        episodeEnd: MAX_EPISODE,
        overlapStart: 1000,
        // Clipped to the queried range, not to the arc's own end.
        overlapEnd: 1000,
      },
    ])
  })

  it("returns arcs in arc order, not array order", () => {
    const arcs = [
      fixtureArc({ slug: "late", order: 2, episodeStart: 5, episodeEnd: 10 }),
      fixtureArc({ slug: "early", order: 1, episodeStart: 1, episodeEnd: 6 }),
    ]
    expect(arcForRange(5, 6, arcs).map((entry) => entry.slug)).toEqual(["early", "late"])
  })

  it("returns an empty list when no arc covers the range", () => {
    expect(arcForRange(MAX_EPISODE + 100, MAX_EPISODE + 200)).toEqual([])
    expect(arcForRange(0)).toEqual([])
  })
})

describe("lookupCharacter", () => {
  const haibara = lookupCharacter("ai-haibara")

  it("resolves the id, the display name, and the lowercase name alike", () => {
    expect(haibara).not.toBeNull()
    const byName = lookupCharacter("Ai Haibara")
    const byLower = lookupCharacter("ai haibara")
    expect(byName?.character.id).toBe("ai-haibara")
    expect(byLower?.character.id).toBe("ai-haibara")
    expect(byName).toEqual(haibara)
    expect(byLower).toEqual(haibara)
  })

  it("names the corpus document by the character id", () => {
    expect(haibara?.docId).toBe("character:ai-haibara")
  })

  it("resolves an exact alias and a unique substring", () => {
    expect(lookupCharacter("Shiho Miyano")?.character.id).toBe("ai-haibara")
    expect(lookupCharacter("Sherry")?.character.id).toBe("ai-haibara")
    expect(lookupCharacter("haibara")?.character.id).toBe("ai-haibara")
  })

  it("lowercases aliases", () => {
    expect(haibara?.aliases).toEqual(["shiho miyano", "sherry"])
  })

  it("carries the debut and spoiler tier from SPOILER_DATA", () => {
    const meta = getSpoilerMeta("ai-haibara")
    expect(meta?.debut?.episode).toBe(129)
    expect(haibara?.debut.episode).toBe(meta?.debut?.episode)
    expect(haibara?.debut.movie).toBeNull()
    expect(haibara?.debut.spoiler).toBe(meta?.spoiler)
    // The data has no pre-rendered label, so it is derived the same way the
    // corpus builder renders it — the tool and the docs must agree.
    expect(haibara?.debut.label).toBe("Episode 129")
  })

  it("tolerates a character with no spoiler entry at all", () => {
    const bare = lookupCharacter("iori-muga")
    expect(bare?.character.id).toBe("iori-muga")
    expect(getSpoilerMeta("iori-muga")).toBeUndefined()
    expect(bare?.debut).toEqual({ episode: null, movie: null, label: null, spoiler: "none" })
  })

  it("includes every relationship that touches the character, and no other", () => {
    const touching = RELATIONSHIPS.filter(
      (relationship) =>
        relationship.source === "ai-haibara" || relationship.target === "ai-haibara"
    )
    expect(touching.length).toBeGreaterThan(1)
    expect(haibara?.relationships.map((entry) => entry.id)).toEqual(
      touching.map((relationship) => relationship.id)
    )
  })

  it("reports incoming relationships from the source character", () => {
    const incoming = haibara?.relationships.filter((entry) => entry.direction === "incoming") ?? []
    expect(incoming.length).toBeGreaterThan(0)

    const fromConan = incoming.find((entry) => entry.otherId === "conan-edogawa")
    expect(fromConan, "Conan should point at Haibara").toBeDefined()
    expect(fromConan?.otherName).toBe(getCharacterById("conan-edogawa")?.name)
    expect(fromConan?.direction).toBe("incoming")
    expect(fromConan?.type).toBe("secret_identity")
    expect(fromConan?.label).toBe(RELATIONSHIP_META.secret_identity.label)
    expect(fromConan?.detail).not.toBeNull()
    expect(typeof fromConan?.detail).toBe("string")
  })

  it("reports outgoing relationships to the target character", () => {
    const outgoing = haibara?.relationships.filter((entry) => entry.direction === "outgoing") ?? []
    expect(outgoing.length).toBeGreaterThan(0)

    const toGin = outgoing.find((entry) => entry.otherId === "gin")
    expect(toGin, "Haibara should point at Gin").toBeDefined()
    expect(toGin?.otherName).toBe(getCharacterById("gin")?.name)
    expect(toGin?.label).toBe(RELATIONSHIP_META.adversary.label)
  })

  it("returns null for an unknown name", () => {
    expect(lookupCharacter("nobody-mcnotacharacter")).toBeNull()
    expect(lookupCharacter("")).toBeNull()
    expect(lookupCharacter("   ")).toBeNull()
  })

  it("returns null rather than guessing at an ambiguous substring", () => {
    const matching = CHARACTERS.filter((character) =>
      character.name.toLowerCase().includes("kudo")
    )
    expect(matching.length).toBeGreaterThan(1)
    expect(lookupCharacter("kudo")).toBeNull()
  })

  it("consults only the arrays it is handed", () => {
    const fixtureCharacters: Character[] = [
      { id: "fixture-one", name: "Fixture One", role: "Tester", affiliation: "None" },
    ]
    const fixtureRelationships: Relationship[] = [
      { id: "fixture-edge", source: "fixture-one", target: "outsider", type: "adversary" },
    ]

    const found = lookupCharacter("fixture one", fixtureCharacters, fixtureRelationships)
    expect(found?.character.id).toBe("fixture-one")
    expect(found?.docId).toBe("character:fixture-one")
    expect(found?.relationships).toEqual([
      {
        id: "fixture-edge",
        type: "adversary",
        label: RELATIONSHIP_META.adversary.label,
        direction: "outgoing",
        otherId: "outsider",
        // A dangling endpoint still names something; never "undefined".
        otherName: "outsider",
        detail: null,
      },
    ])
    // A real cast member is invisible while a fixture is supplied.
    expect(lookupCharacter("gin", fixtureCharacters, fixtureRelationships)).toBeNull()
  })
})
