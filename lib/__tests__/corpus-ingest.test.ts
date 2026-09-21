import { describe, expect, it } from "vitest"
import { collectCorpus, collectTrackerRows, type CollectClient } from "@/lib/ai/corpus/collect"
import { contentHash } from "@/lib/ai/corpus/hash"
import { ingestCorpus, type IngestClient } from "@/lib/ai/corpus/ingest"
import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

/**
 * Both halves take a structural client, so every test here runs against an
 * in-memory fake (constraint 11: `.env.local` holds a real service-role key, so
 * a test that built a real admin client would reach the live project).
 *
 * The properties that matter are the paging rule -- a short page is the only
 * end signal PostgREST gives -- and idempotence: re-ingesting an unchanged
 * corpus must write nothing at all.
 */

type Row = Record<string, unknown>

interface RangeCall {
  table: string
  columns: string
  from: number
  to: number
}

interface UpsertCall {
  table: string
  values: Row[]
  options?: { onConflict?: string }
}

/** A read client answering `.range()` with PostgREST's inclusive bounds. */
function makeReadClient(tables: Record<string, Row[]>, errorOn?: string) {
  const calls: RangeCall[] = []

  const client: CollectClient = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            async range(from: number, to: number) {
              calls.push({ table, columns, from, to })
              if (table === errorOn) {
                return { data: null, error: { message: `read ${table} failed` } }
              }
              return { data: (tables[table] ?? []).slice(from, to + 1), error: null }
            },
          }
        },
      }
    },
  }

  return { client, calls }
}

/** The same read shape, plus the upsert a fake ingestion needs to record. */
function makeIngestClient(
  options: { existing?: Row[]; readError?: string; upsertError?: string } = {}
) {
  const reads: RangeCall[] = []
  const writes: UpsertCall[] = []
  const existing = options.existing ?? []

  const client: IngestClient = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            async range(from: number, to: number) {
              reads.push({ table, columns, from, to })
              if (options.readError) return { data: null, error: { message: options.readError } }
              return { data: existing.slice(from, to + 1), error: null }
            },
          }
        },
        async upsert(values: Row[], upsertOptions?: { onConflict?: string }) {
          if (options.upsertError) return { error: { message: options.upsertError } }
          writes.push({ table, values, options: upsertOptions })
          return { error: null }
        },
      }
    },
  }

  return { client, reads, writes }
}

const FIXED_NOW = Date.parse("2026-09-19T12:00:00.000Z")

function makeDoc(id: string, overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id,
    source: "gadgets",
    title: `Title ${id}`,
    body: `Body ${id}`,
    url: null,
    metadata: { kind: "gadget" },
    ...overrides,
  }
}

