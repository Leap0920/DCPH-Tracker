/**
 * The golden eval harness: a question set, a runner, and one number.
 *
 * It is deliberately ignorant of how retrieval works. `run` is injected -- in
 * the gate below it is a closure over `runLadder` with a fixed source -- so
 * Plan 4's orchestrator can be measured by the same harness over the same
 * fixture without this module learning what a ladder is.
 *
 * Zero I/O: reading the fixture and building the corpus belong to the test.
 */

import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"

export interface GoldenCase {
  q: string
  /** Any one of these in the top 5 counts as a hit. */
  expected: string[]
  needsLore?: boolean
  note?: string
}

export interface EvalCaseResult {
  q: string
  hits: string[]
  /** 1 or 0 for a single case. */
  recall: number
  passed: boolean
}

export interface EvalReport {
  total: number
  passed: number
  recallAt5: number
  misses: EvalCaseResult[]
}

/** The gate the fixture has to clear. Lowering it is not a fix. */
export const RECALL_GATE = 0.85

/** The evaluation window, quoted wherever the report's number is. */
export const EVAL_K = 5

/**
 * 1 when any expected id is inside the first `k` documents, else 0.
 *
 * An empty `expected` array scores 0, not 1: an unanswerable question is a
 * fixture defect, and letting it pass vacuously would hide it.
 */
export function recallAtK(docs: ScoredDoc[], expected: string[], k: number = EVAL_K): number {
  if (expected.length === 0) return 0

  const window = new Set(docs.slice(0, k).map((scored) => scored.doc.id))
  for (const id of expected) {
    if (window.has(id)) return 1
  }

  return 0
}

/**
 * Runs every case and aggregates.
 *
 * Cases run sequentially: the runner may hit a shared source (the gate's does),
 * and a deterministic order is what makes the second pass in the determinism
 * test comparable to the first.
 */
export async function evaluateRetrieval(
  cases: GoldenCase[],
  run: (query: string) => Promise<ScoredDoc[]>
): Promise<EvalReport> {
  const results: EvalCaseResult[] = []

  for (const golden of cases) {
    const docs = await run(golden.q)
    const recall = recallAtK(docs, golden.expected)

    results.push({
      q: golden.q,
      // The window the decision looked at, not the whole returned list: quoting
      // ids past the window would describe a search the report does not score.
      hits: docs.slice(0, EVAL_K).map((scored) => scored.doc.id),
      recall,
      passed: recall === 1,
    })
  }

  const passed = results.filter((result) => result.passed).length

  return {
    total: results.length,
    passed,
    // An empty run is not a failed one -- the report still has to be a ratio.
    recallAt5: results.length === 0 ? 1 : passed / results.length,
    misses: results.filter((result) => !result.passed),
  }
}
