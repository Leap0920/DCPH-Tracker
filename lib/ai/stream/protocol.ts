/**
 * The chat transport's part vocabulary: the one place the server and the client
 * agree on what crosses the wire.
 *
 * The response is an AI SDK UI message stream (`createUIMessageStream` in the
 * route). The SDK's own `text` part carries the answer; the four `data-*` parts
 * this module names carry the facts the UI renders — the evidence refs, the
 * pipeline's activity, the degrade reasons and the citation report. Because
 * both sides import these names, a part cannot be renamed on one side and
 * silently dropped on the other.
 *
 * **Dependency-free on purpose.** This module is imported by the route (a Node
 * server module) and by a client component (a browser bundle), so it holds
 * types and pure functions and imports nothing at runtime: the four type-only
 * imports below are erased at compile time by every bundler we use. That is
 * also why no measurement or derivation happens here — a builder copies what
 * the route already computed, so a value cannot be measured twice and drift.
 *
 * **`PROTOCOL_VERSION` is the envelope's compatibility seam.** It travels once,
 * in the `activity` part, and a client that reads a version it does not know
 * must render the text alone rather than guess at the data parts' shapes. The
 * version bumps when a part's payload changes shape, not when a new optional
 * field or a new degrade reason appears.
 */
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import type { PipelineResult } from "@/lib/ai/pipeline"
import type { PlanSource } from "@/lib/ai/pipeline/router"

/** The envelope version this module describes. See the module note. */
export const PROTOCOL_VERSION = 1

/**
 * The part names, in one object so server and client cannot drift. These are
 * the AI SDK's data-part `type` values: a chunk is
 * `{ type: "data-evidence", data: EvidencePart }`.
 */
export const PARTS = {
  evidence: "data-evidence",
  activity: "data-activity",
  degraded: "data-degraded",
  citations: "data-citations",
} as const

export type PartName = (typeof PARTS)[keyof typeof PARTS]

/** The refs the answer may cite, verbatim from `PipelineResult.evidence`. */
export interface EvidencePart {
  refs: EvidenceRef[]
}

/**
 * What the pipeline did, in the reader's terms: which planner decided, which
 * tools ran, and what each stage cost. Non-secret only — no provider name, no
 * key, no raw error (constraint 9). `null` is a real answer: v1 has no planner
 * and no assembler, so `planSource`/`planMs`/`assembleMs` are absent there
 * rather than zero.
 */
export interface ActivityPart {
  protocol: number
  planSource: PlanSource | null
  tools: string[]
  timings: {
    planMs: number | null
    retrieveMs: number | null
    assembleMs: number | null
  }
  /**
   * What the assembler evicted, when it evicted anything: the dropped
   * document/wiki ids, then `turns:<n>` (see `TURN_EVICTION_MARKER`), then
   * `summary` (see `SUMMARY_EVICTION_MARKER`) — the pipeline's list, verbatim.
   * Omitted when the list is empty, so the common response keeps v1's exact
   * shape and `PROTOCOL_VERSION` stays `1`: an optional field is not a shape
   * change, and a client that does not read it is unaffected.
   */
  evicted?: string[]
}

/**
 * The two non-source markers `evicted` can carry, as reader-facing string
 * values. They mirror `assemble.ts`'s exported `TURN_EVICTION_PREFIX` and
 * `SUMMARY_EVICTION`; the duplication is deliberate, because this module must
 * stay browser-bundle-safe and importing the assembler would pull the whole
 * retrieval path into the browser bundle. `lib/__tests__/stream-protocol.test.ts`
 * asserts each pair is equal, so the two cannot drift.
 */
export const TURN_EVICTION_MARKER = "turns:"
export const SUMMARY_EVICTION_MARKER = "summary"

/** The degrade vocabulary, as strings — the client owns the wording (Task 6). */
export interface DegradedPart {
  reasons: string[]
}

/** The citation verdict `validateCitations` reached on the finished answer. */
export interface CitationsPart {
  report: CitationReport
}

/**
 * The reasons `PipelineResult.degraded` can carry (Plan 4's vocabulary). The
 * resolver's `corpus_static` is a deployment state, the executor's four are
 * request conditions, and the other three are stage failures.
 */
export const PIPELINE_DEGRADE_REASONS = [
  "pipeline_failed",
  "corpus_unavailable",
  "execute_budget",
  "ladder_failed",
  "tool_failed",
  "retrieval_budget",
  "evidence_evicted",
  "corpus_static",
] as const

/** The reasons the route derives itself, in `degradedReasonFor`'s precedence. */
export const SCREENED_REASON = "screened"
export const UNCITED_REASON = "uncited"
export const RETRIEVAL_FAILED_REASON = "retrieval_failed"
export const ROUTE_DEGRADE_REASONS = [
  SCREENED_REASON,
  UNCITED_REASON,
  RETRIEVAL_FAILED_REASON,
] as const

