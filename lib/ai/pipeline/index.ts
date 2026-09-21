/**
 * The agentic pipeline: the stages Plan 4 built, composed in one function.
 *
 * `runPipeline` is what the answer route calls (Task 12). It owns the order —
 * resolve, plan, execute, screen, assemble — and nothing else: every stage is a
 * module with its own tests, and this file is only where they meet. Four
 * properties the route depends on:
 *
 * 1. **It never throws.** Every stage already contains its own failures, so a
 *    throw reaching this file is a bug rather than a bad request; it is turned
 *    into a `pipeline_failed` result. A throw here would turn a degraded answer
 *    into a 500 on a question the refusal gate answers honestly.
 * 2. **It is rollback-able.** `AI_PIPELINE=v1` returns `null` before any stage
 *    runs at all, and the route takes today's `searchAll` path unchanged
 *    (constraint 11, D7).
 * 3. **A request is never lost to a missing corpus.** When the resolved corpus
 *    is the static one and nothing survived screening, the legacy retrieval
 *    runs as a fallback inside v2 (constraint 12, D7). Without it, every
 *    question asked before the `20260919*` migrations are applied would answer
 *    "I could not find a reliable answer".
 * 4. **It owns no side effects.** No `after()` work, no persistence, no
 *    transcript access: Plan 3's seam is exactly where it was, and the result
 *    is data.
 *
 * Two contracts the route reads:
 *
 * - **Messages.** `assembleMessages` leaves the current user message to its
 *   caller, and that caller is the route rather than this file: the route is
 *   the only place that has the user's own words *and* the retrieval query
 *   derived from them (`route.ts` joins the previous user turn onto the message
 *   to build `searchQuery`). `PipelineResult.messages` is therefore the system
 *   message plus the window's turns, and the route appends the user's turn.
 * - **Screening.** Documents are screened and wrapped by `screenDocuments`;
 *   wiki extracts have no title/body split, so the pipeline applies the same
 *   sequence by hand. Both kinds are counted in `screening`, which is what the
 *   route reports as `degraded_reason: "screened"` (D4).
 */
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import { buildCaseDocs, buildEntryDocs } from "@/lib/ai/corpus/tracker"
import type { ChatMessage } from "@/lib/ai/gateway"
import { assembleMessages, type EvidenceRef } from "@/lib/ai/pipeline/assemble"
import { executePlan } from "@/lib/ai/pipeline/execute"
import { planQuery } from "@/lib/ai/pipeline/planner"
import type { PlanSource } from "@/lib/ai/pipeline/router"
import {
  resolveRetrievalDeps,
  type AdminRowsClient,
  type ResolverClient,
  type RetrievalDeps,
} from "@/lib/ai/pipeline/source-resolver"
import { screenDocuments, screenText, wrapEvidence } from "@/lib/ai/prompt/screen"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"
import type { StructuredCall } from "@/lib/ai/structured"
import type { ToolContext, ToolName, ToolResult } from "@/lib/ai/tools"
import type { WikiCache } from "@/lib/ai/wiki-cache"
import type { PersistedTurn } from "@/lib/chat/persistence"
import type { ChatContext } from "@/lib/chat/search"

/** The one value that selects the old path. Read from `AI_PIPELINE` (rule 1). */
export const PIPELINE_V1 = "v1"

/** The indexed corpus could not answer, so the legacy retrieval did (rule 2). */
const CORPUS_UNAVAILABLE = "corpus_unavailable"

/** A stage threw where none may: the result carries no evidence at all (rule 3). */
const PIPELINE_FAILED = "pipeline_failed"

/** The assembler's own degrade, carried through when nothing else fired. */
const EVIDENCE_EVICTED = "evidence_evicted"

/**
 * The origin the fallback's documents carry. Like the executor's `"tool"`, it
 * names the gather rather than a ladder branch ("entity", "fts", "fuzzy").
 */
const LEGACY_ORIGIN = "legacy"

