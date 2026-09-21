import { describe, expect, it } from "vitest"
import {
  buildArcDocs,
  buildCanonDoc,
  buildCharacterDocs,
  buildGadgetDocs,
  buildMovieDocs,
  buildRelationshipDocs,
  buildThreadDocs,
} from "@/lib/ai/corpus/curated"
import { contentHash, stableStringify } from "@/lib/ai/corpus/hash"
import { toRankable, type CorpusDocument } from "@/lib/ai/corpus/types"
import { CHARACTERS, RELATIONSHIPS, type Character, type Relationship } from "@/lib/characters-guide"
import { RECURRING_THREADS, STORY_ARCS } from "@/lib/arcs-guide"
import { MAINLINE_MOVIES } from "@/lib/movies-guide"

/** A hand-built document for the hash and projection tests. */
function makeDoc(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: "entry:ep-001",
    source: "content_entries",
    title: "Roller Coaster Murder Case",
    body: "The first case.",
    url: "/tracker/ep-001",
    metadata: {},
    ...overrides,
  }
}

/**
 * Two characters and two edges, with the second endpoint deliberately absent
 * from the character list. The real curated data has no dangling edges (every
 * source/target resolves to a character id), so the skip branch can only be
 * covered from a fixture.
 */
const FIXTURE_CHARACTERS: Character[] = [
  { id: "fixture-alpha", name: "Alpha Person", role: "First", affiliation: "Fixture" },
  { id: "fixture-beta", name: "Beta Person", role: "Second", affiliation: "Fixture" },
  { id: "fixture-gamma", name: "Gamma Person", role: "Third", affiliation: "Fixture" },
]

const FIXTURE_RELATIONSHIPS: Relationship[] = [
  {
    id: "fixture-alpha-beta",
    source: "fixture-alpha",
    target: "fixture-beta",
    type: "friendship",
    detail: "Both endpoints resolve.",
  },
  {
    id: "fixture-beta-gamma",
    source: "fixture-beta",
    target: "fixture-gamma",
    type: "rivalry",
    detail: "The target is missing from the character list.",
  },
]

const ALL_DOCS = [
  ...buildCharacterDocs(),
  ...buildRelationshipDocs(),
  ...buildArcDocs(),
  ...buildThreadDocs(),
  ...buildCanonDoc(),
  ...buildMovieDocs(),
  ...buildGadgetDocs(),
]

