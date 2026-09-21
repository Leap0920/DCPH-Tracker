import { describe, expect, it } from "vitest"
import { scoreEntry } from "@/lib/chat/query"
import {
  buildArcDocs,
  buildCanonDoc,
  buildCharacterDocs,
  buildGadgetDocs,
  buildMovieDocs,
  buildRelationshipDocs,
  buildThreadDocs,
} from "@/lib/ai/corpus/curated"
import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import {
  buildCaseDocs,
  buildEntryDocs,
  type CaseRow,
  type ContentEntryRow,
} from "@/lib/ai/corpus/tracker"
import { toRankable } from "@/lib/ai/corpus/types"

/**
 * Fixtures mirror the real column shapes: an episode with two linked cases on
 * one wiki page, a second episode that is only reachable through its own row,
 * a movie row, and a case whose entry_id is null (it is still retrievable).
 */
const EPISODE: ContentEntryRow = {
  id: "uuid-ep-100",
  slug: "ep-100",
  title: "The Mystery of the Haunted Mansion",
  type: "episode",
  episode_number: 100,
  movie_number: null,
  air_date: "1998-05-11",
  canon_order: 100,
  release_order: 100,
  arc_id: "arc-uuid-1",
  synopsis: "Conan and the Detective Boys visit a mansion whose owner has vanished.",
  dcw_title: "The Haunted Mansion Case",
}

const EPISODE_500: ContentEntryRow = {
  ...EPISODE,
  id: "uuid-ep-500",
  slug: "ep-500",
  title: "Clash of Red and Black (Climax)",
  episode_number: 500,
  canon_order: 500,
  release_order: 500,
  arc_id: null,
  synopsis: null,
  dcw_title: null,
}

const MOVIE: ContentEntryRow = {
  ...EPISODE,
  id: "uuid-mov-19",
  slug: "mov-19",
  title: "The Sunflowers of Inferno",
  type: "movie",
  episode_number: null,
  movie_number: 19,
  air_date: "2015-04-18",
  canon_order: null,
  release_order: null,
  arc_id: null,
  synopsis: "A Van Gogh exhibition turns into a heist.",
  dcw_title: "Sunflowers of Inferno",
  crime_types: ["theft"],
}

const CASE_ONE: CaseRow = {
  id: "uuid-case-1",
  page_title: "The Haunted Mansion Case",
  case_index: 1,
  crime_type: "murder",
  cause_death: "strangulation",
  victim: "Kaoru Kishi",
  suspects: "Ran Mouri",
  location: "the locked study",
  description: "The victim was strangled inside a room locked from within.",
  entry_id: "uuid-ep-100",
}

const CASE_TWO: CaseRow = {
  id: "uuid-case-2",
  page_title: "The Haunted Mansion Case",
  case_index: 2,
  crime_type: "kidnapping",
  cause_death: null,
  victim: "Sonoko Suzuki",
  suspects: null,
  location: null,
  description: "The victim was held in the cellar.",
  entry_id: "uuid-ep-100",
}

const CASE_NO_ENTRY: CaseRow = {
  id: "uuid-case-3",
  page_title: "Sunset Manor Case",
  case_index: 1,
  crime_type: null,
  cause_death: null,
  victim: null,
  suspects: null,
  location: null,
  description: null,
  entry_id: null,
}

const ENTRY_ROWS = [EPISODE, MOVIE]
// Listed in id order ("case:Sunset..." sorts before "case:The Haunted...") so
// the assembly test can assert the plan's literal concatenation.
const CASE_ROWS = [CASE_NO_ENTRY, CASE_ONE, CASE_TWO]

const ARC_TITLES = new Map([["arc-uuid-1", "The Haunted Mansion Arc"]])

function docById(docs: ReturnType<typeof buildEntryDocs>, id: string) {
  return docs.find((doc) => doc.id === id)
}

