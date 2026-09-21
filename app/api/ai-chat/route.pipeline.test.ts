/**
 * The route's v2 contract: retrieval runs through `runPipeline`, and what the
 * route does with its result.
 *
 * What is pinned here is the wiring, not the pipeline's stages (those are
 * `lib/__tests__/pipeline-*.test.ts`): the refusal gate reads the evidence refs
 * (D8), the watch history reaches `buildSystemPrompt` while the memory block and
 * the rolling summary travel through the pipeline instead (the assembler owns
 * those two sections), citations are validated after the stream against the
 * evidence actually supplied (D3), and the three synthetic messages never reach
 * the validator or the transcript.
 *
 * Two pieces of real code sit behind the mocks on purpose: `validateCitations`
 * is the real implementation behind a spy, because cases 3, 4 and 8 are the
 * citation wiring's proof, and `assembleMessages` is the real assembler inside
 * the mocked pipeline result, so "the assembled evidence text" means the text
 * the assembler actually produces. The module mocks mirror
 * `route.integration.test.ts`: no test may reach a database, a network or a real
 * provider (constraint 13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isTextUIPart,
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from "ai"
import { REFUSAL_NO_CONTEXT } from "@/lib/chat/intent"
import { assembleMessages } from "@/lib/ai/pipeline/assemble"
import type { PipelineInput, PipelineResult } from "@/lib/ai/pipeline"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import type { RequestLogEntry } from "@/lib/ai/request-log"
import {
  PARTS,
  isActivityPart,
  isCitationsPart,
  isDegradedPart,
  isEvidencePart,
} from "@/lib/ai/stream/protocol"

const getUser = vi.fn()
const maybeSingle = vi.fn()

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}))

// ai_documents is service-role only, so v2 reaches for the admin client; the
// fake keeps the request offline and lets a test assert the call.
const createAdminClient = vi.fn(() => null)
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}))

const searchAll = vi.fn()
const getUserWatchHistory = vi.fn()
vi.mock("@/lib/chat/search", () => ({
  searchAll: (...args: unknown[]) => searchAll(...args),
  getUserWatchHistory: (...args: unknown[]) => getUserWatchHistory(...args),
}))

const buildSystemPrompt = vi.fn()
vi.mock("@/lib/chat/prompt", () => ({
  buildSystemPrompt: (...args: unknown[]) => buildSystemPrompt(...args),
}))

const rateLimitPersistent = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({
  rateLimitPersistent: (...args: unknown[]) => rateLimitPersistent(...args),
}))

const logRequest = vi.fn()
vi.mock("@/lib/ai/request-log", () => ({
  logRequest: (...args: unknown[]) => logRequest(...args),
}))

const createRequestPersistence = vi.fn()
vi.mock("@/lib/chat/persistence", () => ({
  createRequestPersistence: (...args: unknown[]) => createRequestPersistence(...args),
}))

const after = vi.fn()
vi.mock("next/server", () => ({
  after: (task: unknown) => after(task),
}))

vi.mock("@/lib/ai/provider-health", () => ({
  createProviderHealth: () => ({
    load: async () => new Map(),
    isAvailable: () => true,
    recordFailure: async () => {},
    recordSuccess: async () => {},
  }),
}))

vi.mock("@/lib/ai/quota", () => ({
  createQuotaTracker: () => ({ consume: async () => true }),
}))

// The citation check runs for real behind a spy: cases 3 and 4 are the wiring's
// proof, and case 8 needs the exact text it was handed.
const { validateCitations } = vi.hoisted(() => ({ validateCitations: vi.fn() }))
vi.mock("@/lib/ai/citations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/citations")>()
  validateCitations.mockImplementation(actual.validateCitations)
  return { ...actual, validateCitations: (...args: unknown[]) => validateCitations(...args) }
})

// The planner call: the route builds it over the request budget's signal, and
// case 10 asserts that a disconnect aborts exactly that signal.
const toStructuredCall = vi.fn()
vi.mock("@/lib/ai/structured-call", () => ({
  toStructuredCall: (...args: unknown[]) => toStructuredCall(...args),
}))

// `pipelineVersion` stays real — case 6's rollback proof is only real if the
// route's own version read selects the branch.
const runPipeline = vi.fn()
vi.mock("@/lib/ai/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/pipeline")>()
  return { ...actual, runPipeline: (...args: unknown[]) => runPipeline(...args) }
})

const KEY = "test-key"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const USER_MESSAGE = "Who is Haibara?"
const OTHER_USER_MESSAGE = "Who won the 1998 World Cup?"
const EMPTY_RESULT_MESSAGE =
  "I could not find a reliable answer for that. Try naming the episode number, movie number, or character you mean."

const WATCH_HISTORY = {
  watched: ["Ep 1: Roller Coaster Murder Case"],
  rewatched: [],
  favorites: [],
  totalWatched: 1,
}

interface FakePersistence {
  conversationId: string
  window: ReturnType<typeof vi.fn>
  memories: ReturnType<typeof vi.fn>
  recallAnswer: ReturnType<typeof vi.fn>
  record: ReturnType<typeof vi.fn>
  afterTurn: ReturnType<typeof vi.fn>
}

function fakePersistence(overrides: Partial<FakePersistence> = {}): FakePersistence {
  return {
    conversationId: CONVERSATION_ID,
    window: vi.fn(async () => ({ summary: null, turns: [] })),
    memories: vi.fn(async () => ""),
    recallAnswer: vi.fn(async () => ""),
    record: vi.fn(async () => {}),
    afterTurn: vi.fn(async () => {}),
    ...overrides,
  }
}

function sse(...deltas: string[]): string {
  return deltas
    .map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}\n\n`)
    .join("")
}

function providerResponse(body: string, status = 200) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { status }
  )
}

function post(
  body: unknown,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {}
) {
  return new Request("http://localhost/api/ai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "localhost",
      origin: "http://localhost",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: init.signal,
  })
}

async function readText(response: Response): Promise<string> {
  return await response.text()
}

/**
 * The streamed response as the SDK itself reads it, plus its raw wire text.
 *
 * `readUIMessageStream` is the clean way to reconstruct a `UIMessage` from the
 * response rather than hand-parsing SSE: it proves the chunk sequence the route
 * emits round-trips through the SDK both sides use.
 */