/**
 * Whether the route takes the new path or today's.
 *
 * Exactly `v1` selects the rollback; unset, empty and every other value is
 * `v2`, so a typo can only ever keep the new path rather than silently
 * restoring the old one. Surrounding whitespace from an env file is tolerated
 * (it is not a different value); case is not, so `V1` is `v2`.
 */
export function pipelineVersion(env: NodeJS.ProcessEnv = process.env): "v1" | "v2" {
  return (env.AI_PIPELINE ?? "").trim() === PIPELINE_V1 ? PIPELINE_V1 : "v2"
}

/** What the screening stage removed, for `ai_request_log` (D4, Task 13). */
export interface ScreeningReport {
  /**
   * The ids the stage dropped, in input order: the documents
   * `screenDocuments` excluded, then `wiki:<source>:<title>` for every extract
   * a high-severity match cost. Both screening passes contribute when the
   * corpus fallback ran.
   */
  excluded: string[]
  /**
   * Every recorded match, including the ones that cost a document — the number
   * a `degraded_reason: "screened"` line is read against.
   */
  matches: number
  /** Admitted documents and extracts whose text a low-severity match changed. */
  redacted: number
}

export interface PipelineInput {
  /**
   * The retrieval query: what the planner plans and the ladder searches for.
   * The route passes its `searchQuery`, not the user's raw message — the turn
   * the model sees is the route's to append (see the module note above).
   */
  message: string
  /** The window's turns, oldest first, for the assembler. */
  priorTurns: PersistedTurn[]
  /** The user's recent turns, for the planner's prompt. */
  priorUserMessages: string[]
  /** `buildSystemPrompt`'s output. The route owns the profile and site facts. */
  systemPrompt: string
  /** `renderMemoryBlock`'s output, "" when memory is off. */
  memories: string
  summary: string | null
  /** The id the legacy fallback's `searchAll` reads watch history for. */
  userId?: string
  /** The request's client. Null or absent means no indexed corpus. */
  client?: ResolverClient | null
  /** The admin client: tracker rows, and the wiki cache. */
  admin?: AdminRowsClient | null
  /** The request's tool context; `source` and `wiki` come from the resolution. */
  toolCtx?: Partial<ToolContext>
  /**
   * The route's structured call (`toStructuredCall` over the request's gateway
   * and targets). Absent or null means no schema-capable target was injected,
   * so `planQuery` stays on the router's plan and spends nothing — which is
   * D1's default path either way.
   */
  plannerCall?: StructuredCall | null
  /** True when the injected call enforces the schema by constrained decoding. */
  plannerStrict?: boolean
  env?: NodeJS.ProcessEnv
  now?: () => number
  log?: (line: string) => void
}

export interface PipelineResult {
  version: "v2"
  /**
   * The assembler's output: the system message, then the window's turns. The
   * route appends the current user turn (see the module note above).
   */
  messages: ChatMessage[]
  /** The refs the answer may cite; `length` is the number the log records. */
  evidence: EvidenceRef[]
  /**
   * What the assembler evicted to fit the budgets, verbatim from its report and
   * in its order (D5): the dropped document/wiki ids, then `turns:<n>` when
   * turns were trimmed, then `summary` when the rolling summary was dropped.
   * Carried out unchanged — nothing downstream recomputes it — and `[]`, never
   * `null`, when nothing was evicted: that is a fact, not an absence.
   *
   * This is not the same list as `degraded`'s `"evidence_evicted"`: that reason
   * is set only when a document or wiki id was evicted, never for a trimmed turn
   * or a dropped summary, so a non-empty `evicted` does not imply it.
   */
  evicted: string[]
  /**
   * Why the answer is degraded, in precedence order: `"pipeline_failed"` (a
   * stage threw), `"corpus_unavailable"` (the legacy fallback ran), the
   * execution report's reason (`"execute_budget"`, `"ladder_failed"`,
   * `"tool_failed"`, `"retrieval_budget"`), the assembler's
   * `"evidence_evicted"`, then the resolver's standing `"corpus_static"` —
   * else null. The row's `no_evidence` is deliberately absent: a greeting that
   * retrieves nothing is not a degradation, and the refusal gate is what reads
   * that case.
   */
  degraded: string | null
  planSource: PlanSource
  /** The dispatched tools, deduped, in execution order (Task 13's `tools`). */
  toolNames: string[]
  timings: { planMs: number; retrieveMs: number; assembleMs: number }
  screening: ScreeningReport
}

