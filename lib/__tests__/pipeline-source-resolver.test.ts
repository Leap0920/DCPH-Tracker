import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collectTrackerRows } from "@/lib/ai/corpus/collect"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"
import {
  CORPUS_CACHE_TTL_MS,
  CORPUS_MAX_ROWS,
  CORPUS_PROBE_MS,
  buildStaticCorpus,
  createCorpusCache,
  resolveRetrievalDeps,
  type AdminRowsClient,
  type ResolverClient,
} from "@/lib/ai/pipeline/source-resolver"
import { REQUEST_TIMEOUT_MS } from "@/lib/request-timeout"

/**
 * The resolver is what keeps the remaster from shipping dark (constraint 12), so
 * these tests pin the four properties the answer path rests on:
 *
 * 1. Reachability, not row count. An empty `ai_documents` is a valid indexed
 *    state, and only a failed probe may mean static. `createSupabaseSource`
 *    answers `[]` for "no rows" and "no table" alike, so a test that counted rows
 *    would pass a resolver that goes static on an empty table.
 * 2. One build per TTL. The tracker read is memoized as a promise, so concurrent
 *    callers share it, and the injected clock is what expires it.
 * 3. Wiki is cache-first and never live here. The live fetch is injected as a
 *    stub, and the tests assert it is not called when the store has a hit.
 * 4. Never throws. A probe error, a rejection, the probe budget firing, a failed
 *    row read, a read that never answers: each returns `RetrievalDeps`, because a
 *    throw here is a 500 on a question the curated corpus can answer.
 */

vi.mock("@/lib/ai/corpus/collect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/corpus/collect")>()
  // Wraps the real collector: counting builds must not change what a build is.
  return { ...actual, collectTrackerRows: vi.fn(actual.collectTrackerRows) }
})

const collectSpy = vi.mocked(collectTrackerRows)

beforeEach(() => {
  collectSpy.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

/** Curated documents that exist in-process, with no database in the loop. */
const CURATED_CHARACTER = "character:ai-haibara"
const CURATED_GUIDE = "guide:canon"

/** A tracker row, and the document id `buildEntryDocs` derives from its slug. */
const ENTRY_ROW: Record<string, unknown> = {
  id: "e1",
  slug: "episode-1",
  title: "Episode 1",
  type: "episode",
  episode_number: 1,
}
const ENTRY_DOC_ID = "entry:episode-1"

const DOC_ROW: Record<string, unknown> = {
  id: ENTRY_DOC_ID,
  source: "content_entries",
  title: "Episode 1",
  body: "Body",
  url: null,
  metadata: {},
  episode_number: 1,
  movie_number: null,
  aliases: null,
}

const LONG_EXTRACT =
  "Ai Haibara is a fictional character in the Detective Conan series, a former member of the Black Organization."

const WIKI_ROW: Record<string, unknown> = {
  cache_key: "wiki:dcw:ai haibara",
  source: "dcw",
  title: "Ai Haibara",
  extract: LONG_EXTRACT,
  url: "https://www.detectiveconanworld.com/wiki/Ai_Haibara",
  fetched_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 60_000).toISOString(),
}

/** What the injected live fetch answers with: a long-enough Wikipedia extract. */
const WIKI_STUB: WikiEvidence[] = [
  {
    title: "Ai Haibara",
    url: "https://en.wikipedia.org/wiki/Ai_Haibara",
    extract: LONG_EXTRACT,
    source: "wikipedia",
  },
]

/** The injected clock: the TTL is asserted by moving this, never by waiting. */
function clock(start = NOW) {
  let at = start
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms
    },
  }
}

interface ProbeCall {
  table: string
  columns: string
  limit: number
}

interface ResolverScript {
  /** What the probe's `limit(1)` read returns. `[]` is a reachable, empty table. */
  probeRows?: Record<string, unknown>[] | null
  /** A PostgREST error: the table is not usable, whatever is on disk. */
  probeError?: { message: string }
  /** A dropped connection rather than a PostgREST reply. */
  probeRejects?: boolean
  /** Never settles: only `CORPUS_PROBE_MS` can end this one. */
  probeHangs?: boolean
  /** What the indexed source's hydrate-by-id read returns. */
  documents?: Record<string, unknown>[]
}

/**
 * A scripted, recording stand-in for the request's Supabase client. The port is
 * structural, so this needs no `@supabase/supabase-js` import and never reaches
 * the network.
 */
