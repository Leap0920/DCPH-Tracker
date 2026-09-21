/**
 * The retrieval escalation ladder: cheapest round first, stop at the evidence
 * threshold, hard wall-clock budget, every round recorded.
 *
 * Two rules this module exists to enforce:
 *
 * 1. A branch that rejects must not fail the request, and it must not look like
 *    a branch that found nothing. "Retrieval broke" used to be indistinguishable
 *    from "nothing matched"; here the failure lands in `steps` as
 *    `skipped: "error"` while the other rounds keep running.
 * 2. The evidence threshold counts distinct candidate ids, never hydrated
 *    documents. Re-counting after hydration would let one missing row silently
 *    re-run an expensive round.
 *
 * Zero I/O: the source, the wiki lookup, the clock and the budget are injected,
 * so the whole ladder is unit-testable without a database, a network or a real
 * timer.
 */

import {
  extractNumbers,
  normalizeText,
  prefersEarliest,
  prefersRecent,
  tokenize,
} from "@/lib/chat/query"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import { rankCandidates, type ScoredDoc } from "@/lib/ai/retrieval/candidates"
import { reciprocalRankFusion, type RankedList } from "@/lib/ai/retrieval/rrf"
import type { DocumentSource } from "@/lib/ai/retrieval/source"

/** Distinct fused candidates needed before the ladder stops escalating. */
export const EVIDENCE_THRESHOLD = 6

/** Wall-clock budget for the whole ladder, R1 through R4. */
export const LADDER_BUDGET_MS = 1500

/** R2's pool. Full text is the recall workhorse, so its pool stays large. */
export const LADDER_CANDIDATES = 80

/**
 * R1's pool.
 *
 * This was 20, on the theory that an entity hit is near-certain. The golden eval
 * (lib/__tests__/retrieval-eval.test.ts) showed the flaw: the weakest entity
 * rule (title substring, rank 1.0) matches a short keyword anywhere in a title
 * -- "ran" inside "strange" -- so that whole tier ties at 1.0 and is ordered by
 * id, and it can run past a hundred rows. A document whose title contains two
 * of the query's names then sits behind that noise, and at 20 slots it never
 * reached the scorer that would have ranked it first. 100 reaches it without
 * making the RPC's `limit` the whole table.
 */
export const ENTITY_CANDIDATES = 100

/** R3's pool. Trigram similarity is the noisiest branch, so it stays small. */
export const FUZZY_CANDIDATES = 40

/** Documents handed to the model when the caller does not say otherwise. */
export const DEFAULT_LADDER_LIMIT = 12

/**
 * Keywords taken from the query. The same 8 the source's branches cap
 * themselves at, so R1's names and R2's tokens come from one vocabulary.
 */
const MAX_KEYWORDS = 8

export interface RetrievalRequest {
  query: string
  /** Defaults to tokenize(query, 8) when omitted. */
  keywords?: string[]
  /** Defaults to extractNumbers(query). */
  numbers?: number[]
  /** Defaults to prefersRecent(query) / prefersEarliest(query). */
  preferRecent?: boolean
  preferEarliest?: boolean
  /** True when the question needs lore the corpus cannot hold, which is the only
   *  reason to spend a wiki call. */
  needsLore?: boolean
  limit?: number
}

export interface LadderStep {
  round: 1 | 2 | 3 | 4
  branch: "entity" | "fts" | "fuzzy" | "wiki"
  hits: number
  ms: number
  /** null when the round ran; a reason when it did not. */
  skipped: string | null
}

export interface WikiEvidence {
  title: string
  url: string
  extract: string
  source: "dcw" | "wikipedia"
}

export interface LadderResult {
  docs: ScoredDoc[]
  wiki: WikiEvidence[]
  steps: LadderStep[]
  /** "retrieval_budget" when a round was skipped for time; null otherwise. */
  degraded: string | null
}

export interface LadderDeps {
  source: DocumentSource
  wiki?: (query: string) => Promise<WikiEvidence[]>
  now?: () => number
  budgetMs?: number
  threshold?: number
}

interface BranchOutcome<T> {
  value: T[]
  /** True when the branch rejected; `value` is the empty result then. */
  failed: boolean
  ms: number
}

/**
 * Runs one branch, converting a rejection into an empty result plus a flag.
 *
 * `ms` is clamped at 0 so a clock that steps backwards still yields a
 * non-negative duration.
 */
async function runBranch<T>(
  branch: () => Promise<T[]>,
  now: () => number,
  empty: T[]
): Promise<BranchOutcome<T>> {
  const startedAt = now()
  try {
    const value = await branch()
    return { value, failed: false, ms: Math.max(0, now() - startedAt) }
  } catch {
    return { value: empty, failed: true, ms: Math.max(0, now() - startedAt) }
  }
}