/** Measured per stage on the injected clock; `null` for a stage is never used
 *  because zero is a real measurement of a fake clock that does not move. */
export interface PipelineTimings {
  planMs: number
  retrieveMs: number
  assembleMs: number
}

/**
 * Today's retrieval, unchanged (D7): `searchAll` over the tracker tables plus
 * the DCW/Wikipedia fetch.
 *
 * The route calls this for `AI_PIPELINE=v1` — the rollback — and the pipeline
 * calls it for the corpus fallback, so there is one legacy path to test rather
 * than two. The import is dynamic on purpose: `lib/chat/search` reaches
 * `lib/env`, which throws at import time when the Supabase variables are unset
 * (`source-resolver.ts` documents the same trap), so a static import would make
 * this module — and every test of it — unimportable wherever `.env.local` is
 * absent.
 */
export async function runLegacyRetrieval(query: string, userId: string): Promise<ChatContext> {
  const { searchAll } = await import("@/lib/chat/search")
  return searchAll(query, userId)
}

/**
 * The pipeline.
 *
 * `null` means v1: the version is read before anything else, so the rollback
 * costs no clock read, no probe and no import of the retrieval path.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult | null> {
  const env = input.env ?? process.env
  if (pipelineVersion(env) === PIPELINE_V1) return null

  const now = input.now ?? Date.now
  const log = input.log ?? (() => {})
  // Mutated as each stage completes, so a stage that throws still reports what
  // the stages before it cost.
  const timings: PipelineTimings = { planMs: 0, retrieveMs: 0, assembleMs: 0 }

  try {
    /* --- resolve + plan + execute: `retrieveMs` covers all three --- */

    const retrieveStartedAt = now()

    const deps = await resolveRetrievalDeps({
      client: input.client ?? null,
      admin: input.admin ?? null,
      now,
    })

    const planStartedAt = now()
    const planned = await planQuery({
      message: input.message,
      priorUserMessages: input.priorUserMessages,
      call: input.plannerCall ?? null,
      strict: input.plannerStrict ?? false,
      now,
      env,
      log,
    })
    timings.planMs = elapsed(planStartedAt, now())

    const report = await executePlan({
      plan: planned.plan,
      query: input.message,
      deps,
      toolCtx: toolContext(deps, input.toolCtx),
      now,
    })
    // Measured before screening rather than after it, so a screen that throws
    // still reports what the gather cost. The fallback adds its own time below.
    timings.retrieveMs = elapsed(retrieveStartedAt, now())

    /* --- screen both untrusted kinds -------------------------------- */

    const primary = screenEvidence(report.docs, report.wiki)
    let evidence = primary
    let screening = screeningReport(primary)
    let fallback = false

    /* --- the corpus fallback (constraint 12, D7) -------------------- */

    if (deps.mode === "static" && primary.docs.length === 0 && primary.wiki.length === 0) {
      fallback = true
      log("pipeline: the static corpus found nothing, falling back to the legacy retrieval")
      const fallbackStartedAt = now()
      try {
        const legacy = await legacyEvidence(input.message, input.userId ?? "")
        const converted = screenEvidence(legacy.docs, legacy.wiki)
        // The evidence is replaced, the screening is merged: what the ladder's
        // own documents cost must stay countable in the log even when the
        // fallback is what ends up answering.
        evidence = converted
        screening = {
          excluded: [...primary.excluded, ...converted.excluded],
          matches: primary.matches + converted.matches,
          redacted: primary.redacted + converted.redacted,
        }
      } catch {
        // The fallback is the last resort. An empty evidence set here is the
        // refusal gate's honest answer, never a throw (rule 2).
      }
      timings.retrieveMs += elapsed(fallbackStartedAt, now())
    }

    /* --- assemble ---------------------------------------------------- */

    const assembleStartedAt = now()
    const assembled = assembleMessages({
      systemPrompt: input.systemPrompt,
      memories: input.memories,
      summary: input.summary,
      turns: input.priorTurns,
      docs: evidence.docs,
      wiki: evidence.wiki,
    })
    timings.assembleMs = elapsed(assembleStartedAt, now())

    const degraded = degradeReason({
      fallback,
      execute: report.degraded,
      evicted: assembled.report.degraded === EVIDENCE_EVICTED,
      resolved: deps.degraded,
    })
    const toolNames = dispatchToolNames(report.results)

    log(
      `pipeline: source=${planned.source} mode=${deps.mode} evidence=${assembled.report.evidence.length}` +
        ` tools=${toolNames.length}${degraded === null ? "" : ` degraded=${degraded}`}`
    )

    return {
      version: "v2",
      messages: assembled.messages,
      evidence: assembled.report.evidence,
      evicted: assembled.report.evicted,
      degraded,
      planSource: planned.source,
      toolNames,
      timings,
      screening,
    }
  } catch (error) {
    // Rule 3. Every stage above absorbs its own failures, so this is a bug —
    // and a bug here must still be an answer, not a 500.
    log(`pipeline: failed: ${errorMessage(error)}`)
    return failureResult(timings)
  }
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

