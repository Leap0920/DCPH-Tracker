import type { RankableEntry } from "@/lib/chat/query"

/**
 * Which source a document came from. Kept as a column so the retrieval ladder can
 * ask for "catalog only" or "characters only" without a second table.
 *
 * `conversations` is the one member with no `ai_documents` row behind it: those
 * documents are built per request from the user's own transcript by the
 * `search_conversations` tool, and the name exists so the assembly and citation
 * layers treat them exactly like corpus evidence.
 */
export type CorpusSource =
  | "content_entries"
  | "dcw_cases"
  | "characters"
  | "relationships"
  | "arcs"
  | "threads"
  | "canon"
  | "movies"
  | "gadgets"
  | "conversations"

/**
 * Everything else a document wants to expose. Only the fields the scorer can use
 * are named; the index signature keeps the rest JSON-serialisable into the
 * metadata column without a second type.
 */
export interface DocMetadata {
  kind?: string
  slug?: string
  dcw_title?: string
  synopsis?: string
  air_date?: string
  canon_order?: number
  release_order?: number
  type?: string
  arc_slug?: string
  episode_start?: number
  episode_end?: number
  eras?: string
  years?: string
  status?: string
  canon_type?: string
  max_episode?: number
  case_index?: number
  case_text?: string
  page_title?: string
  crime_type?: string
  victim?: string
  suspects?: string
  location?: string
  cause_death?: string
  description?: string
  japanese?: string
  year?: number
  role?: string
  affiliation?: string
  debut_episode?: number | null
  debut_movie?: number | null
  reveal_episode?: number | null
  spoiler?: string
  [key: string]: unknown
}

export interface CorpusDocument {
  /** Stable across rebuilds: `entry:<slug>`, `character:<id>`, `arc:<slug>`, ... */
  id: string
  source: CorpusSource
  title: string
  body: string
  url: string | null
  metadata: DocMetadata
  /**
   * Set ONLY when the document *is* that numbered entry (an episode row, a
   * movie row). A character whose debut is episode 129 deliberately leaves it
   * unset: R1 treats a number hit as near-certain, and answering "what happens
   * in episode 129" with 40 character documents would bury the episode.
   */
  episodeNumber?: number | null
  movieNumber?: number | null
  /** Lowercase. Matched with the `&&` overlap operator, so tokens beat phrases. */
  aliases?: string[]
}

/**
 * The scorer's view of a document. `lib/chat/query.ts` scores flat fields, so the
 * document's metadata has to be projected onto `RankableEntry` before ranking --
 * the same adapter pattern `search.ts:610-620` uses for linked case text.
 */
export function toRankable(doc: CorpusDocument): RankableEntry {
  const meta = doc.metadata
  return {
    title: doc.title,
    dcw_title: meta.dcw_title ?? null,
    page_title: meta.page_title ?? null,
    synopsis: meta.synopsis ?? null,
    description: meta.description ?? null,
    victim: meta.victim ?? null,
    suspects: meta.suspects ?? null,
    crime_type: meta.crime_type ?? null,
    location: meta.location ?? null,
    cause_death: meta.cause_death ?? null,
    extra: meta.case_text ?? null,
    episode_number: doc.episodeNumber ?? null,
    movie_number: doc.movieNumber ?? null,
    air_date: meta.air_date ?? null,
  }
}
