import { describe, expect, it } from "vitest"
import { TOOL_NAMES } from "@/lib/ai/tools"
import {
  MAX_KEYWORD_CHARS,
  MAX_NAME_QUERY_CHARS,
  MAX_PLAN_EPISODE,
  MAX_PLAN_KEYWORDS,
  MAX_PLAN_NUMBERS,
  MAX_PLAN_STEPS,
  MAX_QUERY_CHARS,
  MAX_STEP_LIMIT,
  MAX_TOPIC_CHARS,
  PLAN_TOOLS,
  PlanStepSchema,
  QueryPlanSchema,
  buildPlanWireSchema,
  parseQueryPlan,
  planToolNames,
  type PlanToolName,
} from "@/lib/ai/pipeline/plan"

/**
 * The plan is the contract between the model and the code that runs it, so these
 * tests pin the two properties every downstream stage assumes: the schema admits
 * exactly the tool shapes the executor can dispatch, and `parseQueryPlan` either
 * returns a complete, de-duplicated plan or null — never a partial one.
 */

const BASE_STEP = { name: "search_catalog", query: "episode 500" }

/** A plan that satisfies every field, so a test can change exactly one thing. */
function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: "lookup",
    steps: [BASE_STEP],
    keywords: ["episode 500"],
    numbers: [500],
    needsLore: false,
    preferRecent: false,
    preferEarliest: false,
    ...overrides,
  }
}

/**
 * The arguments each variant cannot omit, and the ones it may add. The Record
 * type is the point: a new PLAN_TOOLS entry fails to compile until this table
 * names its arguments, so a variant cannot be added without the test covering it.
 */
const REQUIRED_ARGS: Record<PlanToolName, Record<string, unknown>> = {
  search_catalog: { query: "episode 500" },
  search_cases: { query: "kishida" },
  lookup_character: { name_query: "Haibara" },
  classify_episode: { episode: 500 },
  arc_for_range: { start: 100 },
  next_unwatched: {},
  wiki_lookup: { topic: "Conan Edogawa" },
  search_conversations: { query: "movie night" },
}

const OPTIONAL_ARGS: Record<PlanToolName, Record<string, unknown>> = {
  search_catalog: { limit: 3 },
  search_cases: { limit: 3 },
  lookup_character: {},
  classify_episode: {},
  arc_for_range: { end: 120 },
  next_unwatched: { limit: 3 },
  wiki_lookup: {},
  search_conversations: { limit: 3 },
}

interface WireVariant {
  properties: Record<string, { const?: string; maxLength?: number }>
  required: string[]
}

describe("PlanStepSchema", () => {
  it("has one variant per plan tool, in the declared order", () => {
    const variantNames = PlanStepSchema.options.map((variant) => variant.shape.name.value)
    expect(variantNames).toEqual([...PLAN_TOOLS])
  })

  it("covers every registered tool, and plans nothing the registry cannot dispatch", () => {
    // Both directions: a registry entry without a plan variant would be a tool no
    // plan can ever call, and a plan variant without a registry entry would be a
    // step `runTools` fails at dispatch time.
    for (const name of TOOL_NAMES) expect(PLAN_TOOLS, name).toContain(name)
    for (const name of PLAN_TOOLS) expect([...TOOL_NAMES], name).toContain(name)
  })

  it("parses every variant with and without its optional arguments", () => {
    for (const name of PLAN_TOOLS) {
      const required = { name, ...REQUIRED_ARGS[name] }
      const without = parseQueryPlan(validPlan({ steps: [required] }))
      expect(without?.steps, name).toEqual([required])

      const optional = { name, ...REQUIRED_ARGS[name], ...OPTIONAL_ARGS[name] }
      const withOptional = parseQueryPlan(validPlan({ steps: [optional] }))
      expect(withOptional?.steps, name).toEqual([optional])
    }
  })

  it("rejects an unknown tool name", () => {
    expect(parseQueryPlan(validPlan({ steps: [{ name: "search_web", query: "x" }] }))).toBeNull()
  })

  it("rejects a mistyped argument instead of coercing it", () => {
    expect(
      parseQueryPlan(validPlan({ steps: [{ name: "classify_episode", episode: "500" }] }))
    ).toBeNull()
    expect(parseQueryPlan(validPlan({ steps: [{ name: "search_catalog", query: 500 }] }))).toBeNull()
    expect(
      parseQueryPlan(validPlan({ steps: [{ name: "search_catalog", query: "x", limit: "3" }] }))
    ).toBeNull()
  })

  it("rejects numbers outside their range and non-integer numbers", () => {
    for (const episode of [0, MAX_PLAN_EPISODE + 1, 1.5]) {
      expect(
        parseQueryPlan(validPlan({ steps: [{ name: "classify_episode", episode }] })),
        String(episode)
      ).toBeNull()
    }
    expect(
      parseQueryPlan(
        validPlan({ steps: [{ name: "arc_for_range", start: 1, end: MAX_PLAN_EPISODE + 1 }] })
      )
    ).toBeNull()
    expect(
      parseQueryPlan(validPlan({ steps: [{ name: "next_unwatched", limit: MAX_STEP_LIMIT + 1 }] }))
    ).toBeNull()

    for (const number of [-1, MAX_PLAN_EPISODE + 1, 1.5]) {
      expect(parseQueryPlan(validPlan({ numbers: [number] })), String(number)).toBeNull()
    }
  })

  it("rejects an empty or oversized string, and requires name_query on lookup_character", () => {
    expect(parseQueryPlan(validPlan({ steps: [{ name: "search_catalog", query: "" }] }))).toBeNull()
    expect(
      parseQueryPlan(
        validPlan({ steps: [{ name: "search_catalog", query: "x".repeat(MAX_QUERY_CHARS + 1) }] })
      )
    ).toBeNull()
    expect(parseQueryPlan(validPlan({ steps: [{ name: "wiki_lookup", topic: "" }] }))).toBeNull()
    expect(
      parseQueryPlan(
        validPlan({ steps: [{ name: "wiki_lookup", topic: "x".repeat(MAX_TOPIC_CHARS + 1) }] })
      )
    ).toBeNull()

    // The step object's `name` is the tool name, so the character name lives under
    // `name_query`: a step that carries only the discriminator is rejected rather
    // than mismapped onto the tool's `{ name }` argument.
    expect(PlanStepSchema.safeParse({ name: "lookup_character" }).success).toBe(false)
    expect(PlanStepSchema.safeParse({ name: "lookup_character", name_query: "Haibara" }).success).toBe(true)
    expect(
      parseQueryPlan(
        validPlan({
          steps: [{ name: "lookup_character", name_query: "x".repeat(MAX_NAME_QUERY_CHARS + 1) }],
        })
      )
    ).toBeNull()
  })
})

