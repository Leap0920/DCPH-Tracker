import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import {
  DEFAULT_LADDER_LIMIT,
  ENTITY_CANDIDATES,
  FUZZY_CANDIDATES,
  LADDER_CANDIDATES,
  runLadder,
  type WikiEvidence,
} from "@/lib/ai/retrieval/ladder"
import type { DocumentSource, SearchHit } from "@/lib/ai/retrieval/source"
import { createStaticSource } from "@/lib/ai/retrieval/source"
import type { RetrievalDeps } from "@/lib/ai/pipeline/source-resolver"
import type { PlanStep, QueryPlan } from "@/lib/ai/pipeline/plan"
import { runTools, type ToolContext } from "@/lib/ai/tools"
import { EXECUTE_BUDGET_MS, executePlan, mergeEvidence } from "@/lib/ai/pipeline/execute"

/**
 * The executor is where the phase's latency budget is won or lost and where the
 * evidence the assembly numbers is decided, so these tests pin four things:
 *
 * 1. The ladder and the tools overlap. Deferred promises hold each gather open,
 *    and the assertions say which one started before the other resolved — a
 *    sequential executor fails them instead of merely running slower.
 * 2. Three of the plan's eight steps are never dispatched: the ladder's rounds
 *    are those tools over the whole corpus, and a drop must be recorded, not
 *    silently ignored.
 * 3. The merge keeps the ladder's ranking. `[E3]` has to mean the same
 *    document on a retry, so the order the merge hands the assembler is
 *    deterministic, and origins are unioned, never lost.
 * 4. The stage is bounded and cannot throw: a budget expiry, a broken ladder, a
 *    throwing `runTools` and a source that rejects all return a report.
 *
 * Both module functions the executor calls are wrapped rather than replaced, so
 * every test exercises the real implementation unless it scripts a rejection.
 */
vi.mock("@/lib/ai/retrieval/ladder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/retrieval/ladder")>()
  return { ...actual, runLadder: vi.fn(actual.runLadder) }
})

vi.mock("@/lib/ai/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tools")>()
  return { ...actual, runTools: vi.fn(actual.runTools) }
})

const ladderSpy = vi.mocked(runLadder)
const toolsSpy = vi.mocked(runTools)