/**
 * The synthetic-string state tokens (D5). The three messages are already honest
 * sentences; these tokens name *which* state produced them, and Phase 6's log
 * queries group by them, so they are exported rather than written as literals
 * at the call site.
 */
export const RATE_LIMITED_REASON = "rate_limited"
export const EMPTY_RESULT_REASON = "empty_result"
export const PARTIAL_ANSWER_REASON = "partial_answer"

/** The three synthetic tokens, for a client that must recognise any of them. */
export const SYNTHETIC_STATE_REASONS = [
  RATE_LIMITED_REASON,
  EMPTY_RESULT_REASON,
  PARTIAL_ANSWER_REASON,
] as const

/**
 * Every reason this phase can put in a `degraded` part. A reason outside this
 * list is still carried — Task 6 renders an unknown reason by name rather than
 * hiding it — but the list is what the client's wording table is checked
 * against and what Phase 6's queries filter on.
 */
export const DEGRADED_REASONS = [
  ...PIPELINE_DEGRADE_REASONS,
  ...ROUTE_DEGRADE_REASONS,
  ...SYNTHETIC_STATE_REASONS,
] as const

export type DegradedReason = (typeof DEGRADED_REASONS)[number]

/**
 * The activity part for either path. v2 copies the pipeline's own plan facts;
 * when the pipeline did not run (v1, or a pipeline that threw before returning
 * a result) the route's retrieval measurement is the only honest number, and
 * the planner and assembler fields are `null` rather than a fabricated zero.
 */
export function buildActivityPart(input: {
  pipeline: PipelineResult | null
  retrieveMs: number
}): ActivityPart {
  if (input.pipeline === null) {
    return {
      protocol: PROTOCOL_VERSION,
      planSource: null,
      tools: [],
      timings: { planMs: null, retrieveMs: input.retrieveMs, assembleMs: null },
    }
  }

  const part: ActivityPart = {
    protocol: PROTOCOL_VERSION,
    planSource: input.pipeline.planSource,
    tools: [...input.pipeline.toolNames],
    timings: {
      planMs: input.pipeline.timings.planMs,
      retrieveMs: input.pipeline.timings.retrieveMs,
      assembleMs: input.pipeline.timings.assembleMs,
    },
  }
  // Only when there is something to say: an empty list is omitted rather than
  // sent as `[]`, so a response that evicted nothing keeps v1's exact shape.
  // Copied, like the tools, so a later mutation of the result cannot rewrite
  // what was already sent.
  if (input.pipeline.evicted.length > 0) part.evicted = [...input.pipeline.evicted]
  return part
}

/** The evidence refs, copied so a later mutation of the result cannot rewrite
 *  what was sent. */
export function buildEvidencePart(pipeline: PipelineResult): EvidencePart {
  return { refs: [...pipeline.evidence] }
}

/**
 * The degrade part, or `null` when there is nothing to report. `null` rather
 * than an empty array so the "only send a part when there is a reason" rule
 * lives here instead of at each call site.
 */
export function buildDegradedPart(reasons: readonly string[]): DegradedPart | null {
  const unique: string[] = []
  for (const reason of reasons) {
    if (typeof reason === "string" && reason.length > 0 && !unique.includes(reason)) {
      unique.push(reason)
    }
  }
  return unique.length === 0 ? null : { reasons: unique }
}

/** The citation report, verbatim. */
export function buildCitationsPart(report: CitationReport): CitationsPart {
  return { report }
}

/**
 * Whether a `protocol` value is one this client understands. A client that
 * reads an unknown version renders the text alone (see the module note).
 */
export function isKnownProtocol(protocol: unknown): boolean {
  return protocol === PROTOCOL_VERSION
}

/**
 * The guards below narrow a data chunk's `data` field, which arrives as
 * `unknown`. They check the fields the client reads and nothing more: a payload
 * that satisfies one is safe to hand to the view-model mapping, and a payload
 * that does not is ignored rather than cast.
 */
export function isActivityPart(value: unknown): value is ActivityPart {
  if (!isRecord(value)) return false
  const timings = value.timings
  return (
    typeof value.protocol === "number" &&
    (value.planSource === null ||
      value.planSource === "router" ||
      value.planSource === "model" ||
      value.planSource === "fallback") &&
    isStringArray(value.tools) &&
    // Optional: absent is valid (the common case), but a present value must be
    // a string list — a malformed one must not reach the renderer.
    (value.evicted === undefined || isStringArray(value.evicted)) &&
    isRecord(timings) &&
    isNullableNumber(timings.planMs) &&
    isNullableNumber(timings.retrieveMs) &&
    isNullableNumber(timings.assembleMs)
  )
}

export function isEvidencePart(value: unknown): value is EvidencePart {
  return isRecord(value) && Array.isArray(value.refs)
}

export function isDegradedPart(value: unknown): value is DegradedPart {
  return isRecord(value) && isStringArray(value.reasons)
}

export function isCitationsPart(value: unknown): value is CitationsPart {
  return isRecord(value) && isRecord(value.report)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number"
}
