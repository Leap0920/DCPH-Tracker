import { normalizeText } from "@/lib/chat/query"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"

/** Names live here so this module never imports Supabase or its types. */
const WIKI_TABLE = "ai_wiki_cache"
const WIKI_COLUMNS = "cache_key,source,title,extract,url,fetched_at,expires_at"

/** Both sources are read on every lookup; a question may be cached for one only. */
const WIKI_SOURCES = ["dcw", "wikipedia"] as const

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 1200

export interface WikiCacheRow {
  cacheKey: string
  source: string
  title: string
  extract: string
  url: string | null
  fetchedAt: number
  /** Epoch ms; null means "never expires". */
  expiresAt: number | null
}

export interface WikiCacheClient {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[]
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): Promise<{ error: { message: string } | null }>
  }
}

export interface WikiCacheDeps {
  client?: WikiCacheClient | null
  /** Injected so tests never touch the network. Production passes searchDcwWiki. */
  fetcher?: ((query: string) => Promise<WikiEvidence[]>) | null
  now?: () => number
  /** Default 7 days. */
  ttlMs?: number
  /** Default 1200ms — the spec's per-round wiki ceiling. */
  timeoutMs?: number
}

export interface WikiCache {
  lookup(query: string): Promise<WikiEvidence[]>
  put(query: string, evidence: WikiEvidence[]): Promise<void>
}

/**
 * One entry per (question, source).
 *
 * Normalising is what makes the key stable across phrasing: "Who is Haibara?"
 * and "who is haibara" are one question and must not cost two rows and two
 * fetches.
 */
export function wikiCacheKey(query: string, source: string): string {
  return `wiki:${source}:${normalizeText(query)}`
}

/** Epoch ms for a timestamptz column; NaN when the value cannot be dated. */
function parseEpochMs(value: unknown): number {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") return Date.parse(value)
  return Number.NaN
}

/**
 * Epoch ms for a row's `expires_at`, with `null` meaning "never expires".
 *
 * A present-but-unparseable value returns NaN, which compares false against
 * every clock: a row we cannot date is refetched rather than pinning a stale
 * extract forever.
 */
function parseExpiresAt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return parseEpochMs(value)
}