beforeEach(() => {
  ladderSpy.mockClear()
  toolsSpy.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const GUIDE_DOC: CorpusDocument = {
  id: "guide:canon",
  source: "canon",
  title: "Canon, filler and anime-original episodes",
  body: "Tracked range: episodes 1-1000.",
  url: "/tracker",
  metadata: { kind: "canon_guide" },
}

const HAIBARA_DOC: CorpusDocument = {
  id: "character:ai-haibara",
  source: "characters",
  title: "Ai Haibara",
  body: "A former Black Organization chemist who also answers to Sherry.",
  url: "/characters/ai-haibara",
  metadata: {},
  aliases: ["sherry", "shiho"],
}

/** One entry document, enough for the scorer to rank on title and air date. */
function entryDoc(index: number, title: string, airDate = "2000-01-01"): CorpusDocument {
  return {
    id: `entry:ep-${index}`,
    source: "content_entries",
    title,
    body: "",
    url: null,
    metadata: { air_date: airDate },
    episodeNumber: index,
  }
}

/** Hits in the order the branch claims them; the ladder never reads `score`. */
function hits(ids: string[]): SearchHit[] {
  return ids.map((id, index) => ({ id, score: ids.length - index }))
}

function plan(steps: PlanStep[], overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    intent: "lookup",
    steps,
    keywords: [],
    numbers: [],
    needsLore: false,
    preferRecent: false,
    preferEarliest: false,
    ...overrides,
  }
}

function deps(overrides: Partial<RetrievalDeps> = {}): RetrievalDeps {
  return {
    source: createStaticSource([]),
    wiki: async () => [],
    mode: "static",
    degraded: "corpus_static",
    ...overrides,
  }
}

/** A tool context with the corpus the dispatched tools hydrate from. */
function toolCtx(source: DocumentSource = createStaticSource([GUIDE_DOC, HAIBARA_DOC])): ToolContext {
  return {
    source,
    wiki: {
      async lookup() {
        return []
      },
      async put() {},
    },
  }
}

interface ScriptedLadder {
  source: DocumentSource
  entityInputs: Array<{ numbers: number[]; names: string[]; limit: number }>
  fullTextInputs: Array<{ query: string; limit: number }>
  fuzzyInputs: Array<{ query: string; keywords: string[]; limit: number }>
  fetchCalls: string[][]
}

/**
 * The ladder's source, scripted and recording. `beforeEntity` runs inside R1,
 * which is how a test parks the whole ladder while the tools keep working.
 */
function ladderSource(
  spec: {
    entity?: SearchHit[]
    fullText?: SearchHit[]
    fuzzy?: SearchHit[]
    /** Only these ids hydrate; anything else is a deliberate miss. */
    docs?: CorpusDocument[]
    beforeEntity?: () => Promise<void>
  } = {}
): ScriptedLadder {
  const entityInputs: ScriptedLadder["entityInputs"] = []
  const fullTextInputs: ScriptedLadder["fullTextInputs"] = []
  const fuzzyInputs: ScriptedLadder["fuzzyInputs"] = []
  const fetchCalls: string[][] = []
  const byId = new Map((spec.docs ?? []).map((doc) => [doc.id, doc]))

  return {
    entityInputs,
    fullTextInputs,
    fuzzyInputs,
    fetchCalls,
    source: {
      async entity(input) {
        entityInputs.push(input)
        await spec.beforeEntity?.()
        return spec.entity ?? []
      },
      async fullText(query, limit) {
        fullTextInputs.push({ query, limit })
        return spec.fullText ?? []
      },
      async fuzzy(query, keywords, limit) {
        fuzzyInputs.push({ query, keywords, limit })
        return spec.fuzzy ?? []
      },
      async fetch(ids) {
        fetchCalls.push([...ids])
        return ids.flatMap((id) => {
          const doc = byId.get(id)
          return doc ? [doc] : []
        })
      },
    },
  }
}

/** A promise the test resolves by hand: how a gather is held open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/**
 * `promise`, or null once `ms` passes. The timer is always cleared, and the
 * bound is what turns a sequential executor into a failed assertion instead of
 * a suite that hangs until vitest's test timeout.
 */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })

  try {
    return await Promise.race([promise, expiry])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe("executePlan: one round trip", () => {
  it("starts the ladder and the tools before either has resolved", async () => {
    const events: string[] = []
    const ladderStarted = deferred()
    const toolStarted = deferred()
    const toolFinished = deferred()
    const releaseLadder = deferred()
    const releaseTool = deferred()

    const fake = ladderSource({
      beforeEntity: async () => {
        events.push("ladder:start")
        ladderStarted.resolve()
        await releaseLadder.promise
        events.push("ladder:released")
      },
    })

    const base = createStaticSource([GUIDE_DOC, HAIBARA_DOC])
    const ctx = toolCtx({
      ...base,
      async fetch(ids) {
        events.push("tool:start")
        toolStarted.resolve()
        await releaseTool.promise
        events.push("tool:done")
        toolFinished.resolve()
        return base.fetch(ids)
      },
    })

    const pending = executePlan({
      plan: plan([{ name: "classify_episode", episode: 500 }]),
      query: "is episode 500 filler",
      deps: deps({ source: fake.source }),
      toolCtx: ctx,
    })

    // Both gathers were entered while neither had resolved. A sequential
    // executor records one start and then blocks on its gate, so it fails here
    // rather than passing by being slow.
    const bothStarted = await within(
      Promise.all([ladderStarted.promise, toolStarted.promise]),
      250
    )
    expect(bothStarted).not.toBeNull()
    expect([...events].sort()).toEqual(["ladder:start", "tool:start"])

    // Releasing the tool alone must let it finish while the ladder is still
    // parked: that is the other half of "concurrent", and a "dispatch, then
    // await the ladder" executor cannot produce it.
    releaseTool.resolve()
    await toolFinished.promise
    expect(events).toContain("tool:done")
    expect(events).not.toContain("ladder:released")

    releaseLadder.resolve()
    const report = await pending

    expect(events.indexOf("tool:done")).toBeLessThan(events.indexOf("ladder:released"))
    expect(report.results[0].ok).toBe(true)
    expect(report.docs.map((entry) => entry.doc.id)).toContain(GUIDE_DOC.id)
  })
})

describe("executePlan: the ladder subsumes three steps", () => {
  it("records the dropped steps and dispatches only the deterministic ones", async () => {
    const fake = ladderSource()

    const report = await executePlan({
      plan: plan([
        { name: "search_catalog", query: "black organization" },
        { name: "search_cases", query: "kishida" },
        { name: "wiki_lookup", topic: "Conan Edogawa" },
        { name: "classify_episode", episode: 500 },
      ]),
      query: "is episode 500 filler",
      deps: deps({ source: fake.source }),
      toolCtx: toolCtx(),
    })

    expect(report.dropped).toEqual([
      { name: "search_catalog", why: "ladder" },
      { name: "search_cases", why: "ladder" },
      { name: "wiki_lookup", why: "ladder" },
    ])
    expect(report.results.map((result) => result.name)).toEqual(["classify_episode"])
    expect(toolsSpy.mock.calls[0][0]).toEqual([
      { name: "classify_episode", args: { episode: 500 } },
    ])
    // The ladder is what retrieves for a dropped step, so it always runs.
    expect(fake.entityInputs).toHaveLength(1)
  })

  it("maps lookup_character's name_query onto the name its handler reads", async () => {
    const report = await executePlan({
      plan: plan([{ name: "lookup_character", name_query: "ai-haibara" }]),
      query: "who is ai haibara",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(toolsSpy.mock.calls[0][0]).toEqual([
      { name: "lookup_character", args: { name: "ai-haibara" } },
    ])
    // The handler reads `name`; had `name_query` been forwarded, the argument
    // would be missing and the result would be `ok: false`.
    expect(report.results[0].ok).toBe(true)
    expect(report.results[0].docs.map((doc) => doc.id)).toContain(HAIBARA_DOC.id)
  })

  it("dispatches the remaining tools with the argument bags their handlers read", async () => {
    await executePlan({
      plan: plan([
        { name: "arc_for_range", start: 100, end: 120 },
        { name: "next_unwatched", limit: 3 },
        { name: "search_conversations", query: "episode 500", limit: 2 },
      ]),
      query: "what happened in episodes 100-120",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(toolsSpy.mock.calls[0][0]).toEqual([
      { name: "arc_for_range", args: { start: 100, end: 120 } },
      { name: "next_unwatched", args: { limit: 3 } },
      { name: "search_conversations", args: { query: "episode 500", limit: 2 } },
    ])
  })

  it("omits the optional arguments a plan did not set", async () => {
    await executePlan({
      plan: plan([
        { name: "arc_for_range", start: 100 },
        { name: "next_unwatched" },
        { name: "search_conversations", query: "episode 500" },
      ]),
      query: "what happened in episodes 100-120",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(toolsSpy.mock.calls[0][0]).toEqual([
      { name: "arc_for_range", args: { start: 100 } },
      { name: "next_unwatched", args: {} },
      { name: "search_conversations", args: { query: "episode 500" } },
    ])
  })
})

describe("executePlan: the ladder's parameters", () => {
  it("passes the plan's query, keywords, numbers and lore flag through", async () => {
    const docs = [entryDoc(1, "Mountain Lodge Case 1"), entryDoc(2, "Mountain Lodge Case 2")]
    const fake = ladderSource({
      entity: hits([docs[0].id]),
      fullText: hits([docs[1].id]),
      fuzzy: hits([docs[0].id]),
      docs,
    })

    const report = await executePlan({
      plan: plan([{ name: "classify_episode", episode: 129 }], {
        keywords: ["mountain", "lodge"],
        numbers: [129],
      }),
      query: "mountain lodge cases",
      deps: deps({ source: fake.source }),
      toolCtx: toolCtx(),
    })

    // R1's names are the normalized query plus the plan's keywords, and the
    // numbers are the plan's — a plan number the query does not contain proves
    // they were not re-derived here.
    expect(fake.entityInputs[0]).toEqual({
      numbers: [129],
      names: ["mountain lodge cases", "mountain", "lodge"],
      limit: ENTITY_CANDIDATES,
    })
    expect(fake.fullTextInputs[0]).toEqual({
      query: "mountain lodge cases",
      limit: LADDER_CANDIDATES,
    })
    expect(fake.fuzzyInputs[0]).toEqual({
      query: "mountain lodge cases",
      keywords: ["mountain", "lodge"],
      limit: FUZZY_CANDIDATES,
    })
    expect(report.steps.map((step) => step.round)).toEqual([1, 2, 3, 4])
  })

  it("reuses the ladder's 12-document cap and dispatches nothing for an empty plan", async () => {
    const docs = Array.from({ length: 20 }, (_, index) =>
      entryDoc(index + 1, `Mountain Lodge Case ${index + 1}`)
    )
    const fake = ladderSource({ fullText: hits(docs.map((doc) => doc.id)), docs })

    const report = await executePlan({
      plan: plan([]),
      query: "mountain lodge",
      deps: deps({ source: fake.source }),
      toolCtx: toolCtx(),
    })

    expect(report.docs).toHaveLength(DEFAULT_LADDER_LIMIT)
    expect(report.dropped).toEqual([])
    expect(report.results).toEqual([])
    expect(report.degraded).toBeNull()
  })

  it("hands the plan's chronological flags and no re-derived limit to the ladder", async () => {
    const fake = ladderSource()

    await executePlan({
      plan: plan([], {
        keywords: ["mountain", "lodge"],
        preferEarliest: false,
        preferRecent: true,
      }),
      query: "mountain lodge case",
      deps: deps({ source: fake.source }),
      toolCtx: toolCtx(),
    })

    // Asserted at the module boundary on purpose: the scorer owns the ladder's
    // order and the merge keeps it, so the flags' *effect* is the ladder's test
    // to pin (retrieval-ladder.test.ts) and their *forwarding* is this one's.
    expect(ladderSpy.mock.calls[0][0]).toMatchObject({
      query: "mountain lodge case",
      keywords: ["mountain", "lodge"],
      preferRecent: true,
      preferEarliest: false,
      limit: DEFAULT_LADDER_LIMIT,
    })
  })

  it("returns the ladder's wiki extracts, asked for with the request's query", async () => {
    const extracts: WikiEvidence[] = [
      {
        title: "Ai Haibara",
        url: "https://example.test/haibara",
        extract: "A former Black Organization chemist who took the APTX 4869.",
        source: "dcw",
      },
    ]
    const wiki = vi.fn(async () => extracts)

    const report = await executePlan({
      plan: plan([], { needsLore: true }),
      query: "who is ai haibara",
      deps: deps({ source: ladderSource().source, wiki }),
      toolCtx: toolCtx(),
    })

    expect(wiki).toHaveBeenCalledWith("who is ai haibara")
    expect(report.wiki).toEqual(extracts)
    expect(report.steps[3]).toMatchObject({ round: 4, hits: 1, skipped: null })
  })

  it("measures the stage with the injected clock", async () => {
    const clock = { at: 1000, now: () => clock.at }
    const pending = executePlan({
      plan: plan([]),
      query: "mountain lodge",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
      now: clock.now,
    })

    clock.at = 1042
    const report = await pending

    expect(report.ms).toBe(42)
  })
})

describe("mergeEvidence", () => {
  function scored(doc: CorpusDocument, rrf: number, score: number, origins: string[]): ScoredDoc {
    return { doc, score, rrf, origins }
  }

  it("keeps the ladder's score and rrf and unions the origins when both found it", () => {
    const doc = entryDoc(1, "Mountain Lodge Case")
    const merged = mergeEvidence({
      ladderDocs: [scored(doc, 0.03, 12, ["entity"])],
      toolDocs: [doc],
    })

    expect(merged).toHaveLength(1)
    expect(merged[0].score).toBe(12)
    expect(merged[0].rrf).toBe(0.03)
    expect(merged[0].origins).toEqual(["entity", "tool"])
  })

  it("keeps a tool-only document as a precise, unranked hit", () => {
    const merged = mergeEvidence({ ladderDocs: [], toolDocs: [HAIBARA_DOC] })

    expect(merged).toEqual([{ doc: HAIBARA_DOC, score: 0, rrf: 0, origins: ["tool"] }])
  })

  it("keeps the ladder's ranked order verbatim, even when a later hit has a higher rrf", () => {
    const first = entryDoc(1, "A")
    const second = entryDoc(2, "B")
    const third = entryDoc(3, "C")

    const merged = mergeEvidence({
      ladderDocs: [
        scored(first, 0.01, 99, ["fts"]),
        scored(second, 0.04, 1, ["entity"]),
        scored(third, 0.02, 5, ["fts"]),
      ],
      toolDocs: [],
    })

    // The ladder's order is `rankCandidates`' verdict — fused first, scored
    // second — so a later document's higher rrf or score must not promote it:
    // re-sorting by rrf is what cost the golden eval 10 of its 60 cases.
    expect(merged.map((entry) => entry.doc.id)).toEqual([first.id, second.id, third.id])
  })

  it("appends the tool-only hits after the ladder's, in toolDocs order", () => {
    const ranked = entryDoc(1, "Ranked")
    const toolA = entryDoc(2, "Tool A")
    const toolB = entryDoc(3, "Tool B")

    const merged = mergeEvidence({
      ladderDocs: [scored(ranked, 0.02, 9, ["fts"])],
      // `ranked` was already there, so the tool hit only joins its origins and
      // keeps the ladder's position; the two tool-only hits follow in the order
      // their own array gives them.
      toolDocs: [toolA, ranked, toolB],
    })

    expect(merged.map((entry) => entry.doc.id)).toEqual([ranked.id, toolA.id, toolB.id])
    expect(merged[0].origins).toEqual(["fts", "tool"])
    expect(merged[1]).toEqual({ doc: toolA, score: 0, rrf: 0, origins: ["tool"] })
    expect(merged[2]).toEqual({ doc: toolB, score: 0, rrf: 0, origins: ["tool"] })
  })

  it("returns an empty merge when both gathers are empty", () => {
    expect(mergeEvidence({ toolDocs: [], ladderDocs: [] })).toEqual([])
  })

  it("is deterministic, keeps each input's order and does not mutate its entries", () => {
    const docA = entryDoc(1, "A")
    const docB = entryDoc(2, "B")
    const entryA = scored(docA, 0.02, 3, ["fts"])
    const entryB = scored(docB, 0.01, 9, ["entity", "fts"])

    const one = mergeEvidence({ ladderDocs: [entryA, entryB], toolDocs: [HAIBARA_DOC, docA] })
    const two = mergeEvidence({ ladderDocs: [entryA, entryB], toolDocs: [HAIBARA_DOC, docA] })

    // `[E3]` has to mean the same document on a retry: the same inputs must
    // compare deep-equal, origins included.
    expect(two).toEqual(one)
    expect(one[0].origins).toEqual(["fts", "tool"])
    expect(one[1].origins).toEqual(["entity", "fts"])
    expect(entryA.origins).toEqual(["fts"])
    expect(entryB.origins).toEqual(["entity", "fts"])

    // The ladder's order is the ranking, so a permuted ladder list is a
    // different ranking; permuting `toolDocs` only permutes the appended tail,
    // which is the one order-independence left to claim.
    const swapped = mergeEvidence({ ladderDocs: [entryB, entryA], toolDocs: [docA, HAIBARA_DOC] })
    expect(swapped.map((entry) => entry.doc.id)).toEqual([docB.id, docA.id, HAIBARA_DOC.id])
  })
})

describe("executePlan: the 2,000 ms budget", () => {
  it("returns the work that arrived when the budget expires", async () => {
    vi.useFakeTimers()
    const parked = deferred()
    const fake = ladderSource({ beforeEntity: () => parked.promise })

    const pending = executePlan({
      plan: plan([{ name: "classify_episode", episode: 500 }]),
      query: "is episode 500 filler",
      deps: deps({ source: fake.source }),
      toolCtx: toolCtx(),
    })

    await vi.advanceTimersByTimeAsync(EXECUTE_BUDGET_MS)
    const report = await pending

    expect(report.degraded).toBe("execute_budget")
    // The tools resolved before the expiry, so their work is not discarded.
    expect(report.results.map((result) => result.name)).toEqual(["classify_episode"])
    expect(report.results[0].ok).toBe(true)
    expect(report.docs.map((entry) => entry.doc.id)).toContain(GUIDE_DOC.id)
    // The ladder never answered: nothing of it is invented, not even a step.
    expect(report.steps).toEqual([])
    expect(report.wiki).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears the budget timer when the stage finishes early", async () => {
    vi.useFakeTimers()

    const report = await executePlan({
      plan: plan([]),
      query: "mountain lodge",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(report.degraded).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("executePlan: containment", () => {
  it("keeps a single tool failure invisible in the degrade reason", async () => {
    const report = await executePlan({
      plan: plan([
        { name: "next_unwatched" },
        { name: "classify_episode", episode: 500 },
      ]),
      query: "what should I watch next",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(createStaticSource([GUIDE_DOC])),
    })

    expect(report.results.map((result) => result.ok)).toEqual([false, true])
    expect(report.results[0].error).toMatch(/next_unwatched/)
    expect(report.degraded).toBeNull()
  })

  it("sets tool_failed only when every dispatched tool failed", async () => {
    const report = await executePlan({
      plan: plan([
        { name: "next_unwatched" },
        { name: "search_conversations", query: "episode 500" },
      ]),
      query: "what should I watch next",
      deps: deps({ source: ladderSource().source }),
      // Nothing configured beyond what `ToolContext` requires: no watch client,
      // no transcript port.
      toolCtx: { source: createStaticSource([]), wiki: toolCtx().wiki },
    })

    expect(report.results.every((result) => !result.ok)).toBe(true)
    expect(report.degraded).toBe("tool_failed")
  })

  it("never calls a plan with no dispatched steps a tool failure", async () => {
    const report = await executePlan({
      plan: plan([
        { name: "search_catalog", query: "black organization" },
        { name: "search_cases", query: "kishida" },
      ]),
      query: "tell me about the black organization",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(createStaticSource([])),
    })

    expect(report.results).toEqual([])
    expect(report.degraded).toBeNull()
  })

  it("turns a throwing runTools into a degraded report, not a rejection", async () => {
    toolsSpy.mockRejectedValueOnce(new Error("dispatch down"))

    const report = await executePlan({
      plan: plan([{ name: "classify_episode", episode: 500 }]),
      query: "is episode 500 filler",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(report.degraded).toBe("tool_failed")
    expect(report.results).toEqual([])
  })

  it("turns a rejecting ladder into a degraded report and keeps the tools", async () => {
    ladderSpy.mockRejectedValueOnce(new Error("ladder down"))

    const report = await executePlan({
      plan: plan([{ name: "classify_episode", episode: 500 }]),
      query: "is episode 500 filler",
      deps: deps({ source: ladderSource().source }),
      toolCtx: toolCtx(),
    })

    expect(report.degraded).toBe("ladder_failed")
    expect(report.steps).toEqual([])
    expect(report.docs.map((entry) => entry.doc.id)).toContain(GUIDE_DOC.id)
  })

  it("resolves when every branch of the ladder's source rejects", async () => {
    const broken: DocumentSource = {
      async entity() {
        throw new Error("entity down")
      },
      async fullText() {
        throw new Error("fts down")
      },
      async fuzzy() {
        throw new Error("fuzzy down")
      },
      async fetch() {
        throw new Error("hydration down")
      },
    }

    const report = await executePlan({
      plan: plan([{ name: "classify_episode", episode: 500 }]),
      query: "mountain lodge",
      deps: deps({ source: broken }),
      toolCtx: toolCtx(),
    })

    // The ladder reports each broken round in `steps`; the tools ran anyway.
    expect(report.steps.map((step) => step.skipped)).toEqual([
      "error",
      "error",
      "error",
      "no_lore_needed",
    ])
    expect(report.docs.map((entry) => entry.doc.id)).toContain(GUIDE_DOC.id)
    expect(report.degraded).toBeNull()
  })
})
