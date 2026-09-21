import { describe, expect, it } from "vitest"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import { createStaticSource, type DocumentSource } from "@/lib/ai/retrieval/source"
import { searchCatalog } from "@/lib/ai/tools/search-catalog"
import { searchCases } from "@/lib/ai/tools/search-cases"

/**
 * The two source-backed search tools, over a deliberately mixed fixture.
 *
 * Three rules these tests pin, all of them invisible in a single-source corpus:
 *
 * 1. The source filter runs AFTER ranking. The corpus is one index (the Phase 2
 *    RPCs take no source argument), so the candidate pool a query pulls is
 *    mixed; truncating to the caller's `limit` before keeping only
 *    `content_entries` would let a character-heavy query return [] while the
 *    matching episode sits at rank 13. "filters before truncating" is that test.
 * 2. A rejecting source degrades to [], never to a 500.
 * 3. The fuzzy branch's hits survive ranking. "roller coaser" is a typo no
 *    full-text token can match — `ai_docs_fts` is token AND, and the corpus has
 *    no "coaser" anywhere — so only trigram similarity (0.48 against the title,
 *    above the 0.3 threshold) can reach the episode.
 *
 * The fixture is six documents: two catalog entries, two case records, one
 * character and one arc, so every filter assertion can fail.
 */

const coasterDoc: CorpusDocument = {
  id: "entry:ep-001",
  source: "content_entries",
  title: "Roller Coaster Murder Case",
  body: "A murder on a roller coaster at Tropical Land.",
  url: "/tracker/ep-001",
  metadata: { air_date: "1996-01-08" },
  episodeNumber: 1,
}

const lodgeDoc: CorpusDocument = {
  id: "entry:ep-004",
  source: "content_entries",
  title: "Ski Lodge Case",
  body: "A locked-room murder at a mountain lodge.",
  url: "/tracker/ep-004",
  metadata: { air_date: "1996-02-05" },
  episodeNumber: 4,
}

const coasterCase: CorpusDocument = {
  id: "case:roller-coaster-murder-case#0",
  source: "dcw_cases",
  title: "Roller Coaster Murder Case",
  body: "Victim: Kishida. The victim was killed on the roller coaster.",
  url: "/cases/roller-coaster-murder-case",
  metadata: { page_title: "Roller Coaster Murder Case", victim: "Kishida", case_index: 0 },
}

const lodgeCase: CorpusDocument = {
  id: "case:ski-lodge-murder-case#0",
  source: "dcw_cases",
  title: "Ski Lodge Murder Case",
  body: "Victim: Kawashima. A locked room at the ski lodge.",
  url: "/cases/ski-lodge-murder-case",
  metadata: { page_title: "Ski Lodge Murder Case", victim: "Kawashima", case_index: 0 },
}

const haibaraDoc: CorpusDocument = {
  id: "character:ai-haibara",
  source: "characters",
  title: "Ai Haibara",
  body: "A former Black Organization chemist who also answers to Sherry.",
  url: "/characters/ai-haibara",
  metadata: {},
  aliases: ["sherry", "shiho"],
}

const blackOrgDoc: CorpusDocument = {
  id: "arc:black-organization",
  source: "arcs",
  title: "Black Organization Arc",
  body: "The ongoing confrontation with the Black Organization.",
  url: "/arcs/black-organization",
  metadata: { status: "ongoing" },
}

const CORPUS = [coasterDoc, lodgeDoc, coasterCase, lodgeCase, haibaraDoc, blackOrgDoc]

/** A source that fails every branch, so each guard has something to catch. */
const rejectingSource: DocumentSource = {
  async entity() {
    throw new Error("entity unavailable")
  },
  async fullText() {
    throw new Error("full-text unavailable")
  },
  async fuzzy() {
    throw new Error("fuzzy unavailable")
  },
  async fetch() {
    throw new Error("hydration unavailable")
  },
}