describe("buildEntryDocs", () => {
  it("returns [] for an empty entry list", () => {
    expect(buildEntryDocs([])).toEqual([])
  })

  it("sets episodeNumber from the row and leaves the movie number unset", () => {
    const doc = docById(buildEntryDocs([EPISODE_500]), "entry:ep-500")
    expect(doc?.episodeNumber).toBe(500)
    expect(toRankable(doc!).movie_number).toBeNull()
  })

  it("sets movieNumber on a movie row and not on an episode row", () => {
    const movie = docById(buildEntryDocs([MOVIE]), "entry:mov-19")
    const episode = docById(buildEntryDocs([EPISODE]), "entry:ep-100")
    expect(movie?.movieNumber).toBe(19)
    expect(movie?.episodeNumber ?? null).toBeNull()
    expect(episode?.movieNumber ?? null).toBeNull()
  })

  it("carries the row's own fields into the document", () => {
    const doc = docById(buildEntryDocs([EPISODE, MOVIE]), "entry:ep-100")
    expect(doc?.source).toBe("content_entries")
    expect(doc?.title).toBe(EPISODE.title)
    expect(doc?.url).toBe("/tracker/ep-100")
    expect(doc?.metadata.slug).toBe("ep-100")
    expect(doc?.metadata.type).toBe("episode")
    expect(doc?.metadata.air_date).toBe("1998-05-11")
    expect(doc?.metadata.canon_order).toBe(100)
    expect(doc?.metadata.release_order).toBe(100)
    expect(doc?.metadata.synopsis).toBe(EPISODE.synopsis)
    expect(doc?.metadata.dcw_title).toBe("The Haunted Mansion Case")
  })

  it("keeps crime_types only when the row has some", () => {
    const movie = docById(buildEntryDocs([MOVIE]), "entry:mov-19")
    const episode = docById(buildEntryDocs([EPISODE]), "entry:ep-100")
    expect(movie?.metadata.crime_types).toEqual(["theft"])
    expect(episode?.metadata).not.toHaveProperty("crime_types")
  })

  it("resolves arc_slug from arcTitleById and records a null otherwise", () => {
    const [withArc] = buildEntryDocs([EPISODE], [], { arcTitleById: ARC_TITLES })
    const [withoutMap] = buildEntryDocs([EPISODE])
    const [withoutArc] = buildEntryDocs([EPISODE_500], [], { arcTitleById: ARC_TITLES })

    expect(withArc.metadata.arc_slug).toBe("The Haunted Mansion Arc")
    expect(withoutMap.metadata.arc_slug).toBeNull()
    expect(withoutArc.metadata.arc_slug).toBeNull()
  })

  it("writes a readable body from the row's own text", () => {
    const doc = docById(buildEntryDocs([EPISODE, MOVIE]), "entry:ep-100")
    // The DCW wiki title is a real alternate name the user may type.
    expect(doc?.body).toContain("The Haunted Mansion Case")
    expect(doc?.body).toContain("Episode 100")
    expect(doc?.body).toContain(EPISODE.synopsis!)
  })

  it("folds the linked case text into metadata.case_text (D6)", () => {
    const doc = docById(buildEntryDocs([EPISODE], [CASE_ONE, CASE_TWO]), "entry:ep-100")
    const caseText = doc?.metadata.case_text
    expect(caseText).toContain("victim Kaoru Kishi")
    expect(caseText).toContain("suspects Ran Mouri")
    // One line per linked case, so several cases stay distinguishable.
    expect(caseText?.split("\n")).toHaveLength(2)
    // The case doc for another page must not leak into this entry.
    expect(caseText).not.toContain("Sunset Manor")
  })

  it("gives an entry with no cases a doc but no case_text", () => {
    const [doc] = buildEntryDocs([EPISODE], [CASE_NO_ENTRY])
    expect(doc.id).toBe("entry:ep-100")
    expect(doc.metadata).not.toHaveProperty("case_text")
  })

  it("reaches the scorer through the injected case text", () => {
    // tokenize() drops anything under three characters and its STOPWORDS
    // include "conan"/"detective"/"episode", so the keyword here is the
    // victim's surname exactly as a user would type it.
    const withCase = docById(buildEntryDocs([EPISODE], [CASE_ONE]), "entry:ep-100")
    const withoutCase = docById(buildEntryDocs([EPISODE]), "entry:ep-100")

    expect(toRankable(withCase!).extra).toContain("Kaoru Kishi")
    expect(scoreEntry(toRankable(withCase!), ["kishi"])).toBeGreaterThan(0)
    // The same entry without its case record scores nothing for that surname:
    // the signal comes from the injection, not from the episode's own text.
    expect(scoreEntry(toRankable(withoutCase!), ["kishi"])).toBe(0)
  })
})

