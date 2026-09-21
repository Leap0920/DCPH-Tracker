/**
 * The model planner: one bounded structured call, and the router's plan either way.
 *
 * The router is the default path (plan deviation D1) and this is the escalation, so
 * the call is spent only when it buys something: `AI_PLANNER=off`, a caller with no
 * schema-capable target (`call === null`), and `auto` on a router-confident question
 * all return the router's plan without a provider call.
 *
 * Three properties the answer path depends on:
 *
 * 1. It never rejects and never returns null. The caller is the request path, where a
 *    throw is a 500 on a question the ladder could have answered, so every failure —
 *    a rejecting provider, a non-JSON reply, a plan that gathers nothing, the budget
 *    expiring — is the router's plan with `source: "fallback"` and a short error code.
 * 2. The structured call is `generateStructured` over `QueryPlanSchema`, which owns
 *    the bounded repair ladder (one repair turn built from the validator's own
 *    complaint, a truncation re-run, then `value: null`). This module owns only when
 *    the call is worth making, what the model is asked, and the budget it runs under.
 * 3. The system message is a module constant, so the tool contract is byte-identical
 *    across requests and a caching provider can hit it.
 */
import { z } from "zod"
import type { ChatMessage } from "@/lib/ai/gateway"
import {
  MAX_PLAN_KEYWORDS,
  MAX_PLAN_NUMBERS,
  MAX_PLAN_STEPS,
  PLAN_TOOLS,
  PlanStepSchema,
  QueryPlanSchema,
  parseQueryPlan,
  type PlanToolName,
  type QueryPlan,
} from "@/lib/ai/pipeline/plan"
import { routeQuery, type PlanSource } from "@/lib/ai/pipeline/router"
import { withTimeout } from "@/lib/request-timeout"
import { generateStructured, type StructuredCall } from "@/lib/ai/structured"

/**
 * The hard bound on the planning stage. Constraint 10: the response path must not get
 * slower, so the stage degrades to the router's plan when it overruns.
 */
export const PLANNER_BUDGET_MS = 1200

/** D1's three modes, read from `AI_PLANNER`. */
export const PLANNER_MODES = ["auto", "always", "off"] as const

export type PlannerMode = (typeof PLANNER_MODES)[number]

/** The most prior user turns the planner sees. More history is context the plan does not read. */
const PLANNER_TURNS = 3

/**
 * One prior turn's character ceiling. The current message is what the plan must answer
 * and is carried whole; history is background, so a 5 kB turn cannot eat the call.
 */
export const MAX_PLANNER_TURN_CHARS = 300

/**
 * One line per tool: `name(arg: type, optional?: type)`. The argument names, their
 * types and which are optional are read off `PlanStepSchema` below, so this map only
 * carries the prose a schema cannot express.
 */
const TOOL_DESCRIPTIONS: Record<PlanToolName, string> = {
  search_catalog:
    "search the curated catalog for a named thing: a character, arc, movie, gadget or thread",
  search_cases: "search the tracker's case and episode rows for a title or a topic",
  lookup_character: "look up one character by name for their fact sheet",
  classify_episode: "classify one episode number as canon, filler, manga or anime-original",
  arc_for_range: "find the arc that covers an episode range, and what happens in it",
  next_unwatched: "list the episodes the user has not watched yet, in order",
  wiki_lookup: "look up a Detective Conan wiki topic for plot, background or relationships",
  search_conversations: "search this user's earlier conversations with the assistant",
}

/** JSON Schema's numeric type as the plan's own vocabulary names it. */
const TYPE_NAMES: Record<string, string> = {
  string: "string",
  integer: "number",
  number: "number",
  boolean: "boolean",
}

interface ToolArgument {
  name: string
  type: string
  optional: boolean
}

/**
 * The argument shape of every step variant, derived from `PlanStepSchema`'s JSON
 * Schema rather than retyped. A hand-written contract would be a second description
 * of the tool arguments that nothing keeps in step with the validator.
 */
