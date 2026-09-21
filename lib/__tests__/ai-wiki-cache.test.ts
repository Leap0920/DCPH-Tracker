import { afterEach, describe, expect, it, vi } from "vitest"
import { createWikiCache, wikiCacheKey, type WikiCacheClient } from "@/lib/ai/wiki-cache"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"

/**
 * The cache is the only thing between a lore question and a live MediaWiki
 * call, so these tests are about the two properties that make it safe to ship:
 * a hit costs no fetch, and every failure — timeout, rejection, a store that
 * errors or rejects — still resolves with the best answer available rather
 * than throwing. A wiki outage degrades an answer; it never fails a request.
 *
 * Expiry is driven by the injected clock, never by waiting: `now` moves by
 * assignment, and the one test that does wait waits on a 10ms box.
 */

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const QUERY = "Who is Haibara?"

/** What the fetcher returns for one question: one extract per source. */
const FETCHED: WikiEvidence[] = [
  {
    title: "Ai Haibara",
    url: "https://dcw.example/ai-haibara",
    extract: "A former Black Organization chemist who took APTX 4869.",
    source: "dcw",
  },
  {
    title: "Ai Haibara",
    url: "https://en.wikipedia.org/wiki/Ai_Haibara",
    extract: "A fictional character in the Detective Conan series.",
    source: "wikipedia",
  },
]

/** The `dcw` row as it comes back out of the cache. */
const CACHED: WikiEvidence = {
  title: "Ai Haibara",
  url: "https://dcw.example/ai-haibara",
  extract: "cached extract",
  source: "dcw",
}

/**
 * A stored row exactly as PostgREST hands it back: snake_case columns, a
 * timestamptz as ISO text. Fresh for one ttl from NOW unless overridden.
 */
function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cache_key: wikiCacheKey(QUERY, "dcw"),
    source: "dcw",
    title: CACHED.title,
    extract: CACHED.extract,
    url: CACHED.url,
    fetched_at: new Date(NOW - TTL_MS).toISOString(),
    expires_at: new Date(NOW + TTL_MS).toISOString(),
    ...overrides,
  }
}

interface ReadCall {
  table: string
  columns: string
  column: string
  values: string[]
}

interface UpsertCall {
  table: string
  values: Record<string, unknown>[]
  options?: { onConflict?: string }
}

interface FakeClientOptions {
  rows?: Record<string, unknown>[]
  readError?: string
  /** A dropped connection rejects instead of returning `{ error }`. */
  readThrows?: boolean
  upsertError?: string
  upsertThrows?: boolean
  /** The store is unreachable before the query is even built. */
  fromThrows?: boolean
}

/** A structural stand-in for the PostgREST client: records, never connects. */
function fakeClient(options: FakeClientOptions = {}) {
  const reads: ReadCall[] = []
  const upserts: UpsertCall[] = []

  const client: WikiCacheClient = {
    from(table) {
      if (options.fromThrows) throw new Error("socket hang up")
      return {
        select(columns) {
          return {
            async in(column, values) {
              if (options.readThrows) throw new Error("socket hang up")
              reads.push({ table, columns, column, values })
              if (options.readError) return { data: null, error: { message: options.readError } }
              return { data: options.rows ?? [], error: null }
            },
          }
        },
        async upsert(values, upsertOptions) {
          if (options.upsertThrows) throw new Error("socket hang up")
          upserts.push({ table, values, options: upsertOptions })
          if (options.upsertError) return { error: { message: options.upsertError } }
          return { error: null }
        },
      }
    },
  }

  return { client, reads, upserts }
}

function fetcherOf(evidence: WikiEvidence[]) {
  return vi.fn(async () => evidence)
}

function rejectingFetcher() {
  return vi.fn(async (): Promise<WikiEvidence[]> => {
    throw new Error("wiki down")
  })
}

/** Failures are logged by design; silence the noise and assert on the calls. */
function muteErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("wikiCacheKey", () => {
  it("ignores case and punctuation so one question has one key", () => {
    expect(wikiCacheKey("Who is Haibara?", "dcw")).toBe(wikiCacheKey("who is haibara", "dcw"))
    expect(wikiCacheKey("Who is Haibara?", "dcw")).toBe("wiki:dcw:who is haibara")
  })

  it("keeps the two sources apart", () => {
    expect(wikiCacheKey("who is haibara", "wikipedia")).toBe("wiki:wikipedia:who is haibara")
  })
})