/**
 * The tool context `executePlan` dispatches with.
 *
 * `source` is the resolved corpus — the tools must read the same documents the
 * ladder ranked, so the resolution wins over a caller-supplied source — and
 * `wiki` falls back to an adapter over the resolver's wiki dep. The adapter's
 * `put` is a no-op because that dep already owns its store (the cache writes
 * through on a miss); the tools' `wiki_lookup` never runs anyway, because the
 * executor routes it through the ladder.
 */
function toolContext(deps: RetrievalDeps, partial: Partial<ToolContext> | undefined): ToolContext {
  const wiki: WikiCache = partial?.wiki ?? {
    lookup: (query: string) => deps.wiki(query),
    put: async () => {},
  }

  return { ...partial, source: deps.source, wiki }
}

/** The screening pass's outcome: what may be assembled, and what it cost. */
interface Screening {
  docs: ScoredDoc[]
  wiki: WikiEvidence[]
  excluded: string[]
  matches: number
  redacted: number
}

/**
 * Screens both untrusted kinds and returns what may be assembled.
 *
 * Documents go through `screenDocuments`, which screens the title as well as
 * the body (the title is a rendered label) and wraps what survives. A wiki
 * extract has no title/body split, so the same sequence is applied here by
 * hand: `screenText` first, `wrapEvidence` second — the order that makes the
 * marker unforgeable, and idempotent with the wrap the assembler adds. Both the
 * extract and its title are screened, because the title becomes the block's
 * label; a high-severity match in either drops the extract and names it in the
 * exclusions under the id the assembler would have given it.
 */
function screenEvidence(docs: ScoredDoc[], wiki: WikiEvidence[]): Screening {
  const documents = screenDocuments(docs)
  const admitted: WikiEvidence[] = []
  const excluded = [...documents.excluded]
  let matches = documents.matches
  let redacted = documents.redactedCount

  for (const extract of wiki) {
    const body = screenText(extract.extract)
    const title = screenText(extract.title)
    matches += body.matches.length + title.matches.length

    if (!body.ok || !title.ok) {
      excluded.push(`wiki:${extract.source}:${extract.title}`)
      continue
    }

    if (body.redacted !== extract.extract || title.redacted !== extract.title) redacted += 1
    admitted.push({
      ...extract,
      title: title.redacted,
      extract: wrapEvidence(body.redacted),
    })
  }

  return { docs: documents.admitted, wiki: admitted, excluded, matches, redacted }
}

