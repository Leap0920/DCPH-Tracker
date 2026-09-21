/**
 * Candidate re-ranking through the tracker scorer.
 *
 * FTS (and the entity and fuzzy branches) generate candidates; `rankEntries`
 * decides their order, exactly as `lib/chat/search.ts` already does for linked
 * case text. Fusing first and scoring second is deliberate: RRF is cheap and
 * blind, and the scorer is the only thing that knows a title hit is worth more
 * than a passing mention.
 *
 * Zero I/O, like the rest of lib/chat/query.ts and lib/ai/retrieval/rrf.ts:
 * this decides which documents the model is allowed to see, so it has to be
 * unit-testable without a database.
 */

import { rankEntries, scoreEntry } from "@/lib/chat/query"
import { toRankable, type CorpusDocument } from "@/lib/ai/corpus/types"
import type { FusedCandidate } from "@/lib/ai/retrieval/rrf"

export interface ScoredDoc {
  doc: CorpusDocument
  score: number
  rrf: number
  /** The branches that retrieved it: "entity", "fts", "fuzzy", ... */
  origins: string[]
}

/**
 * Ranks fused candidates by the scorer's verdict, keeping the candidates it
 * cannot score.
 *
 * The one non-obvious rule: a document the scorer gives 0 is NOT a miss. A
 * fuzzy hit is a typo-tolerance hit — the query says "haibarra" and the title
 * says "haibara" — so `scoreEntry` returns 0 for the only document R3 found.
 * Filtering zeros the way `rankEntries` does internally would throw away the
 * fuzzy branch's entire output, so they survive, ordered by rrf, after every
 * document that scored.
 *
 * `limit` (default 12) truncates the concatenation of both groups, never the
 * scored group alone, or the survivors could push the result past the cap.
 */
export function rankCandidates(
  candidates: FusedCandidate[],
  docs: CorpusDocument[],
  keywords: string[],
  options: {
    limit?: number
    numbers?: number[]
    preferRecent?: boolean
    preferEarliest?: boolean
  } = {}
): ScoredDoc[] {
  const { limit = 12, numbers = [], preferRecent = false, preferEarliest = false } = options

  const docById = new Map(docs.map((doc) => [doc.id, doc]))

  // Hydration can legitimately miss (a deleted row, a source that filtered it),
  // so a candidate without a document is dropped rather than ranked as a shell.
  // Sort explicitly: rrf desc then id asc is the same tie-break RRF promises,
  // and it must hold even if a caller hands the fused list over unsorted.
  const ordered = candidates
    .map((candidate) => ({ candidate, doc: docById.get(candidate.id) }))
    .filter(
      (row): row is { candidate: FusedCandidate; doc: CorpusDocument } => row.doc !== undefined
    )
    .sort((a, b) => {
      if (b.candidate.rrf !== a.candidate.rrf) return b.candidate.rrf - a.candidate.rrf
      return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0
    })

  const scoredById = new Map<string, ScoredDoc>()
  const survivors: ScoredDoc[] = []
  for (const { candidate, doc } of ordered) {
    const entry: ScoredDoc = {
      doc,
      score: scoreEntry(toRankable(doc), keywords, numbers),
      rrf: candidate.rrf,
      origins: Object.keys(candidate.ranks),
    }
    scoredById.set(doc.id, entry)
    // `ordered` is already rrf desc, id asc, so a straight push keeps the
    // survivor group in the deterministic order the rule asks for.
    if (entry.score === 0) survivors.push(entry)
  }

  // rankEntries is the authority on the scored group's order (score desc, then
  // the chronological preference, then air date); the map only re-attaches the
  // rrf and origins the scorer cannot know about. `limit` is passed through
  // because the scored group is capped on its own terms as well.
  const scored: ScoredDoc[] = []
  const ranked = rankEntries(
    ordered.map((row) => row.doc),
    keywords,
    { limit, numbers, preferRecent, preferEarliest, fieldsOf: toRankable }
  )
  for (const doc of ranked) {
    const entry = scoredById.get(doc.id)
    if (entry) scored.push(entry)
  }

  return [...scored, ...survivors].slice(0, limit)
}