describe("createWikiCache lookup", () => {
  it("reads both sources' keys with one select", async () => {
    const { client, reads } = fakeClient()
    const cache = createWikiCache({ client, fetcher: fetcherOf(FETCHED), now: () => NOW })

    await cache.lookup(QUERY)

    expect(reads).toEqual([
      {
        table: "ai_wiki_cache",
        columns: "cache_key,source,title,extract,url,fetched_at,expires_at",
        column: "cache_key",
        values: ["wiki:dcw:who is haibara", "wiki:wikipedia:who is haibara"],
      },
    ])
  })

  it("fetches on a miss and writes the evidence back", async () => {
    const { client, upserts } = fakeClient()
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW, ttlMs: TTL_MS })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(QUERY)

    expect(upserts).toHaveLength(1)
    const [call] = upserts
    expect(call?.table).toBe("ai_wiki_cache")
    expect(call?.options).toEqual({ onConflict: "cache_key" })
    expect(call?.values).toHaveLength(2)

    const [dcw, wikipedia] = call?.values ?? []
    // The timestamptz column takes ISO text, but the value is exactly now +
    // ttlMs: the row must expire a ttl after it was written, not on the next
    // read.
    expect(dcw?.cache_key).toBe(wikiCacheKey(QUERY, "dcw"))
    expect(dcw?.source).toBe("dcw")
    expect(dcw?.title).toBe(FETCHED[0].title)
    expect(dcw?.extract).toBe(FETCHED[0].extract)
    expect(dcw?.url).toBe(FETCHED[0].url)
    expect(dcw?.fetched_at).toBe(new Date(NOW).toISOString())
    expect(dcw?.expires_at).toBe(new Date(NOW + TTL_MS).toISOString())

    // Each row carries its own source in its key: a dcw extract must not
    // answer a wikipedia lookup.
    expect(wikipedia?.cache_key).toBe(wikiCacheKey(QUERY, "wikipedia"))
    expect(wikipedia?.source).toBe("wikipedia")
    expect(wikipedia?.extract).toBe(FETCHED[1].extract)
  })

  it("serves a fresh row without touching the fetcher", async () => {
    const { client, upserts } = fakeClient({ rows: [storedRow()] })
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW, ttlMs: TTL_MS })

    await expect(cache.lookup(QUERY)).resolves.toEqual([CACHED])

    expect(fetcher).not.toHaveBeenCalled()
    expect(upserts).toEqual([])
  })

  it("serves a row that never expires", async () => {
    const { client } = fakeClient({ rows: [storedRow({ expires_at: null })] })
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual([CACHED])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("refetches an expired row", async () => {
    const { client, upserts } = fakeClient({
      rows: [storedRow({ expires_at: new Date(NOW - 1).toISOString() })],
    })
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW, ttlMs: TTL_MS })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(upserts).toHaveLength(1)
  })

  it("gives up on a fetcher that never answers", async () => {
    const fetcher = vi.fn(() => new Promise<WikiEvidence[]>(() => {}))
    const cache = createWikiCache({ fetcher, now: () => NOW, timeoutMs: 10 })

    const started = Date.now()
    await expect(cache.lookup(QUERY)).resolves.toEqual([])

    // Loose on purpose: it catches a missing time box (which would hang CI)
    // without turning a loaded machine into a flaky failure.
    expect(Date.now() - started).toBeLessThan(500)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("degrades to [] when the fetcher rejects and nothing is cached", async () => {
    const { client } = fakeClient()
    const cache = createWikiCache({ client, fetcher: rejectingFetcher(), now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual([])
  })

  it("serves the stale row when the fetcher rejects", async () => {
    const { client } = fakeClient({
      rows: [storedRow({ expires_at: new Date(NOW - TTL_MS).toISOString() })],
    })
    const cache = createWikiCache({ client, fetcher: rejectingFetcher(), now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual([CACHED])
  })

  it("serves the stale row when the fetcher times out", async () => {
    const { client } = fakeClient({
      rows: [storedRow({ expires_at: new Date(NOW - 1).toISOString() })],
    })
    const cache = createWikiCache({
      client,
      fetcher: vi.fn(() => new Promise<WikiEvidence[]>(() => {})),
      now: () => NOW,
      timeoutMs: 10,
    })

    await expect(cache.lookup(QUERY)).resolves.toEqual([CACHED])
  })

  it("still fetches when the read errors", async () => {
    const errors = muteErrors()
    const { client } = fakeClient({ readError: "boom" })
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain("[ai-wiki]")
  })

  it("still fetches when the read rejects outright", async () => {
    const errors = muteErrors()
    const { client } = fakeClient({ readThrows: true })
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client, fetcher, now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain("[ai-wiki]")
  })

  it("still returns the evidence when the upsert errors", async () => {
    const errors = muteErrors()
    const { client } = fakeClient({ upsertError: "boom" })
    const cache = createWikiCache({ client, fetcher: fetcherOf(FETCHED), now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(String(errors.mock.calls[0]?.[0])).toContain("[ai-wiki]")
  })

  it("still returns the evidence when the upsert throws", async () => {
    const errors = muteErrors()
    const { client } = fakeClient({ upsertThrows: true })
    const cache = createWikiCache({ client, fetcher: fetcherOf(FETCHED), now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(String(errors.mock.calls[0]?.[0])).toContain("[ai-wiki]")
  })

  it("fetches with no store at all", async () => {
    const fetcher = fetcherOf(FETCHED)
    const cache = createWikiCache({ client: null, fetcher, now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual(FETCHED)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("resolves to [] with neither store nor fetcher", async () => {
    await expect(createWikiCache().lookup(QUERY)).resolves.toEqual([])
    await expect(createWikiCache({ client: null, fetcher: null }).lookup(QUERY)).resolves.toEqual([])
  })

  it("serves stale rows when there is no fetcher at all", async () => {
    const { client } = fakeClient({ rows: [storedRow({ expires_at: new Date(NOW - 1).toISOString() })] })
    const cache = createWikiCache({ client, now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual([CACHED])
  })

  it("ignores a row whose source is not a wiki source", async () => {
    const { client } = fakeClient({ rows: [storedRow({ source: "planet" })] })
    const cache = createWikiCache({ client, fetcher: rejectingFetcher(), now: () => NOW })

    await expect(cache.lookup(QUERY)).resolves.toEqual([])
  })

  it("caches a blank extract as returned", async () => {
    const blank: WikiEvidence[] = [
      { title: "Stub", url: "https://dcw.example/stub", extract: "", source: "dcw" },
    ]
    const { client, upserts } = fakeClient()
    const cache = createWikiCache({ client, fetcher: fetcherOf(blank), now: () => NOW })

    // Dropping stubs is wikiLookup's job; the cache stores what it was given.
    await expect(cache.lookup(QUERY)).resolves.toEqual(blank)
    expect(upserts[0]?.values[0]?.extract).toBe("")
  })
})

describe("createWikiCache put", () => {
  it("writes one keyed row per source", async () => {
    const { client, upserts } = fakeClient()
    const cache = createWikiCache({ client, now: () => NOW, ttlMs: TTL_MS })

    await cache.put(QUERY, FETCHED)

    expect(upserts[0]?.values.map((value) => value.cache_key)).toEqual([
      wikiCacheKey(QUERY, "dcw"),
      wikiCacheKey(QUERY, "wikipedia"),
    ])
    expect(upserts[0]?.values[0]?.expires_at).toBe(new Date(NOW + TTL_MS).toISOString())
  })

  it("keeps one row per source when the fetcher repeats a source", async () => {
    const twice: WikiEvidence[] = [FETCHED[0], { ...FETCHED[0], extract: "second dcw extract" }]
    const { client, upserts } = fakeClient()
    const fetcher = fetcherOf(twice)
    const cache = createWikiCache({ client, fetcher, now: () => NOW })

    // An upsert batch that hits `cache_key` twice is rejected by Postgres's
    // ON CONFLICT, so the cache has to collapse it before writing.
    await expect(cache.lookup(QUERY)).resolves.toEqual(twice)
    expect(upserts[0]?.values).toHaveLength(1)
    expect(upserts[0]?.values[0]?.extract).toBe(FETCHED[0].extract)
  })

  it("is a no-op without a client and without evidence", async () => {
    await expect(createWikiCache({ now: () => NOW }).put(QUERY, FETCHED)).resolves.toBeUndefined()

    const { client, upserts } = fakeClient()
    await expect(createWikiCache({ client, now: () => NOW }).put(QUERY, [])).resolves.toBeUndefined()
    expect(upserts).toEqual([])
  })
})