function readToolArguments(): Map<string, ToolArgument[]> {
  const wire = z.toJSONSchema(PlanStepSchema, { io: "output" }) as {
    oneOf?: {
      properties?: Record<string, { type?: string; const?: unknown }>
      required?: string[]
    }[]
  }

  const byTool = new Map<string, ToolArgument[]>()
  for (const variant of wire.oneOf ?? []) {
    const properties = variant.properties ?? {}
    const tool = properties.name?.const
    if (typeof tool !== "string" || tool === "") continue

    const required = new Set(variant.required ?? [])
    byTool.set(
      tool,
      Object.entries(properties)
        .filter(([key]) => key !== "name")
        .map(([key, field]) => ({
          name: key,
          type: TYPE_NAMES[field.type ?? ""] ?? field.type ?? "unknown",
          optional: !required.has(key),
        }))
    )
  }

  return byTool
}

/** The tool contract as the model reads it, one line per `PLAN_TOOLS` entry. */
function toolContract(): string {
  const shapes = readToolArguments()
  const lines = PLAN_TOOLS.map((tool) => {
    const args = shapes.get(tool) ?? []
    const rendered = args
      .map((arg) => `${arg.name}${arg.optional ? "?" : ""}: ${arg.type}`)
      .join(", ")
    return `- ${tool}(${rendered}): ${TOOL_DESCRIPTIONS[tool]}`
  })
  return lines.join("\n")
}

/**
 * The stable prefix (constraint 10, §8.2): built once from constants, never from the
 * request, so the tool contract is byte-identical across messages.
 */
const PLANNER_SYSTEM = [
  "You plan retrieval for the Detective Conan Philippines assistant.",
  "Decide what the assistant should look up to answer the user's latest message, and return one JSON object matching the schema.",
  "The tools you may use:",
  toolContract(),
  `Use at most ${MAX_PLAN_STEPS} steps, ${MAX_PLAN_KEYWORDS} keywords and ${MAX_PLAN_NUMBERS} numbers.`,
  "Put the user's own words in keywords: they are the retrieval hints, and a plan with no keywords retrieves nothing.",
  "Prefer one or two precise steps over many broad ones. Never invent a tool name.",
  "Return only the JSON object.",
].join("\n")

/**
 * The two messages one planning round sends. The system message is the constant tool
 * contract; everything request-specific — the last three user turns, capped, and the
 * current message — travels in the user message so the prefix above it never changes.
 *
 * `now` is part of the shape the pipeline shares and is deliberately unread: a prompt
 * that varied with the clock could not be a cache hit.
 */
export function buildPlannerMessages(input: {
  message: string
  priorUserMessages: string[]
  now: () => number
}): ChatMessage[] {
  const turns = input.priorUserMessages.slice(-PLANNER_TURNS).map(capTurn)

  const lines: string[] = []
  if (turns.length > 0) {
    lines.push("Earlier user messages, most recent last:", ...turns.map((turn) => `- ${turn}`), "")
  }
  lines.push("Current user message:", input.message)

  return [
    { role: "system", content: PLANNER_SYSTEM },
    { role: "user", content: lines.join("\n") },
  ]
}

/** One prior turn, shortened to the cap with a marker so the model sees the cut. */
function capTurn(turn: string): string {
  return turn.length > MAX_PLANNER_TURN_CHARS
    ? `${turn.slice(0, MAX_PLANNER_TURN_CHARS)}…`
    : turn
}

export interface PlannedQuery {
  plan: QueryPlan
  /** Which path produced the plan: the router, the model, or the router as a fallback. */
  source: PlanSource
  /** Measured from the injected clock, for the request log's `plan_ms`. */
  ms: number
  /** A short machine-readable failure code, or null when the plan was accepted. */
  error: string | null
}

/**
 * The planner's failure codes. A closed set rather than a free string, so the request
 * log can be counted and a test can name every possibility.
 */