/** ISO text for a timestamptz column; null when the epoch cannot be represented. */
function toIsoOrNull(ms: number): string | null {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function rowToCacheRow(row: Record<string, unknown>): WikiCacheRow {
  return {
    cacheKey: row.cache_key == null ? "" : String(row.cache_key),
    source: row.source == null ? "" : String(row.source),
    title: row.title == null ? "" : String(row.title),
    extract: row.extract == null ? "" : String(row.extract),
    url: row.url == null ? null : String(row.url),
    // The epoch is this row's honest "unknown": fetchedAt is informational.
    fetchedAt: parseEpochMs(row.fetched_at) || 0,
    expiresAt: parseExpiresAt(row.expires_at),
  }
}

/** Narrows a stored source string to the two sources this port speaks. */
function wikiSource(value: string): WikiEvidence["source"] | null {
  return value === "dcw" || value === "wikipedia" ? value : null
}

interface CacheHit {
  evidence: WikiEvidence
  fresh: boolean
}

function toCacheHit(row: WikiCacheRow, at: number): CacheHit | null {
  const source = wikiSource(row.source)
  if (!source) return null
  return {
    evidence: {
      title: row.title,
      // A null column is the store's "no url"; the port's url is a plain string.
      url: row.url ?? "",
      extract: row.extract,
      source,
    },
    fresh: row.expiresAt === null || row.expiresAt > at,
  }
}

/**
 * The store's read path.
 *
 * A failure here is a miss, not an error: the fetcher can answer either way,
 * and a broken store must not deny the caller a fresh extract.
 */
async function readRows(client: WikiCacheClient, keys: string[]): Promise<WikiCacheRow[]> {
  try {
    const { data, error } = await client.from(WIKI_TABLE).select(WIKI_COLUMNS).in("cache_key", keys)
    if (error) {
      console.error("[ai-wiki] read failed", error.message)
      return []
    }
    if (!Array.isArray(data)) return []
    return data.map(rowToCacheRow)
  } catch (err) {
    console.error("[ai-wiki] read threw", err)
    return []
  }
}

/**
 * Runs the fetcher under a wall-clock box, returning null on timeout or
 * rejection.
 *
 * One path for both failures because the caller answers them the same way —
 * stale rows if any, [] otherwise — and a caller that cannot tell a slow wiki
 * from a broken one cannot accidentally treat one as the other.
 */
async function fetchWithin(
  fetcher: (query: string) => Promise<WikiEvidence[]>,
  query: string,
  timeoutMs: number
): Promise<WikiEvidence[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<WikiEvidence[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("wiki fetch timed out")), timeoutMs)
      // Called from inside the executor so a fetcher that throws synchronously
      // rejects like any other failure instead of escaping the box.
      Promise.resolve()
        .then(() => fetcher(query))
        .then(resolve, reject)
    })
  } catch {
    // Timeout and rejection are the same answer: nothing fresh this round.
    return null
  } finally {
    // A timer left armed would keep the process (and a test run) alive.
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * A time-boxed cache in front of the live DCW/Wikipedia fetch.
 *
 * Every path resolves. A broken store, a dead wiki and a missing dependency
 * all cost freshness, never availability — the ladder calls this per round,
 * and an exception escaping here would take down an answer the corpus alone
 * could have given.
 */
export function createWikiCache(deps: WikiCacheDeps = {}): WikiCache {
  const client = deps.client ?? null
  const fetcher = deps.fetcher ?? null
  const now = deps.now ?? Date.now
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /**
   * Writes fresh evidence back, one row per item, each under its own source's
   * key. A write failure is logged and swallowed: the answer is already in
   * hand, and a missed write only costs the next lookup a fetch.
   */
  async function put(query: string, evidence: WikiEvidence[]): Promise<void> {
    if (!client || evidence.length === 0) return

    const at = now()
    // A non-finite ttl cannot be an ISO date; it means "never expires", which
    // is what the nullable column already says.
    const expiresAt = toIsoOrNull(at + ttlMs)
    // ...but fetched_at is not nullable, so an unrepresentable clock still has
    // to write something.
    const fetchedAt = toIsoOrNull(at) ?? new Date(0).toISOString()

    const seen = new Set<string>()
    const rows: Record<string, unknown>[] = []
    for (const item of evidence) {
      const cacheKey = wikiCacheKey(query, item.source)
      // One key can back one row, and a batch that hits the same key twice is
      // rejected by ON CONFLICT, so a repeated source keeps its first extract.
      if (seen.has(cacheKey)) continue
      seen.add(cacheKey)
      rows.push({
        cache_key: cacheKey,
        source: item.source,
        title: item.title,
        extract: item.extract,
        url: item.url,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
      })
    }

    try {
      const { error } = await client.from(WIKI_TABLE).upsert(rows, { onConflict: "cache_key" })
      if (error) console.error("[ai-wiki] upsert failed", error.message)
    } catch (err) {
      console.error("[ai-wiki] upsert threw", err)
    }
  }

  async function lookup(query: string): Promise<WikiEvidence[]> {
    const keys = WIKI_SOURCES.map((source) => wikiCacheKey(query, source))
    const rows = client ? await readRows(client, keys) : []
    const at = now()

    const hits = rows
      .map((row) => toCacheHit(row, at))
      .filter((hit): hit is CacheHit => hit !== null)

    const fresh = hits.filter((hit) => hit.fresh)
    if (fresh.length > 0) return fresh.map((hit) => hit.evidence)

    const fetched = fetcher ? await fetchWithin(fetcher, query, timeoutMs) : null
    // Nothing fresh: whatever is left is stale, and a stale extract beats none.
    if (fetched === null) return hits.map((hit) => hit.evidence)

    await put(query, fetched)
    return fetched
  }

  return { lookup, put }
}