async function readStream(response: Response): Promise<{ raw: string; message: UIMessage }> {
  const raw = await response.clone().text()
  const body = response.body
  if (body === null) throw new Error("the response carried no body")

  const chunks = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error
        controller.enqueue(chunk.value)
      },
    })
  )

  let message: UIMessage | undefined
  for await (const snapshot of readUIMessageStream({ stream: chunks })) message = snapshot
  if (message === undefined) throw new Error("the response produced no message")
  return { raw, message }
}

/** The answer as the reader sees it: every text part, concatenated. */
function answerText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("")
}

/** The payload of the first data part of `type`, or undefined. */
function dataPart(message: UIMessage, type: string): unknown {
  const part = message.parts.find((candidate) => candidate.type === type)
  return part === undefined ? undefined : (part as { data?: unknown }).data
}

/** The index of the first part of `type`, for ordering assertions. */
function partIndex(message: UIMessage, type: string): number {
  return message.parts.findIndex((candidate) => candidate.type === type)
}

/** The messages the gateway actually sent, from the recorded provider request. */
function sentMessages(fetchMock: ReturnType<typeof vi.fn>): { role: string; content: string }[] {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined
  const body = JSON.parse(init?.body ?? "{}") as { messages?: { role: string; content: string }[] }
  return body.messages ?? []
}

/** Runs whatever the route registered with `after`, once the body was read. */
async function runAfterTasks(): Promise<void> {
  for (const call of after.mock.calls) {
    const task = call[0] as () => Promise<void> | void
    await task()
  }
}