describe("curated builders", () => {
  it("is a pure function of its argument", () => {
    expect(buildCharacterDocs([])).toEqual([])
    expect(buildCharacterDocs([FIXTURE_CHARACTERS[0]])).toHaveLength(1)
    expect(buildArcDocs([])).toEqual([])
    expect(buildThreadDocs([])).toEqual([])
    expect(buildMovieDocs([])).toEqual([])
    expect(buildGadgetDocs([])).toEqual([])
    expect(buildGadgetDocs([{ name: "Widget", aliases: ["Thing"], description: "A test." }])).toHaveLength(1)
  })

  it("assembles unique ids across all seven builders", () => {
    // The invariant that matters more than any single count: the ingestion keys
    // on the id, so a collision silently overwrites a document.
    const ids = ALL_DOCS.map((doc) => doc.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("emits one document per curated record", () => {
    expect(buildCharacterDocs()).toHaveLength(CHARACTERS.length)
    expect(buildCharacterDocs().length).toBeGreaterThanOrEqual(90)

    // Relationship docs skip dangling edges, so a shortfall is legal; a large
    // one would mean the character ids stopped matching the relationship ids.
    expect(buildRelationshipDocs().length).toBeLessThanOrEqual(RELATIONSHIPS.length)
    expect(buildRelationshipDocs().length).toBeGreaterThanOrEqual(150)

    expect(buildArcDocs()).toHaveLength(STORY_ARCS.length)
    expect(buildThreadDocs()).toHaveLength(RECURRING_THREADS.length)
    expect(buildMovieDocs()).toHaveLength(MAINLINE_MOVIES.length)
    expect(buildGadgetDocs()).toHaveLength(8)
    expect(buildCanonDoc()).toHaveLength(1)
  })

  it("is deterministic across calls", () => {
    const builders = [
      () => buildCharacterDocs(),
      () => buildRelationshipDocs(),
      () => buildArcDocs(),
      () => buildThreadDocs(),
      () => buildCanonDoc(),
      () => buildMovieDocs(),
      () => buildGadgetDocs(),
    ]
    for (const build of builders) expect(build()).toEqual(build())
  })

  it("gives every document a non-empty title and a namespaced id", () => {
    for (const doc of ALL_DOCS) {
      expect(doc.title.length, doc.id).toBeGreaterThan(0)
      expect(doc.id, doc.id).toMatch(/^[a-z_]+:[^\s]+$/)
    }
  })

  it("points arc docs at the arcs page and leaves gadget docs url-less", () => {
    for (const doc of buildArcDocs()) expect(doc.url).toMatch(/^\/arcs\//)
    for (const doc of buildGadgetDocs()) expect(doc.url).toBeNull()
  })
})

describe("curated character docs", () => {
  const docs = buildCharacterDocs()
  const haibara = docs.find((doc) => doc.id === "character:ai-haibara")

  it("builds the Haibara doc from its aliases and affiliation", () => {
    expect(haibara).toBeDefined()
    expect(haibara?.body).toContain("Affiliation:")
    expect(haibara?.body).toContain("Sherry")
    expect(haibara?.aliases).toContain("sherry")
    // Alias tokens, not just phrases: "Shiho Miyano" has to answer a query that
    // only ever says "shiho".
    expect(haibara?.aliases).toContain("shiho")
    expect(haibara?.aliases).toContain("miyano")
  })

  it("never marks a character doc as that numbered entry", () => {
    // The deliberate non-pollution rule from types.ts: a number hit is
    // near-certain in R1, so a debut must not turn 40 characters into
    // "episode 129" answers.
    for (const doc of docs) expect(doc.episodeNumber, doc.id).toBeUndefined()
  })

  it("folds debut metadata into the body", () => {
    expect(docs.some((doc) => doc.body.includes("First appearance:"))).toBe(true)
  })
})

describe("buildRelationshipDocs", () => {
  it("skips a relationship whose endpoint is not in the character list", () => {
    expect(buildRelationshipDocs(FIXTURE_RELATIONSHIPS, [])).toEqual([])

    // Both endpoints of the intact edge resolve; gamma is deliberately absent.
    const docs = buildRelationshipDocs(FIXTURE_RELATIONSHIPS, [
      FIXTURE_CHARACTERS[0],
      FIXTURE_CHARACTERS[1],
    ])
    expect(docs.map((doc) => doc.id)).toEqual(["relationship:fixture-alpha-beta"])
    expect(docs[0].title).toBe("Alpha Person and Beta Person")
  })
})

describe("buildMovieDocs", () => {
  it("numbers the movie 19 doc after the guide, not after the array index", () => {
    const movie = MAINLINE_MOVIES.find((entry) => entry.number === 19)
    const doc = buildMovieDocs().find((entry) => entry.id === "movie:19")

    expect(movie).toBeDefined()
    expect(doc?.movieNumber).toBe(19)
    expect(doc?.title).toBe(movie?.english)
  })
})

describe("stableStringify", () => {
  it("drops undefined values and sorts nested keys", () => {
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}')
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 0 })).toBe('{"a":0,"b":{"c":2,"d":1}}')
  })
})

describe("contentHash", () => {
  it("is stable when metadata key insertion order differs", () => {
    const first = makeDoc({ metadata: { synopsis: "A case.", victim: "Hiroshi" } })
    const second = makeDoc({ metadata: { victim: "Hiroshi", synopsis: "A case." } })
    expect(contentHash(first)).toBe(contentHash(second))
  })

  it("changes when the body changes", () => {
    expect(contentHash(makeDoc({ body: "One" }))).not.toBe(contentHash(makeDoc({ body: "Two" })))
  })

  it("ignores alias order because the hash sorts them", () => {
    expect(contentHash(makeDoc({ aliases: ["beta", "alpha"] }))).toBe(
      contentHash(makeDoc({ aliases: ["alpha", "beta"] }))
    )
  })
})

describe("toRankable", () => {
  it("projects metadata onto the scorer's flat fields", () => {
    const rankable = toRankable(
      makeDoc({
        episodeNumber: 57,
        metadata: {
          victim: "Hiroshi Agasa",
          location: "Ski lodge",
          case_text: "Conan and Heiji looked inside the window",
          air_date: "1997-05-05",
        },
      })
    )

    expect(rankable.victim).toBe("Hiroshi Agasa")
    expect(rankable.location).toBe("Ski lodge")
    expect(rankable.extra).toBe("Conan and Heiji looked inside the window")
    expect(rankable.air_date).toBe("1997-05-05")
    expect(rankable.episode_number).toBe(57)
    expect(rankable.movie_number).toBeNull()
  })
})