describe("collectTrackerRows", () => {
  it("maps rows onto the structural types with numbers coerced and absent fields nulled", async () => {
    const { client } = makeReadClient({
      content_entries: [
        {
          id: "uuid-ep-1",
          slug: "ep-001",
          title: "Roller Coaster Murder Case",
          type: "episode",
          episode_number: "1",
          movie_number: null,
          air_date: "1996-01-08",
          canon_order: "1",
          release_order: null,
          arc_id: null,
          synopsis: "A murder aboard a roller coaster.",
          dcw_title: "Roller Coaster Murder Case",
          crime_types: ["murder"],
        },
        // Every nullable column absent: the mapper must produce nulls, not NaN
        // and not the string "undefined".
        { id: "uuid-mov-19", slug: "mov-19", title: "Movie 19", type: "movie" },
      ],
      dcw_cases: [
        {
          id: "uuid-case-1",
          page_title: "Roller Coaster Murder Case",
          case_index: "2",
          crime_type: "Murder",
          cause_death: null,
          victim: "Kishida",
          suspects: "Conan",
          location: "Tropical Land",
          description: null,
          entry_id: "uuid-ep-1",
        },
      ],
    })

    const { entries, cases } = await collectTrackerRows(client)

    expect(entries).toEqual([
      {
        id: "uuid-ep-1",
        slug: "ep-001",
        title: "Roller Coaster Murder Case",
        type: "episode",
        episode_number: 1,
        movie_number: null,
        air_date: "1996-01-08",
        canon_order: 1,
        release_order: null,
        arc_id: null,
        synopsis: "A murder aboard a roller coaster.",
        dcw_title: "Roller Coaster Murder Case",
        crime_types: ["murder"],
      },
      {
        id: "uuid-mov-19",
        slug: "mov-19",
        title: "Movie 19",
        type: "movie",
        episode_number: null,
        movie_number: null,
        air_date: null,
        canon_order: null,
        release_order: null,
        arc_id: null,
        synopsis: null,
        dcw_title: null,
        crime_types: [],
      },
    ])

    expect(cases).toEqual([
      {
        id: "uuid-case-1",
        page_title: "Roller Coaster Murder Case",
        case_index: 2,
        crime_type: "Murder",
        cause_death: null,
        victim: "Kishida",
        suspects: "Conan",
        location: "Tropical Land",
        description: null,
        entry_id: "uuid-ep-1",
      },
    ])
  })

  it("pages on inclusive ranges and stops at the first short page", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `e${n}`, slug: `ep-00${n}`, title: `T${n}`, type: "episode" }))
    const { client, calls } = makeReadClient({ content_entries: rows, dcw_cases: [] })

    const { entries } = await collectTrackerRows(client, { pageSize: 2 })

    expect(entries).toHaveLength(3)
    // Grouped per table: the two tables may be read concurrently, so the order
    // of the calls between them is not part of the contract.
    const entryCalls = calls.filter((call) => call.table === "content_entries")
    const caseCalls = calls.filter((call) => call.table === "dcw_cases")
    expect(entryCalls.map((call) => [call.from, call.to])).toEqual([
      [0, 1],
      [2, 3],
    ])
    expect(caseCalls.map((call) => [call.from, call.to])).toEqual([[0, 1]])
    expect(entryCalls[0].columns).toContain("slug")
    expect(caseCalls[0].columns).toContain("page_title")
  })

  it("stops at maxRows rather than reading the whole table", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, slug: `ep-${i}`, title: `T${i}`, type: "episode" }))
    const { client, calls } = makeReadClient({ content_entries: rows, dcw_cases: [] })

    const { entries } = await collectTrackerRows(client, { pageSize: 2, maxRows: 3 })

    expect(entries).toHaveLength(3)
    // The last request is clamped to the guard: without it the run would read
    // up to pageSize - 1 rows past maxRows.
    expect(calls.filter((call) => call.table === "content_entries")).toEqual([
      { table: "content_entries", columns: expect.stringContaining("id"), from: 0, to: 1 },
      { table: "content_entries", columns: expect.stringContaining("id"), from: 2, to: 2 },
    ])
  })

  it("rejects when a read fails", async () => {
    const entriesFailure = makeReadClient({ content_entries: [], dcw_cases: [] }, "content_entries")
    const casesFailure = makeReadClient({ content_entries: [], dcw_cases: [] }, "dcw_cases")

    await expect(collectTrackerRows(entriesFailure.client)).rejects.toThrow("read content_entries failed")
    await expect(collectTrackerRows(casesFailure.client)).rejects.toThrow("read dcw_cases failed")
  })
})

describe("collectCorpus", () => {
  it("assembles the read rows together with the curated corpus", async () => {
    const { client } = makeReadClient({
      content_entries: [
        {
          id: "uuid-ep-1",
          slug: "ep-001",
          title: "Roller Coaster Murder Case",
          type: "episode",
          episode_number: 1,
          movie_number: null,
          air_date: "1996-01-08",
          canon_order: 1,
          release_order: 1,
          arc_id: null,
          synopsis: null,
          dcw_title: null,
        },
      ],
      dcw_cases: [],
    })

    const docs = await collectCorpus(client)
    const expected = buildCorpusDocuments({
      entries: (await collectTrackerRows(client)).entries,
      cases: [],
    })

    // A read with no rows still yields the curated half: an empty corpus would
    // otherwise look like a successful run over a database that answered.
    expect(docs.length).toBeGreaterThan(250)
    expect(docs.map((doc) => doc.id)).toEqual(expected.map((doc) => doc.id))
    expect(docs.some((doc) => doc.id === "entry:ep-001")).toBe(true)
    expect(docs.some((doc) => doc.id === "character:ai-haibara")).toBe(true)
  })

  it("rejects when a read fails", async () => {
    const { client } = makeReadClient({ content_entries: [], dcw_cases: [] }, "dcw_cases")

    await expect(collectCorpus(client)).rejects.toThrow("read dcw_cases failed")
  })
})