/** The request-log row, after the stream's own task has written it. */
async function loggedEntry(): Promise<RequestLogEntry> {
  await vi.waitFor(() => expect(logRequest).toHaveBeenCalled())
  return logRequest.mock.calls[0]?.[0] as RequestLogEntry
}

function doc(n: number): CorpusDocument {
  return {
    id: `character:subject-${n}`,
    source: "characters",
    title: `Character ${n}`,
    body: `BODY-${n}: Shiho Miyano is a former Black Organization scientist.`,
    url: null,
    metadata: {},
  }
}

function scored(...documents: CorpusDocument[]): ScoredDoc[] {
  return documents.map((entry, index) => ({
    doc: entry,
    score: 10 - index,
    rrf: 1 - index / 10,
    origins: ["entity"],
  }))
}

/**
 * A `PipelineResult` whose messages come from the real assembler, so the
 * evidence text the assertions look for is the text the model would read.
 */
function assembledResult(
  documents: ScoredDoc[] = scored(doc(1)),
  overrides: Partial<PipelineResult> = {}
): PipelineResult {
  const { messages, report } = assembleMessages({
    systemPrompt: "SYSTEM PROMPT",
    memories: "",
    summary: null,
    turns: [],
    docs: documents,
    wiki: [],
  })

  return {
    version: "v2",
    messages,
    evidence: report.evidence,
    evicted: report.evicted,
    degraded: null,
    planSource: "router",
    toolNames: ["lookup_character"],
    timings: { planMs: 7, retrieveMs: 11, assembleMs: 3 },
    screening: { excluded: [], matches: 0, redacted: 0 },
    ...overrides,
  }
}

let persistence: FakePersistence

beforeEach(() => {
  vi.clearAllMocks()
  // v2 is the default; a test that wants the rollback sets the pin itself.
  delete process.env.AI_PIPELINE
  process.env.GROQ_API_KEY = KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY_2
  delete process.env.CEREBRAS_API_KEY
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  maybeSingle.mockResolvedValue({ data: { display_name: "Noah", username: "noah" } })
  rateLimitPersistent.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  searchAll.mockResolvedValue({ episodes: [], cases: [], dcwWiki: [] })
  getUserWatchHistory.mockResolvedValue(WATCH_HISTORY)
  buildSystemPrompt.mockReturnValue("SYSTEM PROMPT")
  toStructuredCall.mockImplementation(() => vi.fn())
  runPipeline.mockResolvedValue(assembledResult())
  persistence = fakePersistence()
  createRequestPersistence.mockImplementation(async () => persistence)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AI_PIPELINE
})