/** The screening facts a result carries; the docs/wiki stay behind. */
function screeningReport(screening: Screening): ScreeningReport {
  return {
    excluded: [...screening.excluded],
    matches: screening.matches,
    redacted: screening.redacted,
  }
}

/**
 * The corpus fallback's evidence (D7): the v1 `ChatContext` as documents and
 * wiki extracts.
 *
 * `buildEntryDocs` + `buildCaseDocs` are the same two builders
 * `buildCorpusDocuments` uses for those namespaces, so a converted row is the
 * document the static corpus would have held for it — the fallback is a second
 * way to *find* it, never a second description of it. `searchAll` selects the
 * generated row types and the builders take structural ones, and the two line
 * up field for field, so the rows pass through without a projection or a cast.
 *
 * v1 ranked its rows with `scoreEntry`, but that rank never left the query, so
 * every converted document is rankless (`rrf: 0`, `score: 0`) like a wiki
 * extract: the input order — v1's own relevance order — decides the numbering
 * and the eviction order, and the assembler reads nothing else.
 */
async function legacyEvidence(
  query: string,
  userId: string
): Promise<{ docs: ScoredDoc[]; wiki: WikiEvidence[] }> {
  const context = await runLegacyRetrieval(query, userId)
  const documents: CorpusDocument[] = [
    ...buildEntryDocs(context.episodes, context.cases),
    ...buildCaseDocs(context.cases),
  ]

  return {
    docs: documents.map((doc) => ({ doc, score: 0, rrf: 0, origins: [LEGACY_ORIGIN] })),
    wiki: context.dcwWiki,
  }
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The result a total failure returns (rule 3).
 *
 * `messages` is empty rather than assembled: the assembler is one of the stages
 * that can have thrown, so calling it again here would be the same throw. The
 * route's refusal gate reads the empty evidence set and answers honestly.
 * `evicted` is empty because a total failure evicted nothing — the assembler
 * never ran to report it. `planSource: "fallback"` is the only honest member —
 * no model plan exists and the router's plan never ran to completion — and it is
 * what marks the request as one that produced no usable plan at all.
 */
function failureResult(timings: PipelineTimings): PipelineResult {
  return {
    version: "v2",
    messages: [],
    evidence: [],
    evicted: [],
    degraded: PIPELINE_FAILED,
    planSource: "fallback",
    toolNames: [],
    timings,
    screening: { excluded: [], matches: 0, redacted: 0 },
  }
}

/**
 * The result's one degrade reason, in precedence order.
 *
 * The fallback wins over everything: when it ran, the corpus the request was
 * built for was not answering, whatever the individual stages reported. The
 * executor's reason is next (a cut-off gather says more than a standing
 * condition), then the assembly's eviction, then the resolver's `corpus_static`
 * — which is the deployment's state rather than this request's, so it is the
 * last thing to report and the first thing to be displaced.
 */
function degradeReason(input: {
  fallback: boolean
  execute: string | null
  evicted: boolean
  resolved: string | null
}): string | null {
  if (input.fallback) return CORPUS_UNAVAILABLE
  if (input.execute !== null) return input.execute
  if (input.evicted) return EVIDENCE_EVICTED
  return input.resolved
}

/** The dispatched tools, deduped, in execution order (rule 6). The drops the
 *  ladder subsumed are not dispatches and are not listed. */
function dispatchToolNames(results: ToolResult[]): ToolName[] {
  const names: ToolName[] = []
  for (const result of results) {
    if (!names.includes(result.name)) names.push(result.name)
  }
  return names
}

/** A stage's duration on the injected clock. Clamped at 0 like every other
 *  measurement in this pipeline, so a clock that does not move reports 0
 *  rather than a negative. */
function elapsed(startedAt: number, at: number): number {
  return Math.max(0, at - startedAt)
}

/** A failure's message, for the log line. A non-Error throw is a value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
