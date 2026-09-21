/**
 * Reciprocal rank fusion: merges ranked lists whose scores are not comparable.
 *
 * R1 (entity), R2 (full-text) and R3 (fuzzy) each produce a different kind of
 * score — `ts_rank_cd` is not `similarity` — and normalising them would need a
 * calibration nobody has. RRF ignores the scores and counts ranks instead,
 * which is why the ladder fuses with it.
 *
 * Zero imports and zero I/O, like lib/chat/query.ts: these decisions change
 * what the model is allowed to see, so they must be unit-testable without a
 * database or a request context.
 */

export interface RankedList {
  /** Where this ranking came from: "entity" | "fts" | "fuzzy". */
  source: string
  ids: string[]
}

export interface FusedCandidate {
  id: string
  rrf: number
  /** Best rank this id achieved per source, 1-based. */
  ranks: Record<string, number>
}

/** The standard k from the RRF literature. */
export const DEFAULT_RRF_K = 50

/** Working shape while accumulating: carries the best rank the report omits. */
interface Accumulator {
  id: string
  rrf: number
  ranks: Record<string, number>
  bestRank: number
}

/**
 * Fuses ranked id lists into one ordering, best first.
 *
 * `limit` defaults to no truncation; `k` trades how strongly rank 1 dominates —
 * small k flattens the curve so a consensus second place can beat a lone first
 * (see the k: 0 test).
 */
export function reciprocalRankFusion(
  lists: RankedList[],
  options: { k?: number; limit?: number } = {}
): FusedCandidate[] {
  const { k = DEFAULT_RRF_K, limit } = options
  const byId = new Map<string, Accumulator>()

  for (const list of lists) {
    // An id repeated inside one list is an artifact of how that ranking was
    // built, not a second vote: only its first, best occurrence may count.
    const seen = new Set<string>()

    for (let index = 0; index < list.ids.length; index += 1) {
      const id = list.ids[index]
      if (seen.has(id)) continue
      seen.add(id)

      const rank = index + 1
      let candidate = byId.get(id)
      if (!candidate) {
        candidate = { id, rrf: 0, ranks: {}, bestRank: rank }
        byId.set(id, candidate)
      }

      candidate.rrf += 1 / (k + rank)
      candidate.bestRank = Math.min(candidate.bestRank, rank)

      // Sources are expected to be distinct. Should a caller reuse one, the
      // reported rank is the best one so far, never whichever list ran last.
      const previous = candidate.ranks[list.source]
      candidate.ranks[list.source] = previous === undefined ? rank : Math.min(previous, rank)
    }
  }

  const ranked = Array.from(byId.values()).sort((a, b) => {
    if (b.rrf !== a.rrf) return b.rrf - a.rrf
    // With small k and few lists, exact score ties are common; the tie-breaks
    // are what make the ladder's output reproducible run to run.
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank
    // Plain comparison, not localeCompare: ids are opaque identifiers and must
    // sort identically in every environment.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const fused: FusedCandidate[] = ranked.map(({ id, rrf, ranks }) => ({ id, rrf, ranks }))
  return limit === undefined ? fused : fused.slice(0, limit)
}