function createResolverClient(script: ResolverScript = {}): {
  client: ResolverClient
  probes: ProbeCall[]
  hydrated: string[][]
} {
  const probes: ProbeCall[] = []
  const hydrated: string[][] = []

  const client: ResolverClient = {
    async rpc() {
      return { data: [], error: null }
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            limit(count: number): Promise<{
              data: Record<string, unknown>[] | null
              error: { message: string } | null
            }> {
              probes.push({ table, columns, limit: count })
              if (script.probeRejects) return Promise.reject(new Error("connection refused"))
              if (script.probeHangs) return new Promise(() => {})
              return Promise.resolve({ data: script.probeRows ?? null, error: script.probeError ?? null })
            },
            async in(_column: string, values: string[]) {
              hydrated.push(values)
              return { data: script.documents ?? null, error: null }
            },
          }
        },
      }
    },
  }

  return { client, probes, hydrated }
}

interface AdminScript {
  entries?: Record<string, unknown>[]
  cases?: Record<string, unknown>[]
  /** Every page comes back full: only the row bound can end the read. */
  endlessEntries?: boolean
  /** The tracker read fails outright. */
  trackerError?: Error
  /** The tracker read never answers. */
  trackerHangs?: boolean
  /** What the wiki store's key read returns. */
  wikiRows?: Record<string, unknown>[]
}

interface RangeCall {
  table: string
  from: number
  to: number
}

/** The admin client: `collectTrackerRows`'s paging read and the wiki cache. */
function createAdminClient(script: AdminScript = {}): {
  client: AdminRowsClient
  ranges: RangeCall[]
  wikiReads: string[][]
  upserts: Record<string, unknown>[][]
} {
  const ranges: RangeCall[] = []
  const wikiReads: string[][] = []
  const upserts: Record<string, unknown>[][] = []

  const client: AdminRowsClient = {
    from(table: string) {
      return {
        select(_columns: string) {
          return {
            range(from: number, to: number): Promise<{
              data: Record<string, unknown>[] | null
              error: { message: string } | null
            }> {
              ranges.push({ table, from, to })
              if (script.trackerHangs) return new Promise(() => {})
              if (script.trackerError) return Promise.reject(script.trackerError)

              const rows =
                table === "content_entries"
                  ? script.endlessEntries
                    ? Array.from({ length: to - from + 1 }, (_, i) => ({ id: `entry-${from + i}` }))
                    : (script.entries ?? []).slice(from, to + 1)
                  : (script.cases ?? []).slice(from, to + 1)

              return Promise.resolve({ data: rows, error: null })
            },
            async in(_column: string, values: string[]) {
              wikiReads.push(values)
              return { data: script.wikiRows ?? null, error: null }
            },
          }
        },
        async upsert(values: Record<string, unknown>[]) {
          upserts.push(values)
          return { error: null }
        },
      }
    },
  }

  return { client, ranges, wikiReads, upserts }
}

