import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { StructuredCall, StructuredRequest, StructuredResponse } from "@/lib/ai/structured"
import {
  PLAN_TOOLS,
  PlanStepSchema,
  parseQueryPlan,
  type QueryPlan,
} from "@/lib/ai/pipeline/plan"
import { routeQuery } from "@/lib/ai/pipeline/router"
import {
  MAX_PLANNER_TURN_CHARS,
  PLANNER_BUDGET_MS,
  PLANNER_MODES,
  buildPlannerMessages,
  plannerMode,
  planQuery,
} from "@/lib/ai/pipeline/planner"

/**
 * The planner is one bounded structured call in front of the router (D1), so
 * these tests pin the four properties the pipeline depends on:
 *
 * 1. The call is spent only when it buys something. Three cases must make zero
 *    calls — that is the whole point of `auto` on a free tier.
 * 2. Every failure mode — a rejecting call, a non-JSON reply, a plan that
 *    gathers nothing, a budget expiry — degrades to the router's plan and
 *    never throws. The caller is on the answer path; a throw is a 500 on a
 *    question the ladder could have answered.
 * 3. The prompt's system message is a constant, so a caching provider can hit
 *    it across requests.
 * 4. `ms` comes from the injected clock, so the route's `plan_ms` is testable.
 */

/** Confident at the router: an unambiguous curated name (`why: "exact-entity"`). */
const CONFIDENT = "Who is Ai Haibara?"
/** Unsure at the router: lore-shaped (`why: "lore"`), which is what `auto` spends a call on. */
const UNSURE = "What happened in the Vermouth arc?"

/** Deliberately different from the router's plan, so "the model's plan was used" is visible. */
const MODEL_PLAN: QueryPlan = {
  intent: "lookup",
  steps: [
    { name: "lookup_character", name_query: "Ai Haibara" },
    { name: "wiki_lookup", topic: "Ai Haibara" },
  ],
  keywords: ["haibara", "miyano"],
  numbers: [],
  needsLore: true,
  preferRecent: false,
  preferEarliest: true,
}

/**
 * Next's global types augment `ProcessEnv` with a required `NODE_ENV`, so a
 * hand-built environment carries one; everything else mirrors production.
 */
function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values }
}

const ENV_AUTO = env()
const ENV_ALWAYS = env({ AI_PLANNER: "always" })
const ENV_OFF = env({ AI_PLANNER: "off" })

interface Scripted {
  call: StructuredCall
  requests: StructuredRequest[]
  /** How many provider calls were actually made. */
  calls: () => number
}

/** Replies in order; the last one repeats, so a test lists only what changes. */
function scripted(responses: { text: string; finishReason?: string | null }[]): Scripted {
  const requests: StructuredRequest[] = []
  const call: StructuredCall = async (request) => {
    requests.push(request)
    const response = responses[Math.min(requests.length - 1, responses.length - 1)]
    return { text: response.text, finishReason: response.finishReason ?? null }
  }
  return { call, requests, calls: () => requests.length }
}

/** A call that never settles: only the budget can end this one. */
function hanging(): Scripted {
  const requests: StructuredRequest[] = []
  const call: StructuredCall = (request) => {
    requests.push(request)
    return new Promise<StructuredResponse>(() => {})
  }
  return { call, requests, calls: () => requests.length }
}

/** A call that rejects, the way a provider failure reaches the planner. */
function throwing(): Scripted {
  const requests: StructuredRequest[] = []
  const call: StructuredCall = async (request) => {
    requests.push(request)
    throw new Error("provider exploded")
  }
  return { call, requests, calls: () => requests.length }
}

function reply(plan: unknown = MODEL_PLAN): { text: string } {
  return { text: JSON.stringify(plan) }
}

