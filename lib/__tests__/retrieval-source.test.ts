import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import {
  createStaticSource,
  createSupabaseSource,
  FUZZY_SIMILARITY_THRESHOLD,
  rowToDocument,
  trigramSimilarity,
  trigrams,
  type DocsRpcClient,
} from "@/lib/ai/retrieval/source"

/**
 * Two adapters behind one port. The Supabase one is what production runs; the
 * static one is what every other test and the eval gate run against (plan
 * deviation D5). The assertions that matter most are the branch semantics the
 * ladder counts candidates with, and failure isolation: a retrieval branch that
 * throws would fail a whole request, so every method must degrade to `[]`.
 */

const FIXTURE_DOCS: CorpusDocument[] = [
  {
    id: "entry:ep-001",
    source: "content_entries",
    title: "Roller Coaster Murder Case",
    body: "A murder aboard a roller coaster at Tropical Land.",
    url: null,
    metadata: {},
    episodeNumber: 1,
  },
  {
    id: "character:ai-haibara",
    source: "characters",
    title: "Ai Haibara",
    body: "Shiho Miyano is a scientist who also answers to Sherry.",
    url: null,
    metadata: {},
    aliases: ["sherry", "shiho", "miyano"],
  },
  {
    id: "relationship:conan-heiji",
    source: "relationships",
    title: "Conan and Heiji",
    body: "Rival detectives who solve cases together.",
    url: null,
    metadata: {},
  },
  {
    id: "movie:19",
    source: "movies",
    title: "The Time-Bombed Skyscraper",
    body: "A bomber targets a skyscraper and demands a ransom.",
    url: null,
    metadata: {},
    movieNumber: 19,
  },
  {
    id: "gadget:voice-changer",
    source: "gadgets",
    title: "Voice-Changing Bowtie",
    body: "Changes the wearer's voice.",
    url: null,
    metadata: {},
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe("trigramSimilarity", () => {
  it("scores identical strings 1 and unrelated strings 0", () => {
    expect(trigramSimilarity("haibara", "haibara")).toBe(1)
    expect(trigramSimilarity("haibara", "xyzzy")).toBe(0)
    expect(trigramSimilarity("haibara", "xyzzy")).toBeLessThan(FUZZY_SIMILARITY_THRESHOLD)
  })

  it("pads like show_trgm", () => {
    // The documented show_trgm('cat') output, which is the whole point of the
    // padding: a bare 3-gram window would score the word start and end lower.
    expect(Array.from(trigrams("cat")).sort()).toEqual(["  c", " ca", "at ", "cat"])
  })

  it("is case-insensitive, like show_trgm", () => {
    expect(trigramSimilarity("Ai Haibara", "ai haibara")).toBe(1)
  })

  it("has no trigrams for an empty value", () => {
    expect(trigrams("").size).toBe(0)
    // The documented contract: no trigrams on either side is 0, not 1.
    expect(trigramSimilarity("", "")).toBe(0)
  })
})

describe("createStaticSource entity", () => {
  it("ranks an episode-number hit first", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [1], names: [], limit: 10 })).resolves.toEqual([
      { id: "entry:ep-001", score: 3 },
    ])
  })

  it("matches a movie number the same way", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [19], names: [], limit: 10 })).resolves.toEqual([
      { id: "movie:19", score: 3 },
    ])
  })

  it("finds an exact normalized title", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [], names: ["ai haibara"], limit: 10 })).resolves.toEqual([
      { id: "character:ai-haibara", score: 2 },
    ])
  })

  it("finds an alias by exact overlap, not substring", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [], names: ["sherry"], limit: 10 })).resolves.toEqual([
      { id: "character:ai-haibara", score: 1.5 },
    ])
    // "sher" is a substring of the alias but not an alias; R1's `&&` operator
    // is an overlap test, so it must not hit.
    await expect(source.entity({ numbers: [], names: ["sher"], limit: 10 })).resolves.toEqual([])
  })

  it("falls back to a title substring", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [], names: ["haibara"], limit: 10 })).resolves.toEqual([
      { id: "character:ai-haibara", score: 1 },
    ])
  })

  it("treats an empty name as no name at all", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    // "".includes-style matching would make every document an entity hit; the
    // SQL guards this with `n <> ''`.
    await expect(source.entity({ numbers: [], names: [""], limit: 10 })).resolves.toEqual([])
  })

  it("returns nothing for a number no document carries", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.entity({ numbers: [999], names: [], limit: 10 })).resolves.toEqual([])
  })

  it("truncates after sorting by score desc, id asc", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    // "a" is a substring of every normalized title, so the order can only come
    // from the id tie-break.
    const hits = await source.entity({ numbers: [], names: ["a"], limit: 2 })

    expect(hits.map((hit) => hit.id)).toEqual(["character:ai-haibara", "entry:ep-001"])
  })
})

