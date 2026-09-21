/**
 * Which corpus the answer path reads: the indexed one when it is reachable, the
 * in-process one otherwise (D2, constraint 12).
 *
 * `createSupabaseSource` returns `[]` for both "no rows" and "no table"
 * (`lib/ai/retrieval/source.ts:216-273`), so reachability can never be inferred
 * from what a query returns. This module asks directly — one `ai_documents`
 * select under a 400 ms box — and only then picks the indexed source. Anything
 * else (an error object, a rejection, the budget expiring, no client at all)
 * builds the same documents the ingestion route would write, in process, cached
 * under a TTL. Without this, every question asked before the `20260919*`
 * migrations are applied would answer "I could not find a reliable answer".
 *
 * Everything here is structural and injected: no Supabase client is constructed,
 * the clock is a parameter, and the live wiki fetch is a default that tests
 * replace with a stub. Importing this module performs no I/O and reads no
 * environment.
 */
import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import { collectTrackerRows } from "@/lib/ai/corpus/collect"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"
import {
  createStaticSource,
  createSupabaseSource,
  type DocumentSource,
  type SearchHit,
} from "@/lib/ai/retrieval/source"
import { wikiLookup } from "@/lib/ai/tools/wiki-lookup"
import { createWikiCache } from "@/lib/ai/wiki-cache"
import { REQUEST_TIMEOUT_MS, withTimeout } from "@/lib/request-timeout"

/** How long a built static corpus is reused before the tracker tables are read
 *  again. Five minutes keeps ingest's freshness without a read per request. */
export const CORPUS_CACHE_TTL_MS = 5 * 60 * 1000

/** The hard bound on the reachability probe. Constraint 10: a stage that
 *  overruns degrades, it never extends the request. */
export const CORPUS_PROBE_MS = 400

/** The runaway guard on the tracker read, the same bound the ingestion route
 *  passes (`collect.ts` defaults to the same number). */
export const CORPUS_MAX_ROWS = 20_000

/** `indexed` reads `ai_documents` through the RPCs; `static` reads the corpus
 *  built in this process. */
export type CorpusMode = "indexed" | "static"

/** The degrade reason a static corpus reports, for `ai_request_log`. */
const STATIC_DEGRADED = "corpus_static"

export interface RetrievalDeps {
  source: DocumentSource
  wiki: (query: string) => Promise<WikiEvidence[]>
  mode: CorpusMode
  /** `"corpus_static"` in static mode, never null; null in indexed mode. */
  degraded: string | null
}

/**
 * What the probe and the indexed source need from the request's Supabase client.
 *
 * `createSupabaseSource` is typed against `DocsRpcClient`, and this interface is
 * a structural superset of it — the extra `limit` is the probe's read — so the
 * same value feeds both without a cast.
 */
