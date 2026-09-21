/**
 * The document source port: one interface, two adapters.
 *
 * Production reads `ai_documents` through three RPCs. Every test and the eval
 * gate read an in-process index instead, because CI has no Postgres (plan
 * deviation D5, recorded deliberately). Keeping both behind this interface is
 * what makes the escalation ladder testable at all.
 *
 * Zero I/O here: the Supabase adapter is typed structurally against
 * `DocsRpcClient`, so it never imports the database client and a test can inject
 * a fake one.
 */

import { normalizeText, tokenize } from "@/lib/chat/query"
import type { CorpusDocument, CorpusSource, DocMetadata } from "@/lib/ai/corpus/types"

export interface SearchHit {
  id: string
  score: number
}

export interface DocumentSource {
  /** R1. `names` are lowercase; a hit is an exact title, an alias, or a title substring. */
  entity(input: { numbers: number[]; names: string[]; limit: number }): Promise<SearchHit[]>
  /** R2. Token AND, like websearch_to_tsquery. A query with no usable tokens matches nothing. */
  fullText(query: string, limit: number): Promise<SearchHit[]>
  /** R3. Approximate trigram similarity on titles, threshold ~0.3. */
  fuzzy(query: string, keywords: string[], limit: number): Promise<SearchHit[]>
  /** Hydration by id. Unknown ids are omitted. */
  fetch(ids: string[]): Promise<CorpusDocument[]>
}

export interface DocsRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: SearchHit[] | null; error: { message: string } | null }>
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[]
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}

/**
 * Postgres's `pg_trgm.similarity_threshold` default. The static branch keeps a
 * hit at or above this number so the offline approximation agrees with
 * production about what counts as a hit.
 */
export const FUZZY_SIMILARITY_THRESHOLD = 0.3

/** The entity rule weights, same numbers as the SQL's `greatest(...)` ranks. */
const ENTITY_NUMBER_SCORE = 3
const ENTITY_TITLE_SCORE = 2
const ENTITY_ALIAS_SCORE = 1.5
const ENTITY_SUBSTRING_SCORE = 1

/**
 * The ladder and the search tools give `tokenize` up to 8 keywords; full-text
 * matching uses the same cap so the branches see the same query terms.
 */
const MAX_QUERY_TOKENS = 8

/**
 * Document-side tokens. `tokenize` is for queries: it drops stopwords and caps
 * the keyword count, which would silently cut a body's vocabulary. Query tokens
 * are already stopword-filtered, so keeping stopwords in the index costs nothing.
 */
function documentTokens(value: string): string[] {
  return normalizeText(value).split(" ").filter((token) => token !== "")
}

/** Score desc, id asc: the SQL's `order by rank desc, d.id`, and the tie-break
 * that keeps the offline output reproducible run to run. */