describe("POST /api/ai-chat through the agentic pipeline", () => {
  it("answers with the assembled evidence in the system message", async () => {
    const fetchMock = vi.fn(async () => providerResponse(sse("She is a former BO scientist [E1].")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))

    expect(response.status).toBe(200)
    const { message } = await readStream(response)
    expect(answerText(message)).toBe("She is a former BO scientist [E1].")
    expect(runPipeline).toHaveBeenCalledTimes(1)

    const messages = sentMessages(fetchMock)
    expect(messages[0]?.role).toBe("system")
    expect(messages[0]?.content).toContain("BODY-1")
    expect(messages.at(-1)).toEqual({ role: "user", content: USER_MESSAGE })
  })

  it("refuses without evidence and never calls a provider", async () => {
    runPipeline.mockResolvedValue(assembledResult([]))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: OTHER_USER_MESSAGE }))

    expect(response.status).toBe(200)
    expect(await readText(response)).toBe(REFUSAL_NO_CONTEXT)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("records a valid citation when the answer cites supplied evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("She is a scientist [E1]."))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))
    expect(answerText(message)).toBe("She is a scientist [E1].")

    const entry = await loggedEntry()
    expect(entry.citationsValid).toBe(true)
    expect(entry.degradedReason).toBeNull()
  })

  it("records an unknown citation without rewriting the answer", async () => {
    runPipeline.mockResolvedValue(assembledResult(scored(doc(1), doc(2), doc(3))))
    const answer = "The culprit is [E9]."
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse(answer))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    // D3: Phase 4 records, Phase 5 renders. The text part is byte-for-byte what
    // the provider sent.
    expect(answerText(message)).toBe(answer)
    const entry = await loggedEntry()
    expect(entry.citationsValid).toBe(false)
  })

  it("logs the pipeline's plan source, tools and plan time", async () => {
    runPipeline.mockResolvedValue(
      assembledResult(scored(doc(1)), {
        planSource: "model",
        toolNames: ["search_cases", "lookup_character"],
        timings: { planMs: 812, retrieveMs: 40, assembleMs: 5 },
      })
    )
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Answer [E1]."))))
    const { POST } = await import("@/app/api/ai-chat/route")

    await readStream(await POST(post({ message: USER_MESSAGE })))

    const entry = await loggedEntry()
    expect(entry.planSource).toBe("model")
    expect(entry.tools).toEqual(["search_cases", "lookup_character"])
    expect(entry.planMs).toBe(812)
    expect(entry.retrieveMs).toBe(40)
    expect(entry.docCount).toBe(1)
  })

  it("keeps the v1 path — searchAll, no pipeline — when AI_PIPELINE=v1", async () => {
    process.env.AI_PIPELINE = "v1"
    searchAll.mockResolvedValue({ episodes: [{ id: "ep-1" }], cases: [], dcwWiki: [] })
    const fetchMock = vi.fn(async () => providerResponse(sse("Episode 1 answers it.")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    expect(answerText(message)).toBe("Episode 1 answers it.")
    expect(searchAll).toHaveBeenCalledTimes(1)
    expect(runPipeline).not.toHaveBeenCalled()
    // No v2 work at all: no watch-history read, no admin client, no pipeline.
    expect(getUserWatchHistory).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    // The v1 shape: activity with nulls, text, and no evidence or citations.
    const activity = dataPart(message, PARTS.activity)
    expect(isActivityPart(activity)).toBe(true)
    expect(activity).toMatchObject({ protocol: 1, planSource: null, tools: [] })
    expect(dataPart(message, PARTS.evidence)).toBeUndefined()
    expect(dataPart(message, PARTS.citations)).toBeUndefined()
    // The log row keeps today's shape: the pipeline's fields stay unset.
    const entry = await loggedEntry()
    expect(entry.planSource ?? null).toBeNull()
    expect(entry.tools ?? null).toBeNull()
    expect(entry.citationsValid ?? null).toBeNull()
  })

  it("degrades to the empty-result message when the pipeline rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    runPipeline.mockRejectedValue(new Error("pipeline exploded"))
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse("")))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))

    expect(response.status).toBe(200)
    const { message } = await readStream(response)
    expect(answerText(message)).toBe(EMPTY_RESULT_MESSAGE)
    expect(await loggedEntry()).toMatchObject({ degradedReason: "retrieval_failed" })
    expect(spy.mock.calls.some((call) => String(call[0]).includes("[ai-chat]"))).toBe(true)
    spy.mockRestore()
  })

  it("never validates or stores a synthetic partial suffix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            // The error must come from pull(), so the enqueued chunk survives.
            pull(controller) {
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        )
      })
    )
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))
    await runAfterTasks()

    expect(answerText(message)).toContain("cut short")
    const validated = validateCitations.mock.calls[0]?.[0] as { text: string }
    expect(validated.text).toBe("The victim was")
    expect(validated.text).not.toContain("cut short")
    expect(persistence.afterTurn).toHaveBeenCalledWith({ answer: "The victim was" })
  })

  it("never validates or stores a synthetic capacity message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))
    await runAfterTasks()

    expect(answerText(message)).toMatch(/at capacity/i)
    const validated = validateCitations.mock.calls[0]?.[0] as { text: string }
    expect(validated.text).toBe("")
    expect(persistence.afterTurn).not.toHaveBeenCalled()
  })

  it("reports a synthetic state instead of `uncited` when the answer never arrived", async () => {
    // Evidence was supplied, so `validateCitations` sees `requireCitation: true`
    // against an empty accumulator and reports `uncited`. That verdict is about
    // an answer, and this turn has none: the reader gets the rate-limited
    // sentence and that state alone, never a second badge for a citation that
    // was never possible.
    runPipeline.mockResolvedValue(assembledResult(scored(doc(1))))
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))
    await runAfterTasks()

    expect(validateCitations.mock.calls[0]?.[0]).toMatchObject({ text: "", requireCitation: true })
    const degraded = dataPart(message, PARTS.degraded)
    if (!isDegradedPart(degraded)) throw new Error("no degraded part")
    expect(degraded.reasons).toEqual(["rate_limited"])
  })

  it("assembles the memory block and the summary through the pipeline, not the prompt builder", async () => {
    persistence.window.mockResolvedValue({
      summary: "They discussed episode 5.",
      turns: [{ role: "user", content: "Earlier question" }],
    })
    persistence.memories.mockResolvedValue("[MEM] favorite_character: Haibara (conf 0.9)")
    runPipeline.mockImplementation(async (input: PipelineInput) => {
      const { messages, report } = assembleMessages({
        systemPrompt: input.systemPrompt,
        memories: input.memories,
        summary: input.summary,
        turns: input.priorTurns,
        docs: scored(doc(1)),
        wiki: [],
      })
      return assembledResult(scored(doc(1)), { messages, evidence: report.evidence })
    })
    const fetchMock = vi.fn(async () => providerResponse(sse("Answer [E1].")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    await readStream(await POST(post({ message: USER_MESSAGE })))

    const system = sentMessages(fetchMock)[0]
    expect(system?.content).toContain("[MEM] favorite_character: Haibara")
    expect(system?.content).toContain("They discussed episode 5.")

    const promptArgs = buildSystemPrompt.mock.calls[0]?.[0] as {
      context: { episodes: unknown[]; cases: unknown[]; dcwWiki: unknown[]; watchHistory?: unknown }
      memories?: string
      conversationSummary?: string
    }
    expect(getUserWatchHistory).toHaveBeenCalledWith("user-1")
    expect(promptArgs.context).toMatchObject({ episodes: [], cases: [], dcwWiki: [] })
    expect(promptArgs.context.watchHistory).toEqual(WATCH_HISTORY)
    // The assembler owns those two sections; the builder must not see them.
    expect(promptArgs.memories).toBeUndefined()
    expect(promptArgs.conversationSummary).toBeUndefined()

    const pipelineInput = runPipeline.mock.calls[0]?.[0] as PipelineInput
    expect(pipelineInput.memories).toContain("[MEM] favorite_character")
    expect(pipelineInput.summary).toBe("They discussed episode 5.")
    // The retrieval query is the route's composed `searchQuery` (previous user
    // turn + this message) — the string v1's `searchAll` searched with, and
    // what `PipelineInput.message` documents. The current turn is appended to
    // the messages separately.
    expect(pipelineInput.message).toBe("Earlier question Who is Haibara?")
  })

  it("aborts the planner's signal when the client disconnects during planning", async () => {
    const controller = new AbortController()
    let plannerSignal: AbortSignal | undefined
    toStructuredCall.mockImplementation((_gateway: unknown, options: { signal: AbortSignal }) => {
      plannerSignal = options.signal
      return vi.fn()
    })
    runPipeline.mockImplementation(async () => {
      controller.abort()
      return assembledResult([])
    })
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse("")))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }, { signal: controller.signal }))
    await readStream(response)

    expect(toStructuredCall).toHaveBeenCalledTimes(1)
    expect(plannerSignal).toBeDefined()
    expect(plannerSignal?.aborted).toBe(true)
  })

  it("streams the pipeline's activity, evidence and citation report as parts", async () => {
    const result = assembledResult(scored(doc(1), doc(2)))
    runPipeline.mockResolvedValue(result)
    const answer = "She is a scientist [E1]."
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("She is ", "a scientist [E1]."))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    const activity = dataPart(message, PARTS.activity)
    if (!isActivityPart(activity)) throw new Error("no activity part")
    expect(activity).toEqual({
      protocol: 1,
      planSource: "router",
      tools: ["lookup_character"],
      timings: { planMs: 7, retrieveMs: 11, assembleMs: 3 },
    })

    const evidence = dataPart(message, PARTS.evidence)
    if (!isEvidencePart(evidence)) throw new Error("no evidence part")
    expect(evidence.refs).toEqual(result.evidence)

    const citations = dataPart(message, PARTS.citations)
    if (!isCitationsPart(citations)) throw new Error("no citations part")
    // The report is the real validator's verdict on the answer that streamed,
    // against the evidence the pipeline actually supplied.
    expect(citations.report).toEqual(
      validateCitations({ text: answer, evidence: result.evidence, requireCitation: true })
    )

    // The gateway's deltas cross the wire byte-for-byte, in one text part.
    expect(answerText(message)).toBe(answer)
    // A clean turn reports no degradation at all.
    expect(dataPart(message, PARTS.degraded)).toBeUndefined()
  })

  it("sends the pipeline's evicted ids, not a second computation", async () => {
    // The real assembler evicts two of three oversized documents, so the ids the
    // route sends are the assembler's own report, carried through the pipeline
    // result unchanged (D5). A route that re-derived the list would be a second
    // answer to the same question.
    const big = (n: number): CorpusDocument => ({
      ...doc(n),
      id: `entry:big-${n}`,
      body: "x".repeat(4000),
    })
    const result = assembledResult(scored(big(1), big(2), big(3)))
    runPipeline.mockResolvedValue(result)
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Answer [E1]."))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    expect(result.evicted).toEqual(["entry:big-3", "entry:big-2"])
    const activity = dataPart(message, PARTS.activity)
    if (!isActivityPart(activity)) throw new Error("no activity part")
    expect(activity.evicted).toEqual(result.evicted)
  })

  it("sends the pipeline's own degrade reason before the answer", async () => {
    runPipeline.mockResolvedValue(assembledResult(scored(doc(1)), { degraded: "corpus_static" }))
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Answer [E1]."))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    const degraded = dataPart(message, PARTS.degraded)
    if (!isDegradedPart(degraded)) throw new Error("no degraded part")
    expect(degraded.reasons).toEqual(["corpus_static"])
    expect(partIndex(message, PARTS.degraded)).toBeLessThan(partIndex(message, "text"))
    expect(answerText(message)).toBe("Answer [E1].")
  })

  it("sends a synthetic degrade part after the text it describes", async () => {
    // No evidence: this case is about the stream ending, not the citation
    // contract, so `uncited` cannot be part of the reasons.
    runPipeline.mockResolvedValue(assembledResult([]))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            // The error must come from pull(), so the enqueued chunk survives.
            pull(controller) {
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        )
      })
    )
    const { POST } = await import("@/app/api/ai-chat/route")

    const { message } = await readStream(await POST(post({ message: USER_MESSAGE })))

    const degraded = dataPart(message, PARTS.degraded)
    if (!isDegradedPart(degraded)) throw new Error("no degraded part")
    expect(degraded.reasons).toEqual(["partial_answer"])
    // Task 4 must apply a late `degraded` part: it arrives after the text it
    // explains, because the stream's end is what produced it.
    expect(partIndex(message, PARTS.degraded)).toBeGreaterThan(partIndex(message, "text"))
    expect(answerText(message)).toContain("cut short")
  })
})