describe("parseQueryPlan", () => {
  it("round-trips a plan that satisfies the schema", () => {
    const plan = parseQueryPlan(validPlan())
    expect(plan).toEqual(validPlan())
    // The parser is the only entry point, so an already-parsed plan must re-parse
    // to itself rather than drifting through a second normalization.
    expect(parseQueryPlan(plan)).toEqual(plan)
  })

  it("returns null for anything the schema rejects, never a partial plan", () => {
    const rejected: unknown[] = [
      null,
      undefined,
      42,
      "plan",
      [],
      {},
      { steps: [{ name: "search_catalog", query: "x" }] },
    ]
    for (const value of rejected) expect(parseQueryPlan(value), String(value)).toBeNull()
  })

  it("defaults intent and needsLore when the model omits them", () => {
    const plan = parseQueryPlan({
      steps: [],
      keywords: [],
      numbers: [],
      preferRecent: false,
      preferEarliest: false,
    })

    expect(plan?.intent).toBe("lookup")
    expect(plan?.needsLore).toBe(false)
  })

  it("returns null when a required field is missing", () => {
    for (const field of ["steps", "keywords", "numbers", "preferRecent", "preferEarliest"]) {
      const plan = validPlan()
      delete plan[field]
      expect(parseQueryPlan(plan), field).toBeNull()
    }
  })

  it("rejects more steps, keywords or numbers than the exported caps allow", () => {
    expect(MAX_PLAN_STEPS).toBe(4)
    expect(MAX_PLAN_KEYWORDS).toBe(8)
    expect(MAX_PLAN_NUMBERS).toBe(8)

    const steps = Array.from({ length: MAX_PLAN_STEPS }, (_, index) => ({
      name: "search_catalog",
      query: `query ${index}`,
    }))
    expect(parseQueryPlan(validPlan({ steps }))?.steps).toHaveLength(MAX_PLAN_STEPS)
    expect(
      parseQueryPlan(validPlan({ steps: [...steps, { name: "search_catalog", query: "one more" }] }))
    ).toBeNull()

    const keywords = Array.from({ length: MAX_PLAN_KEYWORDS }, (_, index) => `keyword ${index}`)
    expect(parseQueryPlan(validPlan({ keywords }))?.keywords).toHaveLength(MAX_PLAN_KEYWORDS)
    expect(parseQueryPlan(validPlan({ keywords: [...keywords, "one more"] }))).toBeNull()
    expect(parseQueryPlan(validPlan({ keywords: ["x".repeat(MAX_KEYWORD_CHARS + 1)] }))).toBeNull()

    const numbers = Array.from({ length: MAX_PLAN_NUMBERS }, (_, index) => index + 1)
    expect(parseQueryPlan(validPlan({ numbers }))?.numbers).toHaveLength(MAX_PLAN_NUMBERS)
    expect(parseQueryPlan(validPlan({ numbers: [...numbers, 12] }))).toBeNull()
  })

  it("collapses identical steps and keeps distinct calls to the same tool", () => {
    const plan = parseQueryPlan(
      validPlan({
        steps: [
          { name: "search_catalog", query: "haibara" },
          { name: "search_catalog", query: "haibara" },
          { name: "lookup_character", name_query: "haibara" },
          { name: "lookup_character", name_query: "conan" },
        ],
      })
    )

    expect(plan?.steps).toEqual([
      { name: "search_catalog", query: "haibara" },
      { name: "lookup_character", name_query: "haibara" },
      { name: "lookup_character", name_query: "conan" },
    ])

    // Same tool, different argument bag: not a duplicate, so both calls survive
    // (the second asks for three items, the first takes the tool's default).
    const preferences = parseQueryPlan(
      validPlan({ steps: [{ name: "next_unwatched" }, { name: "next_unwatched", limit: 3 }] })
    )
    expect(preferences?.steps).toHaveLength(2)
  })

  it("never throws, whatever it is handed", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      Symbol("plan"),
      () => "plan",
      new Date(),
      new Map(),
      [{ step: { name: {} } }],
      JSON.parse('{"steps":[[[]]]}'),
      { steps: new Array(MAX_PLAN_STEPS + 1).fill(BASE_STEP) },
    ]

    for (const value of hostile) {
      expect(() => parseQueryPlan(value), String(value)).not.toThrow()
      expect(parseQueryPlan(value), String(value)).toBeNull()
    }
  })
})