describe("createStaticSource fullText", () => {
  it("matches a document whose title carries every token", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.fullText("roller coaster murder", 10)).resolves.toEqual([
      { id: "entry:ep-001", score: 6 },
    ])
  })

  it("weights a title token 2 and a body-only token 1", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.fullText("roller", 10)).resolves.toEqual([
      { id: "entry:ep-001", score: 2 },
    ])
    await expect(source.fullText("tropical land", 10)).resolves.toEqual([
      { id: "entry:ep-001", score: 2 },
    ])
  })

  it("ANDs the tokens instead of ORing them", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    // "coaster" is only in the episode, "skyscraper" only in the movie: no one
    // document carries both, so there is no hit.
    await expect(source.fullText("coaster helicopter", 10)).resolves.toEqual([])
    await expect(source.fullText("coaster skyscraper", 10)).resolves.toEqual([])
  })

  it("returns nothing when the query has no usable tokens", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    // websearch_to_tsquery("the of and") is an empty tsquery. Returning the
    // whole corpus here would be the silent failure that looks like success.
    await expect(source.fullText("the of and", 10)).resolves.toEqual([])
    await expect(source.fullText("", 10)).resolves.toEqual([])
  })
})

describe("createStaticSource fuzzy", () => {
  it("tolerates a typo that fullText cannot", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    const hits = await source.fuzzy("haibarra", ["haibarra"], 10)

    expect(hits[0].id).toBe("character:ai-haibara")
    expect(hits[0].score).toBeGreaterThanOrEqual(FUZZY_SIMILARITY_THRESHOLD)
    // The reason both branches exist: the lexical branch cannot spell-correct.
    await expect(source.fullText("haibarra", 10)).resolves.toEqual([])
  })

  it("keeps the threshold: a nonsense query returns nothing", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    await expect(source.fuzzy("qwertyuiop", ["qwertyuiop"], 10)).resolves.toEqual([])
  })
})

describe("createStaticSource fetch and empty corpus", () => {
  it("hydrates known ids and omits unknown ones", async () => {
    const source = createStaticSource(FIXTURE_DOCS)

    const docs = await source.fetch(["movie:19", "nope"])

    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe("movie:19")
    expect(docs[0].movieNumber).toBe(19)
    await expect(source.fetch([])).resolves.toEqual([])
  })

  it("returns empty results for an empty corpus", async () => {
    const source = createStaticSource([])

    await expect(source.entity({ numbers: [1], names: ["ai"], limit: 10 })).resolves.toEqual([])
    await expect(source.fullText("roller coaster", 10)).resolves.toEqual([])
    await expect(source.fuzzy("haibara", ["haibara"], 10)).resolves.toEqual([])
    await expect(source.fetch(["entry:ep-001"])).resolves.toEqual([])
  })
})

interface RecordedRpc {
  fn: string
  args: Record<string, unknown>
}

interface RecordedSelect {
  table: string
  columns: string
  column: string
  values: string[]
}

