/**
 * Plan execution: the ladder and the deterministic tools in one round trip,
 * merged into one ranked evidence set.
 *
 * Four properties the pipeline above this stage depends on:
 *
 * 1. **One round trip.** The ladder and `runTools` are started before either is
 *    awaited, so the gather costs the slower branch, not their sum. The phase's
 *    latency budget assumes this; a sequential executor is a regression.
 * 2. **The ladder subsumes three of the plan's eight tools.** `search_catalog`,
 *    `search_cases` and `wiki_lookup` are the ladder's own branches scoped to one
 *    namespace, so dispatching them too would fetch the same documents twice and
 *    pay twice for it. They are dropped, and the drop is recorded in `dropped`.
 * 3. **The merge keeps the ladder's ranking, it does not re-sort.** `runLadder`
 *    returns `rankCandidates`' order — fuse first, score second, so the scorer's
 *    verdict is already in it — and the merge preserves that order verbatim,
 *    appending the tools' precise hits after it. Re-sorting by `rrf` throws the
 *    verdict away: the golden pipeline eval measured 60/60 → 50/60 recall@5
 *    when the merge did it. The order is still total and deterministic, which
 *    is what makes `[E#]` mean the same document on a retry.
 * 4. **The stage is bounded and cannot throw.** An expiring budget returns what
 *    has arrived; a gather that breaks outright is a flag in the report. A throw
 *    here is a 500 on a question the other gather could still answer.
 *
 * Everything is injected: the source, the wiki lookup, the tool context and the
 * clock. Importing this module performs no I/O.
 */
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import {
  DEFAULT_LADDER_LIMIT,
  runLadder,
  type LadderResult,
  type LadderStep,
  type RetrievalRequest,
  type WikiEvidence,
} from "@/lib/ai/retrieval/ladder"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import type { PlanStep, PlanToolName, QueryPlan } from "@/lib/ai/pipeline/plan"
import type { RetrievalDeps } from "@/lib/ai/pipeline/source-resolver"
import { runTools, type ToolContext, type ToolRequest, type ToolResult } from "@/lib/ai/tools"
import { withTimeout } from "@/lib/request-timeout"

/** The hard bound on the whole stage (constraint 10): a stage that overruns
 *  degrades, it never extends the request. */
export const EXECUTE_BUDGET_MS = 2000

/** Why a plan step was not dispatched. A closed set, so a report can count it. */
export type DroppedWhy = "ladder"

/**
 * A plan step the executor deliberately did not dispatch.
 *
 * `ToolResult` cannot carry this — it describes a tool that ran — so the drops
 * are recorded beside the results instead, in plan order: the execution report
 * accounts for every step the plan asked for.
 */
export interface DroppedStep {
  name: PlanToolName
  why: DroppedWhy
}

export interface ExecuteInput {
  plan: QueryPlan
  /** The user's message, as the ladder's query. Not a step's argument. */
  query: string
  deps: RetrievalDeps
  toolCtx: ToolContext
  /** Injected clock; production uses `Date.now`. */
  now?: () => number
}

export interface ExecuteReport {
  /** The merged, deduped evidence: ladder documents plus the tools' precise hits. */
  docs: ScoredDoc[]
  wiki: WikiEvidence[]
  /** One entry per dispatched tool, in plan order. */
  results: ToolResult[]
  /** The steps the ladder subsumed, in plan order. */
  dropped: DroppedStep[]
  steps: LadderStep[]
  /** `"execute_budget"` | `"tool_failed"` | `"ladder_failed"` | the ladder's own
   *  degrade | null. */
  degraded: string | null
  ms: number
}

/**
 * What the ladder already covers. Its four rounds run over the whole corpus, and
 * these three tools are precisely those rounds scoped to one namespace, so the
 * executor drops them rather than fetching the same documents twice.
 */
const LADDER_SUBSUMED: ReadonlySet<string> = new Set<PlanToolName>([
  "search_catalog",
  "search_cases",
  "wiki_lookup",
])

/** The origin a tool-found document carries. The ladder's origins are branch
 *  names ("entity", "fts", "fuzzy"); this one names the other gather. */