/** Scripted clock values, the last one repeating. */
function clock(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

afterEach(() => {
  vi.useRealTimers()
})

describe("plannerMode", () => {
  it("defaults to auto and accepts only the three known modes", () => {
    expect(PLANNER_MODES).toEqual(["auto", "always", "off"])
    expect(plannerMode(env())).toBe("auto")
    expect(plannerMode(env({ AI_PLANNER: "" }))).toBe("auto")
    expect(plannerMode(env({ AI_PLANNER: "sometimes" }))).toBe("auto")
    expect(plannerMode(env({ AI_PLANNER: "off" }))).toBe("off")
    expect(plannerMode(env({ AI_PLANNER: " ALWAYS " }))).toBe("always")
  })
})

describe("planQuery: zero calls when they buy nothing", () => {
  it("makes no call at AI_PLANNER=off and returns the router's plan", async () => {
    const fake = scripted([reply()])
    const result = await planQuery({
      message: UNSURE,
      call: fake.call,
      env: ENV_OFF,
      now: clock([1000, 1042]),
    })

    expect(fake.calls()).toBe(0)
    expect(result.source).toBe("router")
    expect(result.plan).toEqual(routeQuery({ message: UNSURE }).plan)
    expect(result.error).toBeNull()
    expect(result.ms).toBe(42)
    expect(parseQueryPlan(result.plan)).toEqual(result.plan)
  })

  it("makes no call when no target advertises JSON-schema support", async () => {
    const fake = scripted([reply()])
    const result = await planQuery({ message: UNSURE, call: null, env: ENV_AUTO })

    expect(fake.calls()).toBe(0)
    expect(result.source).toBe("router")
    expect(result.plan).toEqual(routeQuery({ message: UNSURE }).plan)
    expect(result.error).toBeNull()
  })

  it("makes no call in auto when the router is already confident", async () => {
    const fake = scripted([reply()])
    const result = await planQuery({ message: CONFIDENT, call: fake.call, env: ENV_AUTO })

    expect(routeQuery({ message: CONFIDENT }).confident).toBe(true)
    expect(fake.calls()).toBe(0)
    expect(result.source).toBe("router")
    expect(result.plan).toEqual(routeQuery({ message: CONFIDENT }).plan)
    expect(result.error).toBeNull()
  })
})

describe("planQuery: the model's plan", () => {
  it("uses the model's plan in auto when the router was unsure", async () => {
    const fake = scripted([reply()])
    const result = await planQuery({
      message: UNSURE,
      call: fake.call,
      env: ENV_AUTO,
      now: clock([0, 5]),
    })

    expect(routeQuery({ message: UNSURE }).confident).toBe(false)
    expect(fake.calls()).toBe(1)
    expect(result.source).toBe("model")
    expect(result.plan).toEqual(MODEL_PLAN)
    expect(result.plan).not.toEqual(routeQuery({ message: UNSURE }).plan)
    expect(result.error).toBeNull()
    expect(result.ms).toBe(5)
    expect(parseQueryPlan(result.plan)).toEqual(result.plan)
  })

  it("uses the model's plan at always even when the router was confident", async () => {
    const fake = scripted([reply()])
    const result = await planQuery({ message: CONFIDENT, call: fake.call, env: ENV_ALWAYS })

    expect(routeQuery({ message: CONFIDENT }).confident).toBe(true)
    expect(fake.calls()).toBe(1)
    expect(result.source).toBe("model")
    expect(result.plan).toEqual(MODEL_PLAN)
  })

  it("forwards strict, the schema and the built messages to the structured call", async () => {
    const strict = scripted([reply()])
    await planQuery({ message: UNSURE, call: strict.call, strict: true, env: ENV_ALWAYS })

    expect(strict.requests[0].schema).not.toBeNull()
    expect(strict.requests[0].mode).toBe("strict")
    expect(strict.requests[0].messages[0]).toEqual(
      buildPlannerMessages({ message: UNSURE, priorUserMessages: [], now: () => 0 })[0]
    )

    const loose = scripted([reply()])
    await planQuery({ message: UNSURE, call: loose.call, strict: false, env: ENV_ALWAYS })

    expect(loose.requests[0].schema).toBeNull()
    expect(loose.requests[0].mode).toBe("json_object")
  })
})

describe("planQuery: every failure degrades to the router's plan", () => {
  it("survives a rejecting call", async () => {
    const fake = throwing()
    const result = await planQuery({ message: UNSURE, call: fake.call, env: ENV_ALWAYS })

    expect(fake.calls()).toBe(1)
    expect(result.source).toBe("fallback")
    expect(result.error).toBe("planner_failed")
    expect(result.plan).toEqual(routeQuery({ message: UNSURE }).plan)
  })

  it("survives a non-JSON reply and 20 kB of prose", async () => {
    const garbage = scripted([{ text: "I am not sure what you mean." }])
    const first = await planQuery({ message: UNSURE, call: garbage.call, env: ENV_ALWAYS })

    expect(first.source).toBe("fallback")
    expect(first.error).toBe("planner_invalid")
    expect(first.plan).toEqual(routeQuery({ message: UNSURE }).plan)
    // The repair ladder is `generateStructured`'s, and it is bounded.
    expect(garbage.calls()).toBeGreaterThanOrEqual(2)
    expect(garbage.calls()).toBeLessThanOrEqual(3)

    const prose = scripted([{ text: "lorem ipsum dolor sit amet ".repeat(800) }])
    const second = await planQuery({ message: UNSURE, call: prose.call, env: ENV_ALWAYS })

    expect(second.source).toBe("fallback")
    expect(second.plan).toEqual(routeQuery({ message: UNSURE }).plan)
    expect(prose.calls()).toBeLessThanOrEqual(3)
  })

  it("rejects a plan that names no tool and one that is only an empty-floor search", async () => {
    const empty = scripted([
      reply({ intent: "lookup", steps: [], keywords: ["haibara"], numbers: [], needsLore: false, preferRecent: false, preferEarliest: false }),
    ])
    const noSteps = await planQuery({ message: UNSURE, call: empty.call, env: ENV_ALWAYS })
    expect(noSteps.source).toBe("fallback")
    expect(noSteps.error).toBe("planner_no_steps")

    // The shape a weak model emits when it has not understood the question: the
    // ladder would retrieve nothing (an all-search_catalog plan is the floor, and
    // the floor is scored by the keywords).
    const floor = scripted([
      reply({
        intent: "lookup",
        steps: [{ name: "search_catalog", query: UNSURE }],
        keywords: [],
        numbers: [],
        needsLore: false,
        preferRecent: false,
        preferEarliest: false,
      }),
    ])
    const catalogOnly = await planQuery({ message: UNSURE, call: floor.call, env: ENV_ALWAYS })
    expect(catalogOnly.source).toBe("fallback")
    expect(catalogOnly.error).toBe("planner_empty_search")
    expect(catalogOnly.plan).toEqual(routeQuery({ message: UNSURE }).plan)
  })

  it("accepts a valid plan whose finish reason is null", async () => {
    const fake = scripted([{ ...reply(), finishReason: null }])
    const result = await planQuery({ message: UNSURE, call: fake.call, env: ENV_ALWAYS })

    expect(result.source).toBe("model")
    expect(result.plan).toEqual(MODEL_PLAN)
    expect(result.error).toBeNull()
  })
})

describe("planQuery: the 1,200 ms budget", () => {
  it("returns the router's plan when the call outlives the budget", async () => {
    vi.useFakeTimers()
    const fake = hanging()
    const pending = planQuery({
      message: UNSURE,
      call: fake.call,
      env: ENV_ALWAYS,
      now: clock([1000, 1500]),
    })

    await vi.advanceTimersByTimeAsync(PLANNER_BUDGET_MS)
    const result = await pending

    expect(result.source).toBe("fallback")
    expect(result.error).toBe("planner_timeout")
    expect(result.ms).toBe(500)
    expect(result.plan).toEqual(routeQuery({ message: UNSURE }).plan)
    expect(parseQueryPlan(result.plan)).toEqual(result.plan)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears the timer on the success and failure paths", async () => {
    vi.useFakeTimers()

    const good = scripted([reply()])
    await planQuery({ message: UNSURE, call: good.call, env: ENV_ALWAYS })
    expect(vi.getTimerCount()).toBe(0)

    const bad = throwing()
    await planQuery({ message: UNSURE, call: bad.call, env: ENV_ALWAYS })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("buildPlannerMessages", () => {
  it("renders the tool contract from plan.ts's schema", () => {
    const messages = buildPlannerMessages({ message: "hi", priorUserMessages: [], now: () => 0 })
    const system = messages[0]

    expect(system.role).toBe("system")

    // Derived from the same schema the validator uses: a step variant added to
    // plan.ts that never reaches the prompt fails this test.
    const wire = z.toJSONSchema(PlanStepSchema, { io: "output" }) as {
      oneOf: { properties: Record<string, { const?: unknown }>; required: string[] }[]
    }
    expect(wire.oneOf).toHaveLength(PLAN_TOOLS.length)

    for (const tool of PLAN_TOOLS) {
      expect(system.content, tool).toContain(`- ${tool}(`)
    }
    for (const variant of wire.oneOf) {
      const tool = String(variant.properties.name?.const)
      expect(PLAN_TOOLS).toContain(tool)
      for (const key of Object.keys(variant.properties)) {
        if (key === "name") continue
        const optional = !variant.required.includes(key)
        expect(system.content, `${tool}.${key}`).toMatch(new RegExp(`${key}\\??:`))
        expect(system.content).toContain(optional ? `${key}?:` : `${key}:`)
      }
    }
  })

  it("carries the last three prior turns, each capped, and the current message", () => {
    const long = "x".repeat(5000)
    const messages = buildPlannerMessages({
      message: "and what about Haibara?",
      priorUserMessages: ["first", "second", long, "fourth", "fifth"],
      now: () => 0,
    })

    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe("user")
    const content = messages[1].content

    expect(content).not.toContain("first")
    expect(content).not.toContain("second")
    expect(content).toContain("fourth")
    expect(content).toContain("fifth")
    expect(content).toContain("and what about Haibara?")

    // The 5 kB turn is truncated to the cap, not echoed whole.
    expect(content).not.toContain(long)
    expect(content).toContain("x".repeat(MAX_PLANNER_TURN_CHARS))
    expect(content.length).toBeLessThan(MAX_PLANNER_TURN_CHARS * 3 + 200)
  })

  it("keeps the system message byte-identical across different requests", () => {
    const first = buildPlannerMessages({
      message: "Who is Ai Haibara?",
      priorUserMessages: ["hello"],
      now: () => 0,
    })
    const second = buildPlannerMessages({
      message: "CANARY what happened in episodes 100-120?",
      priorUserMessages: ["CANARY-TURN"],
      now: () => 999,
    })

    expect(first[0].content).toBe(second[0].content)
    expect(first[0].content).not.toContain("CANARY")
    expect(second[1].content).toContain("CANARY")
  })
})