describe("buildCaseDocs", () => {
  it("ids a case by page title and case index (D1)", () => {
    const [doc] = buildCaseDocs([CASE_ONE])
    expect(doc.id).toBe("case:The Haunted Mansion Case#1")
    expect(doc.source).toBe("dcw_cases")
    expect(doc.title).toBe("The Haunted Mansion Case — case 1")
    expect(doc.url).toBe("/cases")
  })

  it("gives two cases on the same wiki page distinct ids", () => {
    const docs = buildCaseDocs([CASE_ONE, CASE_TWO])
    expect(docs.map((doc) => doc.id)).toEqual([
      "case:The Haunted Mansion Case#1",
      "case:The Haunted Mansion Case#2",
    ])
  })

  it("carries the case fields into metadata and the body", () => {
    const [doc] = buildCaseDocs([CASE_ONE])
    expect(doc.metadata.page_title).toBe("The Haunted Mansion Case")
    expect(doc.metadata.case_index).toBe(1)
    expect(doc.metadata.crime_type).toBe("murder")
    expect(doc.metadata.victim).toBe("Kaoru Kishi")
    expect(doc.metadata.suspects).toBe("Ran Mouri")
    expect(doc.metadata.location).toBe("the locked study")
    expect(doc.metadata.cause_death).toBe("strangulation")
    expect(doc.metadata.description).toBe(CASE_ONE.description)
    // FTS has to be able to find "the case where the victim was strangled".
    expect(doc.body).toContain("Kaoru Kishi")
    expect(doc.body).toContain("strangulation")
  })

  it("documents a case with no linked entry", () => {
    const docs = buildCaseDocs([CASE_NO_ENTRY])
    expect(docs.map((doc) => doc.id)).toEqual(["case:Sunset Manor Case#1"])
  })

  it("returns [] for an empty case list", () => {
    expect(buildCaseDocs([])).toEqual([])
  })
})

describe("buildCorpusDocuments", () => {
  it("concatenates the catalog and case groups in a fixed order", () => {
    // The curated sources always follow the two tracker groups, so the plan's
    // "equals the concatenation" is the head of the array, in group order.
    const trackerDocs = [...buildEntryDocs(ENTRY_ROWS, CASE_ROWS), ...buildCaseDocs(CASE_ROWS)]
    const docs = buildCorpusDocuments({ entries: ENTRY_ROWS, cases: CASE_ROWS })
    expect(docs.slice(0, trackerDocs.length)).toEqual(trackerDocs)
  })

  it("sorts each source group by id", () => {
    const docs = buildCorpusDocuments({ entries: [MOVIE, EPISODE] })
    expect(docs.slice(0, 2).map((doc) => doc.id)).toEqual(["entry:ep-100", "entry:mov-19"])
  })

  it("keeps unique ids and is stable across calls", () => {
    const once = buildCorpusDocuments({ entries: ENTRY_ROWS, cases: CASE_ROWS })
    const twice = buildCorpusDocuments({ entries: ENTRY_ROWS, cases: CASE_ROWS })
    expect(new Set(once.map((doc) => doc.id)).size).toBe(once.length)
    expect(twice).toEqual(once)
  })

  it("keeps the first entry when two rows share a slug", () => {
    const first = { ...EPISODE, title: "First row" }
    const second = { ...EPISODE, id: "uuid-ep-100-copy", title: "Second row" }
    // The curated corpus follows, so the collision is counted by id.
    const dupes = buildCorpusDocuments({ entries: [first, second] }).filter(
      (doc) => doc.id === "entry:ep-100"
    )
    expect(dupes).toHaveLength(1)
    expect(dupes[0].title).toBe("First row")
  })

  it("falls back to the curated corpus when handed no input", () => {
    const docs = buildCorpusDocuments()
    expect(docs.length).toBeGreaterThan(250)
    expect(docs.some((doc) => doc.source === "content_entries")).toBe(false)
    expect(docs.some((doc) => doc.source === "dcw_cases")).toBe(false)
    expect(new Set(docs.map((doc) => doc.id)).size).toBe(docs.length)

    // The default path is the seven curated builders, not a separate corpus.
    const curated = [
      ...buildCharacterDocs(),
      ...buildRelationshipDocs(),
      ...buildArcDocs(),
      ...buildThreadDocs(),
      ...buildCanonDoc(),
      ...buildMovieDocs(),
      ...buildGadgetDocs(),
    ]
    expect(docs).toHaveLength(curated.length)
    expect(docs.map((doc) => doc.id).sort()).toEqual(curated.map((doc) => doc.id).sort())
  })
})