describe("resolveRetrievalDeps: the indexed path", () => {
  it("an empty ai_documents still means indexed, because the probe asks about the table", async () => {
    // The case that separates a correct resolver from a plausible one: the
    // corpus has not been ingested yet, so the table exists and holds no rows.
    const { client, probes, hydrated } = createResolverClient({
      probeRows: [],
      documents: [DOC_ROW],
    })

    const deps = await resolveRetrievalDeps({
      client,
      admin: null,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    expect(deps.mode).toBe("indexed")
    expect(deps.degraded).toBeNull()

    // One column, one row: the probe asks whether the table is reachable, not
    // what it holds. A row count could never answer that question.
    expect(probes).toEqual([{ table: "ai_documents", columns: "id", limit: 1 }])

    // The static corpus was not built, and the source is the indexed one.
    expect(collectSpy).not.toHaveBeenCalled()
    await expect(deps.source.fetch([ENTRY_DOC_ID])).resolves.toEqual([expect.objectContaining({ id: ENTRY_DOC_ID })])
    expect(hydrated).toEqual([[ENTRY_DOC_ID]])
  })

  it("a probe that reports an error falls back to the static corpus", async () => {
    const { client } = createResolverClient({
      probeError: { message: 'relation "public.ai_documents" does not exist' },
    })
    const { client: admin } = createAdminClient({ entries: [ENTRY_ROW] })

    const deps = await resolveRetrievalDeps({
      client,
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")
    expect(collectSpy).toHaveBeenCalledTimes(1)

    // The static source is real: the tracker row and the curated documents are
    // both retrievable through it.
    await expect(deps.source.fetch([ENTRY_DOC_ID])).resolves.toHaveLength(1)
    await expect(deps.source.fetch([CURATED_CHARACTER])).resolves.toHaveLength(1)
  })

  it("a probe that rejects falls back to the static corpus", async () => {
    const { client } = createResolverClient({ probeRejects: true })
    const { client: admin } = createAdminClient({})

    const deps = await resolveRetrievalDeps({
      client,
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")
  })

  it("a probe that outlives CORPUS_PROBE_MS falls back to the static corpus", async () => {
    vi.useFakeTimers()
    const { client } = createResolverClient({ probeHangs: true })
    const { client: admin } = createAdminClient({})

    const pending = resolveRetrievalDeps({
      client,
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    await vi.advanceTimersByTimeAsync(CORPUS_PROBE_MS)
    const deps = await pending

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")
    // The budget's timer is cleared on the expiry path.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("no client means static without a probe, and the curated corpus is still retrievable", async () => {
    const probe = vi.fn(async () => true)
    const wikiFetch = vi.fn(async () => WIKI_STUB)

    const deps = await resolveRetrievalDeps({
      client: null,
      admin: null,
      probe,
      cache: createCorpusCache(),
      now: () => NOW,
      wikiFetch,
    })

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")
    // A probe cannot make an indexed source out of a client that is not there.
    expect(probe).not.toHaveBeenCalled()

    // Curated-only, and proven by a hit rather than by a flag.
    await expect(deps.source.fetch([CURATED_CHARACTER, CURATED_GUIDE])).resolves.toHaveLength(2)

    // With no client the wiki dep is a resolved [], not a throw, and the live
    // fetch is never reached.
    await expect(deps.wiki("ai haibara")).resolves.toEqual([])
    expect(wikiFetch).not.toHaveBeenCalled()
  })

  it("uses an injected probe in place of the ai_documents read", async () => {
    const { client, probes } = createResolverClient({})
    const { client: admin } = createAdminClient({})
    const probe = vi.fn(async () => false)

    const deps = await resolveRetrievalDeps({
      client,
      admin,
      probe,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(probes).toEqual([])
    expect(deps.mode).toBe("static")
  })
})

describe("resolveRetrievalDeps: the cached static corpus", () => {
  it("two concurrent callers share one build of the tracker rows", async () => {
    const cache = createCorpusCache()
    const { client: admin } = createAdminClient({ entries: [ENTRY_ROW] })

    const [first, second] = await Promise.all([
      resolveRetrievalDeps({ admin, cache, now: () => NOW }),
      resolveRetrievalDeps({ admin, cache, now: () => NOW }),
    ])

    expect(collectSpy).toHaveBeenCalledTimes(1)
    expect(first.mode).toBe("static")
    expect(second.mode).toBe("static")
    expect(first.degraded).toBe("corpus_static")
    await expect(first.source.fetch([ENTRY_DOC_ID])).resolves.toHaveLength(1)
  })

  it("reuses the corpus until CORPUS_CACHE_TTL_MS has passed, then rebuilds", async () => {
    const cache = createCorpusCache()
    const at = clock()
    const { client: admin } = createAdminClient({})

    await resolveRetrievalDeps({ admin, cache, now: at.now })
    expect(collectSpy).toHaveBeenCalledTimes(1)

    at.advance(CORPUS_CACHE_TTL_MS - 1)
    await resolveRetrievalDeps({ admin, cache, now: at.now })
    expect(collectSpy).toHaveBeenCalledTimes(1)

    at.advance(1)
    await resolveRetrievalDeps({ admin, cache, now: at.now })
    expect(collectSpy).toHaveBeenCalledTimes(2)
  })

  it("memoizes the in-flight build by reference and drops a rejected one", async () => {
    const cache = createCorpusCache()
    let builds = 0
    const build = async (): Promise<CorpusDocument[]> => {
      builds += 1
      return []
    }

    const [first, second] = await Promise.all([
      cache.load("k", NOW, build),
      cache.load("k", NOW, build),
    ])

    expect(builds).toBe(1)
    // Shared by reference, not copied: one build, one array.
    expect(second).toBe(first)

    await cache.load("k", NOW + CORPUS_CACHE_TTL_MS - 1, build)
    expect(builds).toBe(1)

    await cache.load("k", NOW + CORPUS_CACHE_TTL_MS, build)
    expect(builds).toBe(2)

    // A failed build is not a cached value: the next caller retries.
    let attempts = 0
    const failing = async (): Promise<CorpusDocument[]> => {
      attempts += 1
      throw new Error("boom")
    }
    await expect(cache.load("failed", NOW, failing)).rejects.toThrow("boom")
    await expect(cache.load("failed", NOW, failing)).rejects.toThrow("boom")
    expect(attempts).toBe(2)
  })
})

describe("buildStaticCorpus", () => {
  it("merges the tracker rows into the in-process curated corpus", async () => {
    const { client, ranges } = createAdminClient({ entries: [ENTRY_ROW] })

    const docs = await buildStaticCorpus(client)
    const ids = docs.map((doc) => doc.id)

    expect(ids).toContain(ENTRY_DOC_ID)
    expect(ids).toContain(CURATED_CHARACTER)
    expect(ids).toContain(CURATED_GUIDE)
    // One page read per table, in the order `collectTrackerRows` issues them.
    expect(ranges.map((call) => call.table)).toEqual(["content_entries", "dcw_cases"])
  })

  it("passes CORPUS_MAX_ROWS to the row read and stops an endless table at it", async () => {
    // The fake never runs out of rows, so only the bound can end the read: the
    // page tells the bound is real, and the spy tells the bound came from here
    // rather than from `collect.ts`'s equal-valued default.
    const { client, ranges } = createAdminClient({ endlessEntries: true })

    const docs = await buildStaticCorpus(client)

    expect(collectSpy).toHaveBeenCalledWith(client, { maxRows: CORPUS_MAX_ROWS })

    // `collect.ts` pages 500 rows at a time, so 20,000 rows is 40 full pages.
    const pages = ranges.filter((call) => call.table === "content_entries")
    expect(pages).toHaveLength(CORPUS_MAX_ROWS / 500)
    expect(pages.at(-1)).toEqual({ table: "content_entries", from: 19_500, to: CORPUS_MAX_ROWS - 1 })

    // The read stopped at the bound, and the documents are still the merged pair.
    expect(docs.some((doc) => doc.id === CURATED_CHARACTER)).toBe(true)
  })
})

describe("resolveRetrievalDeps: the wiki dep", () => {
  it("serves a fresh cached extract without touching the live fetch", async () => {
    const { client: admin, wikiReads } = createAdminClient({ wikiRows: [WIKI_ROW] })
    const wikiFetch = vi.fn(async () => WIKI_STUB)

    const deps = await resolveRetrievalDeps({
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
      wikiFetch,
    })

    await expect(deps.wiki("Ai Haibara")).resolves.toEqual([
      {
        title: "Ai Haibara",
        url: "https://www.detectiveconanworld.com/wiki/Ai_Haibara",
        extract: LONG_EXTRACT,
        source: "dcw",
      },
    ])

    // Cache first: a fresh row costs no fetch.
    expect(wikiFetch).not.toHaveBeenCalled()
    // Both sources are read under the normalised key, and wikiLookup is the
    // filter in the path (a short extract never reaches the caller).
    expect(wikiReads).toEqual([["wiki:dcw:ai haibara", "wiki:wikipedia:ai haibara"]])
  })

  it("falls back to the injected live fetch on a cache miss, and writes back", async () => {
    const { client: admin, upserts } = createAdminClient({})
    const wikiFetch = vi.fn(async () => WIKI_STUB)

    const deps = await resolveRetrievalDeps({
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
      wikiFetch,
    })

    await expect(deps.wiki("ai haibara")).resolves.toEqual(WIKI_STUB)
    expect(wikiFetch).toHaveBeenCalledExactlyOnceWith("ai haibara")
    expect(upserts).toHaveLength(1)
    expect(upserts[0][0]).toMatchObject({ source: "wikipedia", cache_key: "wiki:wikipedia:ai haibara" })
  })
})

describe("resolveRetrievalDeps: the tracker-row failure path", () => {
  it("degrades to curated-only, proven by a hit, and caches that corpus", async () => {
    const cache = createCorpusCache()
    const { client: admin } = createAdminClient({ trackerError: new Error("reading content_entries failed") })

    const deps = await resolveRetrievalDeps({ admin, cache, now: () => NOW })

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")

    // Curated-only is a fact about the corpus: the character answers and the
    // tracker document does not.
    await expect(deps.source.fetch([CURATED_CHARACTER])).resolves.toEqual([
      expect.objectContaining({ id: CURATED_CHARACTER }),
    ])
    await expect(deps.source.fetch([ENTRY_DOC_ID])).resolves.toEqual([])

    // The degraded corpus is cached like any other: a broken database must not
    // be retried on every request.
    await resolveRetrievalDeps({ admin, cache, now: () => NOW })
    expect(collectSpy).toHaveBeenCalledTimes(1)
  })

  it("degrades inside REQUEST_TIMEOUT_MS when the row read never answers", async () => {
    vi.useFakeTimers()
    const { client: admin } = createAdminClient({ trackerHangs: true })

    const pending = resolveRetrievalDeps({
      admin,
      cache: createCorpusCache(),
      now: () => NOW,
    })

    // Let the cache's fetch-once wrapper reach `withTimeout` before advancing.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    const deps = await pending

    expect(deps.mode).toBe("static")
    expect(deps.degraded).toBe("corpus_static")
    await expect(deps.source.fetch([CURATED_GUIDE])).resolves.toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