describe("planToolNames", () => {
  it("lists the distinct tools a plan names, in first-mention order", () => {
    const plan = parseQueryPlan(
      validPlan({
        steps: [
          { name: "lookup_character", name_query: "haibara" },
          { name: "search_catalog", query: "haibara" },
          { name: "lookup_character", name_query: "conan" },
        ],
      })
    )
    if (plan === null) throw new Error("expected the fixture to parse")

    expect(planToolNames(plan)).toEqual(["lookup_character", "search_catalog"])
  })
})

describe("buildPlanWireSchema", () => {
  it("carries the required list of the Zod schema's non-optional fields", () => {
    const wire = buildPlanWireSchema()
    const required = [...(wire.required as string[])].sort()

    // A field is required on the wire when the plan cannot go without it: omitting
    // it either fails the parse or comes back filled in by a default. Only a field
    // declared `.optional()` drops off the list.
    const expected = Object.keys(QueryPlanSchema.shape)
      .filter((key) => {
        const without = validPlan()
        delete without[key]
        const parsed = parseQueryPlan(without)
        return parsed === null || key in parsed
      })
      .sort()

    expect(required).toEqual(expected)
    expect(Object.keys(wire.properties as Record<string, unknown>).sort()).toEqual(expected)
  })

  it("is generated from the Zod source: variants, enum and caps all come from it", () => {
    const properties = buildPlanWireSchema().properties as {
      intent: { enum: string[] }
      steps: { maxItems: number; items: { oneOf: WireVariant[] } }
      keywords: { maxItems: number; items: { maxLength: number } }
      numbers: { maxItems: number }
    }

    // A hand-rolled schema would have to reproduce the union and the enum exactly;
    // these assertions read them out of the generated document.
    expect(properties.steps.items.oneOf.map((variant) => variant.properties.name.const)).toEqual([
      ...PLAN_TOOLS,
    ])
    expect(properties.intent.enum).toEqual([
      "lookup",
      "list",
      "compare",
      "chitchat",
      "out_of_scope",
    ])
    expect(properties.steps.maxItems).toBe(MAX_PLAN_STEPS)
    expect(properties.keywords.maxItems).toBe(MAX_PLAN_KEYWORDS)
    expect(properties.keywords.items.maxLength).toBe(MAX_KEYWORD_CHARS)
    expect(properties.numbers.maxItems).toBe(MAX_PLAN_NUMBERS)

    const variants = properties.steps.items.oneOf
    const searchCatalog = variants.find(
      (variant) => variant.properties.name.const === "search_catalog"
    )
    expect(searchCatalog?.required).toEqual(["name", "query"])
    expect(searchCatalog?.properties.query.maxLength).toBe(MAX_QUERY_CHARS)

    const lookup = variants.find((variant) => variant.properties.name.const === "lookup_character")
    expect(lookup?.required).toEqual(["name", "name_query"])
    expect(lookup?.properties.name_query.maxLength).toBe(MAX_NAME_QUERY_CHARS)
  })
})
