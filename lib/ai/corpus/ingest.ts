/**
 * Writing the corpus into `ai_documents`.
 *
 * Content-hash diffing is what makes this cheap enough to run on a schedule:
 * an unchanged corpus costs one paginated read and zero writes, so a cron job
 * cannot thrash the table or spend the project's write budget.
 */

import { contentHash } from "@/lib/ai/corpus/hash"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

export interface IngestClient {
  from(table: string): {
    select(columns: string): {
      range(
        from: number,
        to: number
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): Promise<{ error: { message: string } | null }>
  }
}

export interface IngestReport {
  total: number
  inserted: number
  updated: number
  unchanged: number
  /** Rows actually sent to Postgres. 0 for a dry run. */
  upserted: number
  ms: number
}

type Row = Record<string, unknown>

/** Read and write target. Named here so this module never imports Supabase. */
const DOCS_TABLE = "ai_documents"
/** The two columns the diff needs; the corpus rows themselves stay unread. */
const HASH_COLUMNS = "id,content_hash"

/** Default 200: small enough to stay well under any request body cap. */
const DEFAULT_CHUNK_SIZE = 200
/** Mirrors PostgREST's response cap, so a full page is a full page. */
const HASH_PAGE_SIZE = 500

/** The exact column set of an `ai_documents` write. */
interface DocumentRow extends Row {
  id: string
  source: string
  title: string
  body: string
  url: string | null
  metadata: Record<string, unknown>
  episode_number: number | null
  movie_number: number | null
  aliases: string[]
  content_hash: string
  updated_at: string
}

/**
 * `fts` is deliberately absent: it is a generated column, and Postgres rejects
 * an insert that names one.
 */
function toRow(doc: CorpusDocument, hash: string, updatedAt: string): DocumentRow {
  return {
    id: doc.id,
    source: doc.source,
    title: doc.title,
    body: doc.body,
    url: doc.url,
    metadata: doc.metadata,
    episode_number: doc.episodeNumber ?? null,
    movie_number: doc.movieNumber ?? null,
    aliases: doc.aliases ?? [],
    content_hash: hash,
    updated_at: updatedAt,
  }
}

/**
 * Every stored `(id, content_hash)` pair, paged, into a Map.
 *
 * The same short-page rule `collect.ts` uses: it is the only end signal
 * PostgREST gives.
 */
async function readExistingHashes(client: IngestClient): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()

  for (let from = 0; ; from += HASH_PAGE_SIZE) {
    const { data, error } = await client
      .from(DOCS_TABLE)
      .select(HASH_COLUMNS)
      .range(from, from + HASH_PAGE_SIZE - 1)

    if (error) throw new Error(`[ai-corpus] reading ${DOCS_TABLE} failed: ${error.message}`)

    const page = data ?? []
    for (const row of page) {
      // A null hash can never equal a real sha256, so such a row is treated as
      // changed and repaired rather than skipped.
      hashes.set(String(row.id), row.content_hash == null ? "" : String(row.content_hash))
    }

    if (page.length < HASH_PAGE_SIZE) break
  }

  return hashes
}

export async function ingestCorpus(deps: {
  client: IngestClient
  documents: CorpusDocument[]
  now?: () => number
  /** Default 200. */
  chunkSize?: number
  dryRun?: boolean
}): Promise<IngestReport> {
  const clock = deps.now ?? Date.now
  const startedAt = clock()
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE

  const existing = await readExistingHashes(deps.client)

  const changed: Array<{ doc: CorpusDocument; hash: string }> = []
  let inserted = 0
  let updated = 0
  let unchanged = 0

  for (const doc of deps.documents) {
    const hash = contentHash(doc)
    const previous = existing.get(doc.id)

    if (previous === undefined) {
      inserted++
      changed.push({ doc, hash })
    } else if (previous !== hash) {
      updated++
      changed.push({ doc, hash })
    } else {
      unchanged++
    }
  }

  let upserted = 0

  if (!deps.dryRun) {
    // One stamp for the whole run, so a batch that spans a second boundary does
    // not produce rows that look like separate edits.
    const updatedAt = new Date(clock()).toISOString()

    for (let index = 0; index < changed.length; index += chunkSize) {
      const batch = changed.slice(index, index + chunkSize)
      const { error } = await deps.client
        .from(DOCS_TABLE)
        .upsert(
          batch.map(({ doc, hash }) => toRow(doc, hash, updatedAt)),
          { onConflict: "id" }
        )

      // Unlike a retrieval branch, a half-written corpus must not degrade: it
      // would be discovered as stale answers weeks later. Fail the run instead.
      if (error) throw new Error(`[ai-corpus] upserting ${DOCS_TABLE} failed: ${error.message}`)

      upserted += batch.length
    }
  }

  return {
    total: deps.documents.length,
    inserted,
    updated,
    unchanged,
    upserted,
    ms: clock() - startedAt,
  }
}
