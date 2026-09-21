/**
 * Catalog search: the tool the model calls when the question is about an
 * episode or a movie.
 *
 * The pipeline is the ladder's candidate generation — R1 entity, R2 full text,
 * R3 fuzzy — without the escalation policy: the caller has already decided it
 * wants catalog documents, so the three branches run once, fuse with RRF, and
 * the tracker scorer decides the order. `runLadder` remains the path that
 * decides for itself how hard to look.
 *
 * The fuzzy branch is not optional here. Full text is token AND (the SQL's
 * `websearch_to_tsquery` and the static branch agree), so a single misspelled
 * word matches nothing at all; "roller coaser" reaches its episode only through
 * trigram similarity. Without that list a typo'd search returns [], and the
 * zero-score survivors `rankCandidates` exists to keep would have no way into
 * the tool's output.
 *
 * Two guarantees this module keeps:
 *
 * 1. Never throw. A retrieval failure degrades an answer; a rejection here
 *    would surface as a 500 in the route that calls the tool.
 * 2. Filter, then truncate. Every branch searches the one mixed index (the
 *    Phase 2 RPCs take no source parameter), so the top candidates can all be
 *    characters and arcs; keeping only `content_entries` before the caller's
 *    `limit` is what stops a mixed query from returning [] while the matching
 *    episode sits at rank 13. An 80-candidate pool keeps that dilution small;
 *    a `p_source` argument on the three RPCs is a later, additive change
 *    (Plan 4) if measurements ever call for it.
 */

import {
  extractNumbers,
  normalizeText,
  prefersEarliest,
  prefersRecent,
  tokenize,
} from "@/lib/chat/query"
import type { CorpusDocument, CorpusSource } from "@/lib/ai/corpus/types"
import { rankCandidates, type ScoredDoc } from "@/lib/ai/retrieval/candidates"
import { reciprocalRankFusion, type RankedList } from "@/lib/ai/retrieval/rrf"
import type { DocumentSource, SearchHit } from "@/lib/ai/retrieval/source"

export interface SearchToolOptions {
  /** Default 12. */
  limit?: number
  /** Candidate pool pulled from the source before filtering. Default 80. */
  candidates?: number
}

/** Documents handed to the model when the caller does not say otherwise. */
const DEFAULT_LIMIT = 12

/** The pool every branch feeds. The ladder's R2 uses the same number for the
 *  same reason: full text is the recall workhorse, and the source filter runs
 *  after ranking, so a shallow pool would starve it. */
const DEFAULT_CANDIDATES = 80

/** Keywords the scorer and the fuzzy branch see, capped at the 8 the source's
 *  own branches use so both sides work from one vocabulary. */
const MAX_KEYWORDS = 8

/** A branch that rejects found nothing: retrieval must not fail the request. */
async function hitsOrEmpty(run: () => Promise<SearchHit[]>): Promise<SearchHit[]> {
  try {
    return await run()
  } catch {
    return []
  }
}

/** Hydration, guarded the same way. `fetch` is a separate round trip and can
 *  fail on its own, which must degrade to "no documents" rather than throw. */
async function hydrate(source: DocumentSource, ids: string[]): Promise<CorpusDocument[]> {
  // An empty `in` list is a wasted round trip in production.
  if (ids.length === 0) return []

  try {
    return await source.fetch(ids)
  } catch {
    return []
  }
}

/**
 * The shared pipeline, parameterised by the one thing the two tools disagree
 * on: which corpus source the caller wants back. `searchCases` imports this
 * rather than restating the branch/fuse/rank rules — the filter-then-truncate
 * order in particular, which a second copy would sooner or later get wrong.
 */
export async function searchCorpus(
  query: string,
  source: DocumentSource,
  keep: CorpusSource,
  options: SearchToolOptions = {}
): Promise<ScoredDoc[]> {
  const { limit = DEFAULT_LIMIT, candidates = DEFAULT_CANDIDATES } = options

  const keywords = tokenize(query, MAX_KEYWORDS)
  const numbers = extractNumbers(query)
  const preferRecent = prefersRecent(query)
  const preferEarliest = prefersEarliest(query)

  // The normalized query is a name on its own ("ai haibara" is a title, "who is
  // ai haibara" is not), which is why it leads the keyword list rather than
  // replacing it.
  const names = [normalizeText(query), ...keywords]

  // The three branches are independent, so they share a turn. R1 is skipped
  // entirely when the query holds no number: `episode_number = any('{}')` is a
  // scan that can only return nothing.
  const [entityHits, ftsHits, fuzzyHits] = await Promise.all([
    numbers.length > 0
      ? hitsOrEmpty(() => source.entity({ numbers, names, limit: candidates }))
      : Promise.resolve<SearchHit[]>([]),
    hitsOrEmpty(() => source.fullText(query, candidates)),
    hitsOrEmpty(() => source.fuzzy(query, keywords, candidates)),
  ])

  // A list that was not produced is omitted rather than pushed empty: the
  // fusion is identical either way, and `origins` stays honest about which
  // branches actually ran.
  const lists: RankedList[] = []
  if (numbers.length > 0) lists.push({ source: "entity", ids: entityHits.map((hit) => hit.id) })
  lists.push({ source: "fts", ids: ftsHits.map((hit) => hit.id) })
  lists.push({ source: "fuzzy", ids: fuzzyHits.map((hit) => hit.id) })

  const fused = reciprocalRankFusion(lists)
  const docs = await hydrate(
    source,
    fused.map((candidate) => candidate.id)
  )

  // `limit` here is the pool size, never the caller's: the source filter below
  // runs after ranking, so truncating to the caller's limit now would let the
  // mixed corpus hide the one document this tool exists to return.
  const ranked = rankCandidates(fused, docs, keywords, {
    limit: candidates,
    numbers,
    preferRecent,
    preferEarliest,
  })

  return ranked.filter((entry) => entry.doc.source === keep).slice(0, limit)
}

/** Catalog search: episodes, movies and specials, never a case or a character. */
export async function searchCatalog(
  query: string,
  source: DocumentSource,
  options: SearchToolOptions = {}
): Promise<ScoredDoc[]> {
  return searchCorpus(query, source, "content_entries", options)
}