describe("ingestCorpus", () => {
  it("reads the existing hashes with the inclusive 500-row paging rule", async () => {
    const existing = Array.from({ length: 1200 }, (_, index) => ({
      id: `doc-${index}`,
      content_hash: `hash-${index}`,
    }))
    const { client, reads, writes } = makeIngestClient({ existing })

    const report = await ingestCorpus({ client, documents: [makeDoc("doc-new")] })

    expect(reads.map((call) => [call.from, call.to])).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ])
    expect(reads.every((call) => call.table === "ai_documents")).toBe(true)
    expect(reads.every((call) => call.columns === "id,content_hash")).toBe(true)
    expect(report).toMatchObject({ total: 1, inserted: 1, updated: 0, unchanged: 0, upserted: 1 })
    expect(report.ms).toBeGreaterThanOrEqual(0)
    expect(writes).toHaveLength(1)
  })

  it("upserts new documents in chunkSize batches with onConflict id", async () => {
    const docs = [makeDoc("a"), makeDoc("b"), makeDoc("c")]
    const { client, writes } = makeIngestClient()

    const report = await ingestCorpus({ client, documents: docs, chunkSize: 1 })

    expect(report).toMatchObject({ total: 3, inserted: 3, updated: 0, unchanged: 0, upserted: 3 })
    expect(writes).toHaveLength(3)
    expect(writes.map((write) => write.values.length)).toEqual([1, 1, 1])
    expect(writes.map((write) => write.values[0].id)).toEqual(["a", "b", "c"])
    expect(writes.every((write) => write.options?.onConflict === "id")).toBe(true)
  })

  it("batches at 200 rows by default", async () => {
    const docs = Array.from({ length: 201 }, (_, index) => makeDoc(`doc-${index}`))
    const { client, writes } = makeIngestClient()

    const report = await ingestCorpus({ client, documents: docs })

    expect(writes.map((write) => write.values.length)).toEqual([200, 1])
    expect(report.upserted).toBe(201)
  })

  it("performs zero writes when every document is unchanged", async () => {
    const docs = [makeDoc("a"), makeDoc("b"), makeDoc("c")]
    const { client, reads, writes } = makeIngestClient({
      existing: docs.map((doc) => ({ id: doc.id, content_hash: contentHash(doc) })),
    })

    const report = await ingestCorpus({ client, documents: docs })

    expect(report).toMatchObject({ total: 3, inserted: 0, updated: 0, unchanged: 3, upserted: 0 })
    expect(writes).toHaveLength(0)
    expect(reads).toHaveLength(1)
  })

  it("re-upserts a document whose body changed with a fresh content_hash", async () => {
    const docs = [makeDoc("a"), makeDoc("b")]
    const { client, writes } = makeIngestClient({
      existing: docs.map((doc) => ({ id: doc.id, content_hash: contentHash(doc) })),
    })
    const changed: CorpusDocument = { ...docs[1], body: "A rewritten body" }

    const report = await ingestCorpus({ client, documents: [docs[0], changed] })

    expect(report).toMatchObject({ total: 2, inserted: 0, updated: 1, unchanged: 1, upserted: 1 })
    expect(writes).toHaveLength(1)
    expect(writes[0].values[0].content_hash).toBe(contentHash(changed))
    expect(writes[0].values[0].content_hash).not.toBe(contentHash(docs[1]))
  })

  it("computes every count and sends nothing for a dry run", async () => {
    const docs = [makeDoc("a"), makeDoc("b")]
    const { client, writes } = makeIngestClient({
      existing: [{ id: "a", content_hash: contentHash(docs[0]) }],
    })

    const report = await ingestCorpus({ client, documents: docs, dryRun: true })

    expect(report).toMatchObject({ total: 2, inserted: 1, updated: 0, unchanged: 1, upserted: 0 })
    expect(writes).toHaveLength(0)
  })

  it("maps a document onto the ai_documents row without the generated fts column", async () => {
    const doc = makeDoc("entry:ep-001", {
      source: "content_entries",
      title: "Roller Coaster Murder Case",
      body: "A murder aboard a roller coaster.",
      url: "/tracker/ep-001",
      metadata: { slug: "ep-001", type: "episode" },
      episodeNumber: 1,
      aliases: ["roller coaster"],
    })
    const { client, writes } = makeIngestClient()

    await ingestCorpus({ client, documents: [doc], now: () => FIXED_NOW })

    const row = writes[0].values[0]
    // `fts` is a generated column; naming it in an insert makes Postgres reject
    // the whole statement, so the key set is asserted exactly.
    expect(Object.keys(row).sort()).toEqual([
      "aliases",
      "body",
      "content_hash",
      "episode_number",
      "id",
      "metadata",
      "movie_number",
      "source",
      "title",
      "updated_at",
      "url",
    ])
    expect(row).not.toHaveProperty("fts")
    expect(row.id).toBe("entry:ep-001")
    expect(row.source).toBe("content_entries")
    expect(row.metadata).toEqual({ slug: "ep-001", type: "episode" })
    expect(row.aliases).toEqual(["roller coaster"])
    expect(row.episode_number).toBe(1)
    expect(row.movie_number).toBeNull()
    expect(row.updated_at).toBe("2026-09-19T12:00:00.000Z")
  })

  it("defaults absent numbers to null and absent aliases to an empty array", async () => {
    const { client, writes } = makeIngestClient()

    await ingestCorpus({ client, documents: [makeDoc("gadget:1")], now: () => FIXED_NOW })

    const row = writes[0].values[0]
    expect(row.episode_number).toBeNull()
    expect(row.movie_number).toBeNull()
    expect(row.aliases).toEqual([])
    expect(row.url).toBeNull()
  })

  it("stamps every row with the injected clock", async () => {
    const docs = [makeDoc("a"), makeDoc("b")]
    const { client, writes } = makeIngestClient()

    const report = await ingestCorpus({ client, documents: docs, chunkSize: 1, now: () => FIXED_NOW })

    const stamps = writes.flatMap((write) => write.values.map((value) => value.updated_at))
    expect(stamps).toEqual(["2026-09-19T12:00:00.000Z", "2026-09-19T12:00:00.000Z"])
    // The report is as deterministic as the injected clock.
    expect(report.ms).toBe(0)
  })

  it("rejects when the existing-hash read fails", async () => {
    const { client } = makeIngestClient({ readError: "read failed" })

    await expect(ingestCorpus({ client, documents: [makeDoc("a")] })).rejects.toThrow("read failed")
  })

  it("rejects when an upsert fails", async () => {
    const { client } = makeIngestClient({ upsertError: "duplicate key" })

    await expect(ingestCorpus({ client, documents: [makeDoc("a")] })).rejects.toThrow("duplicate key")
  })

  it("does nothing at all for an empty corpus", async () => {
    const { client, reads, writes } = makeIngestClient({ existing: [{ id: "a", content_hash: "x" }] })

    const report = await ingestCorpus({ client, documents: [] })

    expect(report).toMatchObject({ total: 0, inserted: 0, updated: 0, unchanged: 0, upserted: 0 })
    expect(writes).toHaveLength(0)
    // One read: an empty first page is short, so the loop stops there.
    expect(reads).toHaveLength(1)
  })
})
