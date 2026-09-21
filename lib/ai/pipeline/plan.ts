/**
 * The query plan: the one structured decision the model makes before code does
 * the gathering.
 *
 * The shape is a Zod schema first and a type second, because the same object
 * serves both consumers: `parseQueryPlan` validates what the planner produced,
 * and `buildPlanWireSchema` derives the wire JSON Schema from it through the same
 * conversion `generateStructured` uses. A hand-written schema would be a second
 * description of the plan that nothing keeps in step with the validator.
 *
 * Two properties everything downstream relies on:
 *
 * 1. `parseQueryPlan` never throws and never returns a partial plan. A wrong tool
 *    name, a mistyped argument or an out-of-range number rejects the whole plan
 *    (null), because a half-applied plan would gather the wrong evidence silently.
 * 2. Identical steps collapse, while two *different* calls to the same tool
 *    survive: a comparison legitimately asks for two characters, and a model that
 *    repeats one step must not spend the tool call twice.
 */
import { z } from "zod"

/**
 * The tools a plan may name. Deliberately a superset of the registry's
 * `TOOL_NAMES`: `search_conversations` is planned here before the tool that
 * dispatches it exists (Plan 4, Task 5), so the coverage the tests assert is
 * one-directional — every registered tool has a variant, not the reverse.
 */
export const PLAN_TOOLS = [
  "search_catalog",
  "search_cases",
  "lookup_character",
  "classify_episode",
  "arc_for_range",
  "next_unwatched",
  "wiki_lookup",
  "search_conversations",
] as const

export type PlanToolName = (typeof PLAN_TOOLS)[number]

/** The most steps one plan may run. Each one is a tool call or a ladder lookup. */
export const MAX_PLAN_STEPS = 4

/** The most keywords the ladder is given. They are retrieval hints, not the question. */
export const MAX_PLAN_KEYWORDS = 8

/** The most numbers a plan may carry; the episode and range steps read them. */
export const MAX_PLAN_NUMBERS = 8

/** The longest free-text query a step may carry. */
export const MAX_QUERY_CHARS = 200

/** The longest character name `lookup_character` may carry. */
export const MAX_NAME_QUERY_CHARS = 80

/** The longest wiki topic `wiki_lookup` may carry. */
export const MAX_TOPIC_CHARS = 120

/** The longest keyword the ladder is given. */
export const MAX_KEYWORD_CHARS = 48

/** The most hits one step may ask a tool for. */
export const MAX_STEP_LIMIT = 12

/**
 * The schema bound on an episode number. Looser than the tracker's own
 * MAX_EPISODE on purpose: a question about an episode the tracker does not carry
 * is a valid plan that gathers nothing, not a validation failure.
 */
export const MAX_PLAN_EPISODE = 2000

/**
 * One discriminated variant per tool, so arguments are validated per tool rather
 * than as a bag: a `query` on `classify_episode` is a schema failure, not a key
 * the executor silently ignores.
 *
 * `lookup_character` carries `name_query`, never `name`. The step object already
 * has a `name` field — the tool name — and one field with two meanings is how a
 * wrong argument silently reaches a tool. The executor maps `name_query` onto the
 * tool's `{ name }` argument.
 */
export const PlanStepSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("search_catalog"),
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    limit: z.number().int().min(1).max(MAX_STEP_LIMIT).optional(),
  }),
  z.object({
    name: z.literal("search_cases"),
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    limit: z.number().int().min(1).max(MAX_STEP_LIMIT).optional(),
  }),
  z.object({
    name: z.literal("lookup_character"),
    name_query: z.string().min(1).max(MAX_NAME_QUERY_CHARS),
  }),
  z.object({
    name: z.literal("classify_episode"),
    episode: z.number().int().min(1).max(MAX_PLAN_EPISODE),
  }),
  z.object({
    name: z.literal("arc_for_range"),
    start: z.number().int().min(1).max(MAX_PLAN_EPISODE),
    end: z.number().int().min(1).max(MAX_PLAN_EPISODE).optional(),
  }),
  z.object({
    name: z.literal("next_unwatched"),
    limit: z.number().int().min(1).max(MAX_STEP_LIMIT).optional(),
  }),
  z.object({
    name: z.literal("wiki_lookup"),
    topic: z.string().min(1).max(MAX_TOPIC_CHARS),
  }),
  z.object({
    name: z.literal("search_conversations"),
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    limit: z.number().int().min(1).max(MAX_STEP_LIMIT).optional(),
  }),
])

export type PlanStep = z.infer<typeof PlanStepSchema>

/**
 * A plan as the rest of the pipeline consumes it. `intent` and `needsLore` are
 * the only fields with defaults: a weak model that omits them still produced a
 * plan code can run, while every other field is required because a plan that does
 * not say what to search for cannot be executed at all.
 */
export const QueryPlanSchema = z.object({
  intent: z
    .enum(["lookup", "list", "compare", "chitchat", "out_of_scope"])
    .default("lookup"),
  steps: z.array(PlanStepSchema).max(MAX_PLAN_STEPS),
  keywords: z.array(z.string().min(1).max(MAX_KEYWORD_CHARS)).max(MAX_PLAN_KEYWORDS),
  numbers: z.array(z.number().int().min(0).max(MAX_PLAN_EPISODE)).max(MAX_PLAN_NUMBERS),
  needsLore: z.boolean().default(false),
  preferRecent: z.boolean(),
  preferEarliest: z.boolean(),
})

export type QueryPlan = z.infer<typeof QueryPlanSchema>

/**
 * Validates and normalizes one model-produced plan.
 *
 * Returns null for anything that does not satisfy the schema — no throw, no
 * partial plan — and collapses repeated steps so the executor never dispatches
 * the same tool call twice.
 */
export function parseQueryPlan(value: unknown): QueryPlan | null {
  const result = QueryPlanSchema.safeParse(value)
  if (!result.success) return null

  return { ...result.data, steps: dedupeSteps(result.data.steps) }
}

/** The distinct tools a plan names, in first-mention order. */
export function planToolNames(plan: QueryPlan): PlanToolName[] {
  const names: PlanToolName[] = []
  for (const step of plan.steps) {
    if (!names.includes(step.name)) names.push(step.name)
  }
  return names
}

/**
 * The JSON Schema a provider with constrained decoding enforces. Same call and
 * same `io: "output"` view as `generateStructured`, so the wire schema and the
 * parser can never describe two different shapes.
 */
export function buildPlanWireSchema(): Record<string, unknown> {
  return z.toJSONSchema(QueryPlanSchema, { io: "output" }) as Record<string, unknown>
}

/** First occurrence wins: two equal calls are one call, and step order is kept. */
function dedupeSteps(steps: PlanStep[]): PlanStep[] {
  const seen = new Set<string>()
  const kept: PlanStep[] = []

  for (const step of steps) {
    const identity = stepIdentity(step)
    if (seen.has(identity)) continue
    seen.add(identity)
    kept.push(step)
  }

  return kept
}

/** Sorted-key JSON, so two equal argument bags cannot differ by key order. */
function stepIdentity(step: PlanStep): string {
  const entries = Object.entries(step).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  return JSON.stringify(entries)
}