describe("searchCatalog", () => {
  const source = createStaticSource(CORPUS)

  it("returns only catalog documents, with the matching episode first", async () => {
    const result = await searchCatalog("roller coaster murder", source)

    // The case record shares the episode's title and is retrieved by the same
    // branches, so this is also the filter working on a real collision.
    expect(result.map((entry) => entry.doc.id)).toEqual(["entry:ep-001"])
    expect(result.every((entry) => entry.doc.source === "content_entries")).toBe(true)
  })

  it("finds the episode through the fuzzy branch when the query is misspelled", async () => {
    // "coaser" appears in no document: full text cannot match it, and the
    // entity branch is not run (the query holds no number). Only the fuzzy
    // branch can return the episode, which is why it must not be dropped after
    // ranking.
    const result = await searchCatalog("roller coaser", source)

    expect(result.map((entry) => entry.doc.id)).toEqual(["entry:ep-001"])
    expect(result[0].origins).toContain("fuzzy")
  })

  it("puts the exact episode number first", async () => {
    // "episode" is a stopword and "1" is too short to be a keyword, so the
    // query carries no full-text tokens at all — the entity branch and
    // BONUS_EXACT_NUMBER are the whole answer.
    const result = await searchCatalog("episode 1", source)

    expect(result[0].doc.id).toBe("entry:ep-001")
    expect(result[0].origins).toEqual(["entity"])
    expect(result[0].score).toBeGreaterThan(0)
  })

  it("returns [] when the only match is not a catalog document", async () => {
    // Sherry is Haibara's alias and appears in her document alone. The hit is
    // real — the filter is what removes it, not a retrieval miss.
    expect(await searchCatalog("sherry", source)).toEqual([])
  })

  it("returns [] when nothing matches", async () => {
    expect(await searchCatalog("xyzzy", source)).toEqual([])
  })

  it("returns one document for limit: 1", async () => {
    const result = await searchCatalog("roller coaster murder", source, { limit: 1 })

    expect(result.map((entry) => entry.doc.id)).toEqual(["entry:ep-001"])
  })

  it("filters before truncating, so a crowd of other sources cannot hide the episode", async () => {
    // Twelve characters outscore the episode, whose only match is the word
    // "Haibara" in its body — the scorer reads titles and case fields, not
    // bodies, so it ranks the episode below all twelve. Truncating to the
    // caller's limit before filtering would return [] here; the candidate pool
    // is what the ranking limit has to be.
    const crowd: CorpusDocument[] = Array.from(
      { length: 12 },
      (_, index): CorpusDocument => ({
        id: `character:haibara-double-${index}`,
        source: "characters",
        title: `Haibara Double ${index}`,
        body: "A disguise used by the Black Organization.",
        url: null,
        metadata: {},
      })
    )
    const buriedEpisode: CorpusDocument = {
      id: "entry:ep-129",
      source: "content_entries",
      title: "The Girl from the Black Organization",
      body: "Ai Haibara appears for the first time.",
      url: "/tracker/ep-129",
      metadata: { air_date: "1999-01-04" },
      episodeNumber: 129,
    }

    const result = await searchCatalog("haibara", createStaticSource([...crowd, buriedEpisode]), {
      limit: 1,
    })

    expect(result.map((entry) => entry.doc.id)).toEqual(["entry:ep-129"])
  })
})

describe("searchCases", () => {
  const source = createStaticSource(CORPUS)

  it("returns only case documents for a victim name", async () => {
    const result = await searchCases("kishida", source)

    expect(result.map((entry) => entry.doc.id)).toEqual(["case:roller-coaster-murder-case#0"])
    expect(result.every((entry) => entry.doc.source === "dcw_cases")).toBe(true)
    expect(result[0].score).toBeGreaterThan(0)
  })

  it("returns [] when the only match is a catalog document", async () => {
    // The mirror image of the catalog filter test: the episode is retrievable
    // and must not appear in a case search.
    const result = await searchCases("coaster", source)

    expect(result.some((entry) => entry.doc.source === "content_entries")).toBe(false)
  })

  it("returns [] when nothing matches", async () => {
    expect(await searchCases("xyzzy", source)).toEqual([])
  })
})

describe("search failures", () => {
  it("resolves to [] when every branch rejects", async () => {
    // A retrieval failure must degrade an answer, not fail a request: the
    // tools are called from a route, and a rejection there is a 500.
    await expect(searchCatalog("roller coaster murder", rejectingSource)).resolves.toEqual([])
    await expect(searchCatalog("episode 1", rejectingSource)).resolves.toEqual([])
    await expect(searchCases("kishida", rejectingSource)).resolves.toEqual([])
  })

  it("resolves to [] when only hydration rejects", async () => {
    const staticSource = createStaticSource(CORPUS)
    const brokenHydration: DocumentSource = {
      ...staticSource,
      async fetch() {
        throw new Error("hydration unavailable")
      },
    }

    await expect(searchCatalog("roller coaster murder", brokenHydration)).resolves.toEqual([])
    await expect(searchCases("kishida", brokenHydration)).resolves.toEqual([])
  })
})