function sortHits(hits: SearchHit[]): SearchHit[] {
  return hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function matchesNumber(value: number | null | undefined, numbers: number[]): boolean {
  return typeof value === "number" && numbers.includes(value)
}

/**
 * Best rule wins, as in the SQL: a number hit outranks an exact title, a title
 * outranks an alias overlap, an alias outranks a title substring.
 */
function entityScore(doc: CorpusDocument, numbers: number[], names: string[]): number {
  let score = 0

  if (matchesNumber(doc.episodeNumber, numbers) || matchesNumber(doc.movieNumber, numbers)) {
    score = ENTITY_NUMBER_SCORE
  }

  const title = normalizeText(doc.title)
  const aliases = doc.aliases ?? []

  for (const name of names) {
    // The SQL guards this the same way (`n <> ''`): `"".includes`-style matching
    // would turn every document into an entity hit.
    if (name === "") continue
    if (title === name) score = Math.max(score, ENTITY_TITLE_SCORE)
    if (title.includes(name)) score = Math.max(score, ENTITY_SUBSTRING_SCORE)
    // `aliases && p_names` is a set overlap, not a substring test.
    if (aliases.includes(name)) score = Math.max(score, ENTITY_ALIAS_SCORE)
  }

  return score
}

/**
 * The in-process adapter. The eval gate runs 60 queries over a corpus of ~1,600
 * documents, so the token sets are built once here rather than per query.
 */
export function createStaticSource(docs: CorpusDocument[]): DocumentSource {
  const byId = new Map<string, CorpusDocument>()
  const index = new Map<string, { title: Set<string>; body: Set<string> }>()

  for (const doc of docs) {
    byId.set(doc.id, doc)
    index.set(doc.id, {
      title: new Set(documentTokens(doc.title)),
      body: new Set(documentTokens(doc.body)),
    })
  }

  return {
    async entity({ numbers, names, limit }) {
      const hits: SearchHit[] = []

      for (const doc of docs) {
        const score = entityScore(doc, numbers, names)
        if (score > 0) hits.push({ id: doc.id, score })
      }

      return sortHits(hits).slice(0, limit)
    },

    async fullText(query, limit) {
      const tokens = tokenize(query, MAX_QUERY_TOKENS)

      // websearch_to_tsquery("the of and") is an empty tsquery, which matches
      // nothing. Returning the corpus here would be the one failure that looks
      // like success, so the empty case is explicit.
      if (tokens.length === 0) return []

      const hits: SearchHit[] = []

      for (const doc of docs) {
        const entry = index.get(doc.id)
        if (!entry) continue

        let score = 0
        let matchedAll = true

        for (const token of tokens) {
          if (entry.title.has(token)) score += 2
          else if (entry.body.has(token)) score += 1
          else {
            matchedAll = false
            break
          }
        }

        if (matchedAll) hits.push({ id: doc.id, score })
      }

      return sortHits(hits).slice(0, limit)
    },

    async fuzzy(query, keywords, limit) {
      // The SQL ignores keywords shorter than 3 characters; a 1- or 2-character
      // keyword can never reach the threshold anyway, but the rule is the same.
      const probes = keywords.filter((keyword) => keyword.length >= 3)
      const hits: SearchHit[] = []

      for (const doc of docs) {
        let score = trigramSimilarity(doc.title, query)
        for (const keyword of probes) {
          score = Math.max(score, trigramSimilarity(doc.title, keyword))
        }
        if (score >= FUZZY_SIMILARITY_THRESHOLD) hits.push({ id: doc.id, score })
      }

      return sortHits(hits).slice(0, limit)
    },

    async fetch(ids) {
      const found: CorpusDocument[] = []

      for (const id of ids) {
        const doc = byId.get(id)
        if (doc) found.push(doc)
      }

      return found
    },
  }
}

/** One log line, then the empty result: a broken branch must degrade an answer,
 * never fail the request. */
function logFailureAndReturnEmpty(branch: string, error: unknown): never[] {
  console.error(
    `[ai-retrieval] ${branch} failed`,
    error instanceof Error ? error.message : String(error)
  )
  return []
}

export function createSupabaseSource(client: DocsRpcClient): DocumentSource {
  return {
    async entity({ numbers, names, limit }) {
      try {
        const { data, error } = await client.rpc("ai_docs_entity", {
          p_numbers: numbers,
          p_names: names,
          p_limit: limit,
        })
        if (error) return logFailureAndReturnEmpty("entity", error.message)
        return data ?? []
      } catch (err) {
        return logFailureAndReturnEmpty("entity", err)
      }
    },

    async fullText(query, limit) {
      try {
        const { data, error } = await client.rpc("ai_docs_fts", {
          p_query: query,
          p_limit: limit,
        })
        if (error) return logFailureAndReturnEmpty("fullText", error.message)
        return data ?? []
      } catch (err) {
        return logFailureAndReturnEmpty("fullText", err)
      }
    },

    async fuzzy(query, keywords, limit) {
      try {
        const { data, error } = await client.rpc("ai_docs_fuzzy", {
          p_query: query,
          p_keywords: keywords,
          p_limit: limit,
        })
        if (error) return logFailureAndReturnEmpty("fuzzy", error.message)
        return data ?? []
      } catch (err) {
        return logFailureAndReturnEmpty("fuzzy", err)
      }
    },

    async fetch(ids) {
      // An empty `in` list is a wasted round trip, and PostgREST is not the
      // place to find out what it does with one.
      if (ids.length === 0) return []

      try {
        const { data, error } = await client.from("ai_documents").select("*").in("id", ids)
        if (error) return logFailureAndReturnEmpty("fetch", error.message)
        return (data ?? []).map(rowToDocument)
      } catch (err) {
        return logFailureAndReturnEmpty("fetch", err)
      }
    },
  }
}

/**
 * The trigram set Postgres computes: two spaces prefixed, one suffixed, every
 * 3-character gram. Lowercased for the same reason `show_trgm` lowercases —
 * `similarity()` ignores case. Postgres generates these per word of a
 * multi-word value; padding the whole value is the approximation D5 accepts,
 * since the offline branch only has to agree on what counts as a hit.
 */
export function trigrams(value: string): Set<string> {
  const padded = `  ${value.toLowerCase()} `
  const grams = new Set<string>()

  for (let start = 0; start + 3 <= padded.length; start += 1) {
    const gram = padded.slice(start, start + 3)
    // The only all-space gram is the padding of an empty value, and
    // `show_trgm('')` is `{}`: "no trigrams" has to stay representable.
    if (gram.trim() === "") continue
    grams.add(gram)
  }

  return grams
}

/** Jaccard overlap of the two trigram sets; 0 when either side has no trigrams. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) shared += 1
  }

  return shared / (left.size + right.size - shared)
}

/**
 * Hydration maps the table's snake_case columns onto `CorpusDocument`.
 * `content_hash` and `fts` are generated by the database and dropped; `metadata`
 * and `aliases` are nullable and default to an empty value.
 */
export function rowToDocument(row: Record<string, unknown>): CorpusDocument {
  return {
    id: row.id as string,
    source: row.source as CorpusSource,
    title: row.title as string,
    body: row.body as string,
    url: (row.url as string | null) ?? null,
    metadata: parseMetadata(row.metadata),
    episodeNumber: (row.episode_number as number | null | undefined) ?? null,
    movieNumber: (row.movie_number as number | null | undefined) ?? null,
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
  }
}

/** PostgREST normally returns `jsonb` as an object, but a row can arrive with it
 * as a JSON string; one corrupt row must not fail a whole hydration. */
function parseMetadata(value: unknown): DocMetadata {
  if (value === null || value === undefined) return {}

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed !== null && typeof parsed === "object" ? (parsed as DocMetadata) : {}
    } catch {
      return {}
    }
  }

  return typeof value === "object" ? (value as DocMetadata) : {}
}