/**
 * A structural stand-in for the Supabase client. The adapter is typed against
 * `DocsRpcClient` rather than `@supabase/supabase-js`, so the test can record
 * the calls without a project URL, a key, or a network.
 */
function createRecordingClient(rows: Record<string, unknown>[] = []) {
  const rpcCalls: RecordedRpc[] = []
  const selectCalls: RecordedSelect[] = []

  const client: DocsRpcClient = {
    async rpc(fn, args) {
      rpcCalls.push({ fn, args })
      return { data: [{ id: `from:${fn}`, score: 1 }], error: null }
    },
    from(table) {
      return {
        select(columns) {
          return {
            async in(column, values) {
              selectCalls.push({ table, columns, column, values })
              return { data: rows, error: null }
            },
          }
        },
      }
    },
  }

  return { client, rpcCalls, selectCalls }
}

const MOVIE_ROW: Record<string, unknown> = {
  id: "movie:19",
  source: "movies",
  title: "The Time-Bombed Skyscraper",
  body: "A bomber targets a skyscraper.",
  url: null,
  metadata: { kind: "movie" },
  episode_number: null,
  movie_number: 19,
  aliases: [],
  content_hash: "abc123",
  fts: "'bomber':1",
}

/** A client that fails the way PostgREST does: a result carrying an error. */
function createErroringClient(): DocsRpcClient {
  return {
    async rpc() {
      return { data: null, error: { message: "boom" } }
    },
    from() {
      return {
        select() {
          return {
            async in() {
              return { data: null, error: { message: "boom" } }
            },
          }
        },
      }
    },
  }
}

/** A client that fails the way a dropped connection does: it rejects. */
function createThrowingClient(): DocsRpcClient {
  return {
    async rpc() {
      throw new Error("socket hang up")
    },
    from() {
      return {
        select() {
          return {
            async in() {
              throw new Error("socket hang up")
            },
          }
        },
      }
    },
  }
}

/** One branch, one log line, one empty result. */
function expectDegraded(spy: MockInstance, branch: string, detail: string) {
  expect(spy).toHaveBeenCalledTimes(1)
  expect(spy.mock.calls[0]?.[0]).toContain("[ai-retrieval]")
  expect(spy.mock.calls[0]?.[0]).toContain(branch)
  expect(spy.mock.calls[0]?.[1]).toBe(detail)
  spy.mockClear()
}