const PLANNER_ERRORS = {
  timeout: "planner_timeout",
  failed: "planner_failed",
  invalid: "planner_invalid",
  noSteps: "planner_no_steps",
  emptySearch: "planner_empty_search",
} as const

/** `v1`-style reading: only the exact word selects a mode, everything else is `auto`. */
export function plannerMode(env: NodeJS.ProcessEnv = process.env): PlannerMode {
  const raw = env.AI_PLANNER?.trim().toLowerCase()
  if (raw === "off") return "off"
  if (raw === "always") return "always"
  return "auto"
}

/**
 * One plan per request. `call` is injected by the pipeline via `toStructuredCall`;
 * `null` means no target advertises JSON-schema support, so there is nothing to ask.
 */
export async function planQuery(input: {
  message: string
  priorUserMessages?: string[]
  call?: StructuredCall | null
  /** True when the provider enforces the schema by constrained decoding. */
  strict?: boolean
  now?: () => number
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
}): Promise<PlannedQuery> {
  const now = input.now ?? Date.now
  const started = now()

  const routed = routeQuery({
    message: input.message,
    priorUserMessages: input.priorUserMessages,
    now,
  })

  const finish = (plan: QueryPlan, source: PlanSource, error: string | null): PlannedQuery => {
    const ms = Math.max(0, now() - started)
    input.log?.(`planner: source=${source} ms=${ms}${error === null ? "" : ` error=${error}`}`)
    return { plan, source, ms, error }
  }

  const call = input.call ?? null
  const mode = plannerMode(input.env)

  // Rule 1: zero calls when they buy nothing. The router's plan is the answer in all
  // three cases, and `source: "router"` says the model was never the author.
  if (mode === "off" || call === null || (mode === "auto" && routed.confident)) {
    return finish(routed.plan, "router", null)
  }

  const messages = buildPlannerMessages({
    message: input.message,
    priorUserMessages: input.priorUserMessages ?? [],
    now,
  })

  // Totalized on purpose: a provider rejection becomes a value, so the only rejection
  // `withTimeout` can produce is its own timeout and the two failure modes stay
  // distinguishable. `withTimeout`'s `finally` clears the timer on every path.
  const attempted = generateStructured({
    schema: QueryPlanSchema,
    messages,
    call,
    strict: input.strict ?? false,
  }).then(
    (result) => ({ ok: true as const, result }),
    () => ({ ok: false as const })
  )

  let settled: Awaited<typeof attempted>
  try {
    settled = await withTimeout(attempted, PLANNER_BUDGET_MS)
  } catch {
    return finish(routed.plan, "fallback", PLANNER_ERRORS.timeout)
  }

  if (!settled.ok) return finish(routed.plan, "fallback", PLANNER_ERRORS.failed)

  // Re-parsed rather than trusted: `generateStructured` validated the fields, and this
  // is where repeated steps collapse (parseQueryPlan's dedupe) so the executor cannot
  // dispatch one tool call twice.
  const plan = parseQueryPlan(settled.result.value)
  if (plan === null) return finish(routed.plan, "fallback", PLANNER_ERRORS.invalid)

  const rejection = rejectionOf(plan)
  if (rejection !== null) return finish(routed.plan, "fallback", rejection)

  return finish(plan, "model", null)
}

/**
 * Why a schema-valid plan can still be unusable. An empty step list gathers nothing,
 * and an all-`search_catalog` plan is only the floor — the executor routes that tool
 * through the ladder, which is scored by the keywords, so with no keywords the plan
 * retrieves noise or nothing. That is the shape a weak model emits when it has not
 * understood the question.
 */
function rejectionOf(plan: QueryPlan): string | null {
  if (plan.steps.length === 0) return PLANNER_ERRORS.noSteps

  const catalogOnly = plan.steps.every((step) => step.name === "search_catalog")
  if (catalogOnly && plan.keywords.length === 0) return PLANNER_ERRORS.emptySearch

  return null
}