export interface ResolverClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: SearchHit[] | null; error: { message: string } | null }>
  from(table: string): {
    select(columns: string): {
      /** The reachability probe: one column, one row. */
      limit(count: number): Promise<{
        data: Record<string, unknown>[] | null
        error: { message: string } | null
      }>
      /** `createSupabaseSource`'s hydrate-by-id read. */
      in(
        column: string,
        values: string[]
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}

/**
 * What the admin client has to offer: `collectTrackerRows`'s paged read and the
 * wiki cache's read/write. One structural type because PostgREST's builder
 * carries every method whatever table it was opened on.
 */
export interface AdminRowsClient {
  from(table: string): {
    select(columns: string): {
      range(
        from: number,
        to: number
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
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

/**
 * The static corpus cache.
 *
 * `load` memoizes the *promise*, not just the result, so two requests arriving
 * together pay for one read of the tracker tables; the value is then reused
 * until the caller's clock has moved `CORPUS_CACHE_TTL_MS` past the build.
 */
export interface CorpusCache {
  load(key: string, at: number, build: () => Promise<CorpusDocument[]>): Promise<CorpusDocument[]>
}

/**
 * The one key the static corpus is cached under.
 *
 * Every build reads the same two tables on top of the same in-process curated
 * documents, so the content is a function of time, not of the caller. Keying on
 * the client object would defeat the TTL outright: the route builds a fresh
 * admin client per request, so nothing would ever hit.
 */
const STATIC_CORPUS_KEY = "static"

/** The probe's read: one column of one row, whatever the table holds. */
const PROBE_TABLE = "ai_documents"
const PROBE_COLUMNS = "id"

export function createCorpusCache(): CorpusCache {
  // Completed builds and in-flight ones are separate maps so that the entry a
  // caller reads and the promise a caller joins are never confused.
  const completed = new Map<string, { docs: CorpusDocument[]; at: number }>()
  const inFlight = new Map<string, Promise<CorpusDocument[]>>()

  return {
    load(key, at, build) {
      const cached = completed.get(key)
      if (cached && at - cached.at < CORPUS_CACHE_TTL_MS) return Promise.resolve(cached.docs)

      const pending = inFlight.get(key)
      if (pending) return pending

      // `Promise.resolve().then` turns a build that throws synchronously into a
      // rejection, so `load` has exactly one failure shape.
      const started = Promise.resolve()
        .then(build)
        .then(
          (docs) => {
            completed.set(key, { docs, at })
            inFlight.delete(key)
            return docs
          },
          (error: unknown) => {
            // A rejected build is not a cached value: the next caller retries.
            inFlight.delete(key)
            throw error
          }
        )

      inFlight.set(key, started)
      return started
    },
  }
}

/** Production's cache: one per process, so the TTL is shared across requests. */
const defaultCache = createCorpusCache()

/**
 * True only when `ai_documents` is reachable.
 *
 * Deliberately not "did it return rows": an empty table is the expected state
 * before ingestion and must keep the indexed path, while a missing table must
 * not. `createSupabaseSource` answers `[]` for both, so the question is asked
 * here or nowhere. An absent `error` counts as reachable because PostgREST sets
 * the field on every reply; a client that omits it is a bug in the client.
 */
async function probeIndexed(client: ResolverClient): Promise<boolean> {
  try {
    const { error } = await client.from(PROBE_TABLE).select(PROBE_COLUMNS).limit(1)
    return !error
  } catch {
    return false
  }
}

/** A rejection and a budget expiry are the same answer here — static — and
 *  neither may escape: the caller is on the answer path. */
async function probeWithin(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return await withTimeout(probe(), CORPUS_PROBE_MS)
  } catch {
    return false
  }
}

/**
 * The live DCW/Wikipedia fetch, imported lazily on purpose.
 *
 * `lib/chat/search` reaches `lib/env`, which throws at import time when the
 * Supabase variables are unset (the CI case), so a static import here would make
 * this module — and every test of it — unimportable wherever `.env.local` is
 * absent. The import also keeps module construction free of I/O. `createWikiCache`
 * time-boxes whatever fetcher it is given.
 */
async function liveWikiFetch(query: string): Promise<WikiEvidence[]> {
  const { searchDcwWiki, searchWikipedia } = await import("@/lib/chat/search")
  const [dcw, wikipedia] = await Promise.all([searchDcwWiki(query), searchWikipedia(query)])
  return [...dcw, ...wikipedia]
}

/** The wiki dep: `wikiLookup` over the cache, or a stub when no client can back
 *  one. The stub is a resolved `[]` rather than a throw, so the ladder's R4
 *  costs nothing and degrades cleanly. */
function wikiFor(
  admin: AdminRowsClient | null,
  fetcher: ((query: string) => Promise<WikiEvidence[]>) | null,
  now: () => number
): (query: string) => Promise<WikiEvidence[]> {
  if (!admin) return async () => []
  const cache = createWikiCache({ client: admin, fetcher, now })
  return (query: string) => wikiLookup(query, cache)
}

/**
 * The tracker rows plus the curated documents, as the ingestion route would
 * write them.
 *
 * `collectTrackerRows` + `buildCorpusDocuments` rather than `collectCorpus`: the
 * curated half is in-process while the row read can fail on its own, and keeping
 * the two apart is what lets a failed read degrade to the curated half
 * (`buildCorpusDocuments({})`) instead of to an empty source.
 */
export async function buildStaticCorpus(client: AdminRowsClient): Promise<CorpusDocument[]> {
  const { entries, cases } = await collectTrackerRows(client, { maxRows: CORPUS_MAX_ROWS })
  return buildCorpusDocuments({ entries, cases })
}

/**
 * The static corpus, cached. A build with no admin client is curated-only and
 * lands under the same key: a failed row read yields exactly that content, and
 * rebuilding the curated corpus on every request without an admin client would
 * spend the request path's budget to arrive at the same place.
 */
async function staticCorpus(
  admin: AdminRowsClient | null,
  cache: CorpusCache,
  at: number
): Promise<CorpusDocument[]> {
  return cache.load(STATIC_CORPUS_KEY, at, async () => {
    if (admin === null) return buildCorpusDocuments({})

    try {
      // Bounded as well as cached: the cache memoizes the promise, so a read
      // that never answers would hang every later request, not just this one.
      return await withTimeout(buildStaticCorpus(admin), REQUEST_TIMEOUT_MS)
    } catch {
      // The curated half answers the `character:*`, `arc:*`, `thread:*`,
      // `guide:*`, `movie:*` and `gadget:*` namespaces on its own, so a failed
      // row read degrades to it rather than to "no evidence".
      return buildCorpusDocuments({})
    }
  })
}

/**
 * The answer path's retrieval dependencies, resolved once per request.
 *
 * The indexed corpus wins whenever the probe says its table is reachable — even
 * when the table is empty — and anything else is the in-process corpus with
 * `degraded: "corpus_static"` so the condition is visible in `ai_request_log`.
 */
export async function resolveRetrievalDeps(
  input: {
    /** The request's client. Null or absent means no indexed corpus. */
    client?: ResolverClient | null
    /** The admin client: tracker rows, and the wiki cache. */
    admin?: AdminRowsClient | null
    /** Injected clock; production uses `Date.now`. */
    now?: () => number
    /** Replaces the storage probe. Injected for tests. */
    probe?: () => Promise<boolean>
    /** The TTL'd static-corpus cache. Production shares the module-scope one. */
    cache?: CorpusCache
    /**
     * Replaces the live DCW/Wikipedia fetch. Injected for tests; an explicit
     * `null` turns the cache into a read-only store (no fetch on a miss).
     */
    wikiFetch?: ((query: string) => Promise<WikiEvidence[]>) | null
  } = {}
): Promise<RetrievalDeps> {
  const client = input.client ?? null
  const admin = input.admin ?? null
  const now = input.now ?? Date.now
  const fetcher = input.wikiFetch === undefined ? liveWikiFetch : input.wikiFetch
  const cache = input.cache ?? defaultCache

  try {
    const wiki = wikiFor(admin, fetcher, now)

    // `client === null` short-circuits the probe: no probe can make an indexed
    // source out of a client that is not there.
    if (client !== null && (await probeWithin(input.probe ?? (() => probeIndexed(client))))) {
      return { source: createSupabaseSource(client), wiki, mode: "indexed", degraded: null }
    }

    const docs = await staticCorpus(admin, cache, now())
    return { source: createStaticSource(docs), wiki, mode: "static", degraded: STATIC_DEGRADED }
  } catch {
    // The last resort, for a bug in this module rather than for a failure the
    // paths above already handle. The contract is that this function cannot
    // fail: it runs before every answer, and a throw here is a 500 on a question
    // the curated corpus can answer.
    return {
      source: createStaticSource(buildCorpusDocuments({})),
      wiki: async () => [],
      mode: "static",
      degraded: STATIC_DEGRADED,
    }
  }
}