const TOOL_ORIGIN = "tool"

/** The abort message of a gather that never ran or never answered. A total
 *  rejection is reported as the empty ladder, never as a fabricated result. */
const EMPTY_LADDER: LadderResult = { docs: [], wiki: [], steps: [], degraded: null }

/**
 * Executes one plan.
 *
 * `runTools` already fans out with `Promise.all`; the ladder is started in the
 * same turn, so the two gathers overlap. Both are contained: each converts its
 * own rejection into a flag, which leaves the stage's budget as the only
 * rejection `withTimeout` can see.
 *
 * On expiry the report holds whatever arrived — a resolved gather is never
 * discarded to honour the budget — with `degraded: "execute_budget"`.
 */
export async function executePlan(input: ExecuteInput): Promise<ExecuteReport> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const { requests, dropped } = dispatchSteps(input.plan.steps)

  let ladder: LadderResult | null = null
  let results: ToolResult[] | null = null
  let ladderFailed = false
  let toolsFailed = false

  // The two gathers are launched before either is awaited, which is the whole
  // point of this stage: one round trip, not two. Each records its value inside
  // its own promise, so an expiring budget still sees the work that arrived.
  const gatherLadder = (async () => {
    try {
      ladder = await runLadder(ladderRequest(input.plan, input.query), {
        source: input.deps.source,
        wiki: input.deps.wiki,
      })
    } catch {
      ladderFailed = true
    }
  })()

  const gatherTools = (async () => {
    try {
      results = await runTools(requests, input.toolCtx)
    } catch {
      toolsFailed = true
    }
  })()

  let timedOut = false
  try {
    await withTimeout(Promise.all([gatherLadder, gatherTools]), EXECUTE_BUDGET_MS)
  } catch {
    // The only rejection that can reach here is the budget timer: both gathers
    // above absorb their own failures.
    timedOut = true
  }

  // Annotated because the assignments above happen inside the gather closures:
  // control-flow analysis cannot see them, and `results ?? []` would otherwise
  // infer `never[]`.
  const ladderResult: LadderResult = ladder ?? EMPTY_LADDER
  const toolResults: ToolResult[] = results ?? []

  return {
    docs: mergeEvidence({
      toolDocs: toolResults.flatMap((result) => result.docs),
      ladderDocs: ladderResult.docs,
    }),
    wiki: ladderResult.wiki,
    results: toolResults,
    dropped,
    steps: ladderResult.steps,
    degraded: degradeReason({
      timedOut,
      ladderFailed,
      toolsFailed,
      dispatched: requests.length,
      results: toolResults,
      ladder: ladderResult,
    }),
    ms: Math.max(0, now() - startedAt),
  }
}

/**
 * The plan's retrieval parameters, handed to the ladder unchanged.
 *
 * The plan already resolved the question's keywords, numbers and chronological
 * preference (the router or the model did that work), so re-deriving them here
 * would be a second, disagreeing opinion. The ladder limit is its own default:
 * the plan schema carries no ladder limit, and each step's `limit` is the
 * tool's.
 */
function ladderRequest(plan: QueryPlan, query: string): RetrievalRequest {
  return {
    query,
    keywords: plan.keywords,
    numbers: plan.numbers,
    preferRecent: plan.preferRecent,
    preferEarliest: plan.preferEarliest,
    needsLore: plan.needsLore,
    limit: DEFAULT_LADDER_LIMIT,
  }
}

/** Splits the plan's steps into the tool requests to dispatch and the drops to
 *  record, both in plan order. */
function dispatchSteps(steps: PlanStep[]): { requests: ToolRequest[]; dropped: DroppedStep[] } {
  const requests: ToolRequest[] = []
  const dropped: DroppedStep[] = []

  for (const step of steps) {
    if (LADDER_SUBSUMED.has(step.name)) {
      dropped.push({ name: step.name, why: "ladder" })
      continue
    }

    requests.push(toRequest(step))
  }

  return { requests, dropped }
}