/** The step a round reports itself with: hits, cost, and why it did not run. */
function branchStep<T>(
  round: LadderStep["round"],
  branch: LadderStep["branch"],
  outcome: BranchOutcome<T>
): LadderStep {
  return {
    round,
    branch,
    hits: outcome.value.length,
    ms: outcome.ms,
    skipped: outcome.failed ? "error" : null,
  }
}

/** Hydration, guarded: a rejection here must degrade the answer to "no
 *  documents", not fail a request the ladder already paid for. */
async function hydrate(source: DocumentSource, ids: string[]): Promise<CorpusDocument[]> {
  // An empty `in` list is a wasted round trip in production.
  if (ids.length === 0) return []

  try {
    return await source.fetch(ids)
  } catch {
    return []
  }
}

export async function runLadder(
  request: RetrievalRequest,
  deps: LadderDeps
): Promise<LadderResult> {
  const {
    source,
    wiki,
    now = Date.now,
    budgetMs = LADDER_BUDGET_MS,
    threshold = EVIDENCE_THRESHOLD,
  } = deps

  const startedAt = now()

  // ?? and not ||: a caller who passes preferRecent: false is overriding a
  // query whose wording ("latest") says otherwise, and that has to stick.
  const keywords = request.keywords ?? tokenize(request.query, MAX_KEYWORDS)
  const numbers = request.numbers ?? extractNumbers(request.query)
  const preferRecent = request.preferRecent ?? prefersRecent(request.query)
  const preferEarliest = request.preferEarliest ?? prefersEarliest(request.query)
  const limit = request.limit ?? DEFAULT_LADDER_LIMIT

  // The normalized query is a name on its own ("ai haibara" is a title, "who is
  // ai haibara" is not), which is why it leads the keyword list rather than
  // replacing it.
  const names = [normalizeText(request.query), ...keywords]

  // R1 and R2 are independent and are the two cheapest rounds, so they share a
  // turn. They are still timed separately: `steps` is where a slow or broken
  // branch has to show up.
  const [entity, fts] = await Promise.all([
    runBranch(() => source.entity({ numbers, names, limit: ENTITY_CANDIDATES }), now, []),
    runBranch(() => source.fullText(request.query, LADDER_CANDIDATES), now, []),
  ])

  const steps: LadderStep[] = [branchStep(1, "entity", entity), branchStep(2, "fts", fts)]

  const lists: RankedList[] = [
    { source: "entity", ids: entity.value.map((hit) => hit.id) },
    { source: "fts", ids: fts.value.map((hit) => hit.id) },
  ]
  let fused = reciprocalRankFusion(lists)
  let degraded: string | null = null

  /** `>=`, so a budgetMs of 0 disables escalation deterministically instead of
   *  depending on how fast the branches happened to be. */
  const budgetSpent = () => now() - startedAt >= budgetMs

  // R3 exists only while the evidence is short: it is the noisiest branch and
  // the one whose hits the scorer is expected to score 0.
  if (fused.length < threshold) {
    if (budgetSpent()) {
      steps.push({ round: 3, branch: "fuzzy", hits: 0, ms: 0, skipped: "budget" })
      degraded = "retrieval_budget"
    } else {
      const fuzzy = await runBranch(
        () => source.fuzzy(request.query, keywords, FUZZY_CANDIDATES),
        now,
        []
      )
      steps.push(branchStep(3, "fuzzy", fuzzy))
      // Re-fuse rather than append: a failed round contributes an empty list,
      // which leaves the fusion unchanged, so the call needs no guard.
      lists.push({ source: "fuzzy", ids: fuzzy.value.map((hit) => hit.id) })
      fused = reciprocalRankFusion(lists)
    }
  }

  let wikiEvidence: WikiEvidence[] = []

  // R4 is the only round that leaves the corpus, so it is also the only one
  // gated on the question needing lore at all.
  if (fused.length < threshold) {
    const reason = !request.needsLore
      ? "no_lore_needed"
      : budgetSpent()
        ? "budget"
        : wiki
          ? null
          : "no_wiki_source"

    if (reason !== null) {
      // A round the ladder decided against is still part of the record: `steps`
      // says why it stopped, not just where.
      steps.push({ round: 4, branch: "wiki", hits: 0, ms: 0, skipped: reason })
      if (reason === "budget") degraded = "retrieval_budget"
    } else if (wiki) {
      const outcome = await runBranch(() => wiki(request.query), now, [])
      // hits is the number of extracts, which is what the model will read.
      steps.push(branchStep(4, "wiki", outcome))
      wikiEvidence = outcome.value
    }
  }

  const docs = await hydrate(
    source,
    fused.map((candidate) => candidate.id)
  )

  return {
    docs: rankCandidates(fused, docs, keywords, { limit, numbers, preferRecent, preferEarliest }),
    wiki: wikiEvidence,
    steps,
    degraded,
  }
}