describe("createSupabaseSource", () => {
  it("passes each branch's arguments to its RPC and returns the rows", async () => {
    const { client, rpcCalls } = createRecordingClient()
    const source = createSupabaseSource(client)

    await expect(
      source.entity({ numbers: [1, 19], names: ["ai haibara"], limit: 5 })
    ).resolves.toEqual([{ id: "from:ai_docs_entity", score: 1 }])
    await source.fullText("Roller Coaster?", 7)
    await source.fuzzy("haibarra", ["haibarra", "haibara"], 3)

    expect(rpcCalls).toEqual([
      {
        fn: "ai_docs_entity",
        args: { p_numbers: [1, 19], p_names: ["ai haibara"], p_limit: 5 },
      },
      // The raw question, not a tokenized form: websearch_to_tsquery does the
      // parsing server-side, and re-parsing here would drift from it.
      { fn: "ai_docs_fts", args: { p_query: "Roller Coaster?", p_limit: 7 } },
      {
        fn: "ai_docs_fuzzy",
        args: { p_query: "haibarra", p_keywords: ["haibarra", "haibara"], p_limit: 3 },
      },
    ])
  })

  it("maps a null result to an empty list", async () => {
    const client: DocsRpcClient = {
      async rpc() {
        return { data: null, error: null }
      },
      from() {
        return {
          select() {
            return {
              async in() {
                return { data: null, error: null }
              },
            }
          },
        }
      },
    }

    await expect(
      createSupabaseSource(client).entity({ numbers: [1], names: [], limit: 5 })
    ).resolves.toEqual([])
  })

  it("hydrates through from().select().in()", async () => {
    const { client, selectCalls } = createRecordingClient([MOVIE_ROW])
    const source = createSupabaseSource(client)

    const docs = await source.fetch(["movie:19"])

    expect(selectCalls).toEqual([
      { table: "ai_documents", columns: "*", column: "id", values: ["movie:19"] },
    ])
    expect(docs).toEqual([
      {
        id: "movie:19",
        source: "movies",
        title: "The Time-Bombed Skyscraper",
        body: "A bomber targets a skyscraper.",
        url: null,
        metadata: { kind: "movie" },
        episodeNumber: null,
        movieNumber: 19,
        aliases: [],
      },
    ])
  })

  it("skips the query entirely for an empty id list", async () => {
    const { client, selectCalls } = createRecordingClient()

    await expect(createSupabaseSource(client).fetch([])).resolves.toEqual([])

    expect(selectCalls).toEqual([])
  })

  it("degrades every branch to [] when the RPC reports an error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const source = createSupabaseSource(createErroringClient())

    await expect(source.entity({ numbers: [1], names: [], limit: 5 })).resolves.toEqual([])
    expectDegraded(spy, "entity", "boom")

    await expect(source.fullText("roller", 5)).resolves.toEqual([])
    expectDegraded(spy, "fullText", "boom")

    await expect(source.fuzzy("roller", ["roller"], 5)).resolves.toEqual([])
    expectDegraded(spy, "fuzzy", "boom")

    await expect(source.fetch(["entry:ep-001"])).resolves.toEqual([])
    expectDegraded(spy, "fetch", "boom")
  })

  it("degrades every branch to [] when the client itself throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const source = createSupabaseSource(createThrowingClient())

    await expect(source.entity({ numbers: [1], names: [], limit: 5 })).resolves.toEqual([])
    expectDegraded(spy, "entity", "socket hang up")

    await expect(source.fullText("roller", 5)).resolves.toEqual([])
    expectDegraded(spy, "fullText", "socket hang up")

    await expect(source.fuzzy("roller", ["roller"], 5)).resolves.toEqual([])
    expectDegraded(spy, "fuzzy", "socket hang up")

    await expect(source.fetch(["entry:ep-001"])).resolves.toEqual([])
    expectDegraded(spy, "fetch", "socket hang up")
  })
})

describe("rowToDocument", () => {
  it("maps snake_case columns and drops the generated ones", () => {
    const doc = rowToDocument(MOVIE_ROW)

    expect(doc).toEqual({
      id: "movie:19",
      source: "movies",
      title: "The Time-Bombed Skyscraper",
      body: "A bomber targets a skyscraper.",
      url: null,
      metadata: { kind: "movie" },
      episodeNumber: null,
      movieNumber: 19,
      aliases: [],
    })
    // Neither column exists on CorpusDocument: one is the ingest's dedupe key,
    // the other is Postgres's generated tsvector.
    expect(doc).not.toHaveProperty("content_hash")
    expect(doc).not.toHaveProperty("fts")
  })

  it("parses a metadata value that arrives as a JSON string", () => {
    const doc = rowToDocument({ ...MOVIE_ROW, metadata: '{"kind":"movie","year":1999}' })

    expect(doc.metadata).toEqual({ kind: "movie", year: 1999 })
  })

  it("tolerates malformed metadata rather than failing the hydration", () => {
    const doc = rowToDocument({ ...MOVIE_ROW, metadata: "{not json" })

    expect(doc.metadata).toEqual({})
  })

  it("defaults missing metadata and aliases", () => {
    const doc = rowToDocument({
      id: "gadget:voice-changer",
      source: "gadgets",
      title: "Voice-Changing Bowtie",
      body: "Changes the wearer's voice.",
    })

    expect(doc.metadata).toEqual({})
    expect(doc.aliases).toEqual([])
    expect(doc.url).toBeNull()
    expect(doc.episodeNumber).toBeNull()
    expect(doc.movieNumber).toBeNull()
  })
})