/**
 * One plan step as a `ToolRequest`, with the argument key the handler reads.
 *
 * `lookup_character` is the one that has to be translated: the step carries
 * `name_query` (its own `name` field is the tool's name) while the tool's
 * argument is `name`. Optional arguments are omitted rather than passed as
 * `undefined`, so the request reads exactly like the plan.
 */
function toRequest(step: PlanStep): ToolRequest {
  switch (step.name) {
    case "lookup_character":
      return { name: step.name, args: { name: step.name_query } }
    case "classify_episode":
      return { name: step.name, args: { episode: step.episode } }
    case "arc_for_range": {
      const args: Record<string, unknown> = { start: step.start }
      if (step.end !== undefined) args.end = step.end
      return { name: step.name, args }
    }
    case "next_unwatched": {
      const args: Record<string, unknown> = {}
      if (step.limit !== undefined) args.limit = step.limit
      return { name: step.name, args }
    }
    case "search_conversations": {
      const args: Record<string, unknown> = { query: step.query }
      if (step.limit !== undefined) args.limit = step.limit
      return { name: step.name, args }
    }
    // The three the ladder subsumes never reach here; `dispatchSteps` filters
    // them out before calling this. The cases exist so the switch stays
    // exhaustive if the tool union grows.
    case "search_catalog":
    case "search_cases":
    case "wiki_lookup":
      return { name: step.name, args: {} }
  }
}

/**
 * The report's one degrade reason, in precedence order.
 *
 * An expired budget says the least about what was gathered, so it wins. Every
 * dispatched tool failing is next: it is the one condition where the tools
 * contributed nothing at all. The ladder's own degrade (`retrieval_budget`) is
 * the mildest and is carried through because retrieval that stopped early still
 * shaped the answer. A plan that dispatched nothing can never be `tool_failed`:
 * no tool was tried, so none failed.
 */
function degradeReason(input: {
  timedOut: boolean
  ladderFailed: boolean
  toolsFailed: boolean
  dispatched: number
  results: ToolResult[]
  ladder: LadderResult
}): string | null {
  if (input.timedOut) return "execute_budget"
  if (input.ladderFailed) return "ladder_failed"
  if (input.dispatched > 0 && (input.toolsFailed || input.results.every((r) => !r.ok))) {
    return "tool_failed"
  }
  return input.ladder.degraded
}

/**
 * Merges the two gathers by document id.
 *
 * A document both found is one document: the ladder's entry is the base — its
 * position, score and rrf are the ranking's, and the tool only joins its
 * origins — and a document only a tool found is a precise hit, not a ranked
 * candidate: it keeps `rrf: 0` and `score: 0` — no gather ranked it — and
 * `origins: ["tool"]`.
 *
 * The ladder's order is kept verbatim, because it *is* the ranking:
 * `runLadder` returns `rankCandidates`' order, which deliberately fuses first
 * and scores second so the scorer's verdict is the final order. The map
 * preserves insertion order, so that is simply not destroying it with a sort.
 * Re-sorting by `rrf` here discarded the verdict — the golden pipeline eval
 * fell from 60/60 to 50/60 recall@5 while the merge did it — and the assembler
 * reads the same order as the rank, evicting from its tail.
 *
 * Tool-only documents come after every ladder document, in the order
 * `toolDocs` gives them: they are appendages to the ranking, not part of it.
 * Pure: neither input array nor any entry is mutated.
 */
export function mergeEvidence(input: {
  toolDocs: CorpusDocument[]
  ladderDocs: ScoredDoc[]
}): ScoredDoc[] {
  const merged = new Map<string, ScoredDoc>()

  for (const entry of input.ladderDocs) {
    merged.set(entry.doc.id, { ...entry, origins: [...entry.origins] })
  }

  for (const doc of input.toolDocs) {
    const existing = merged.get(doc.id)
    if (existing) {
      if (!existing.origins.includes(TOOL_ORIGIN)) existing.origins.push(TOOL_ORIGIN)
      continue
    }

    merged.set(doc.id, { doc, score: 0, rrf: 0, origins: [TOOL_ORIGIN] })
  }

  return [...merged.values()]
}
