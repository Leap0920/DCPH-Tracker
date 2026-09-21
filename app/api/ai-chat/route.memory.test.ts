/**
 * The route's half of the persistence contract: the seam is mocked, so what is
 * pinned here is the wiring — which id goes down, what reaches the prompt, when
 * the user turn is stored relative to the first token, and what the post-response
 * hook is handed.
 *
 * The seam's own policy (the AI_MEMORY switch, the writer call, the count it
 * carries) is tested where it lives: `lib/__tests__/chat-persistence.test.ts`.
 * This file mocks `@/lib/chat/persistence` for the same reason the integration
 * test does — a unit test must never reach the live project — and it mocks
 * `next/server`'s `after` so the post-response work can be awaited instead of
 * running whenever Next chooses to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isTextUIPart,
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from "ai"

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

const searchAll = vi.fn()
vi.mock("@/lib/chat/search", () => ({
  searchAll: (...args: unknown[]) => searchAll(...args),
}))

const buildSystemPromptArgs = vi.fn()
vi.mock("@/lib/chat/prompt", () => ({
  // The two transcript sections are echoed back into the prompt text, so a test
  // can assert what the gateway actually received rather than only what the
  // builder was handed. The builder's own rendering is covered in
  // chat-prompt.test.ts.
  buildSystemPrompt: (args: { memories?: string; conversationSummary?: string }) => {
    buildSystemPromptArgs(args)
    return `SYSTEM PROMPT\n${args.conversationSummary ?? ""}\n${args.memories ?? ""}`
  },
}))

const rateLimitPersistent = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({
  rateLimitPersistent: (...args: unknown[]) => rateLimitPersistent(...args),
}))

const logRequest = vi.fn()
vi.mock("@/lib/ai/request-log", () => ({
  logRequest: (...args: unknown[]) => logRequest(...args),
}))

// Inert stores: no circuit is open, every daily budget has room. The route
// builds its own gateway, so these must not construct a real admin client.
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

const createRequestPersistence = vi.fn()
vi.mock("@/lib/chat/persistence", () => ({
  createRequestPersistence: (...args: unknown[]) => createRequestPersistence(...args),
}))

const after = vi.fn()
vi.mock("next/server", () => ({
  after: (task: unknown) => after(task),
}))

const KEY = "test-key"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const USER_MESSAGE = "Who is Haibara?"

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
    // An empty window is a fresh thread: the route falls back to the client's
    // history exactly as it does today.
    window: vi.fn(async () => ({ summary: null, turns: [] })),
    memories: vi.fn(async () => ""),
    // "" is the seam's "nothing to say" (AI_MEMORY off), which the route reads
    // as "fall through" rather than as an answer.
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

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "localhost",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function readText(response: Response): Promise<string> {
  return await response.text()
}

/**
 * The streamed response as the SDK itself reads it. The answer no longer
 * crosses the wire as plain text, so an assertion about it reconstructs the
 * text from the message parts rather than reading the SSE body.
 */
async function readStream(response: Response): Promise<UIMessage> {
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
  return message
}

/** The answer as the reader sees it: every text part, concatenated. */
function answerText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("")
}

/** Runs whatever the route registered with `after`, once the body was read. */
async function runAfterTasks(): Promise<void> {
  for (const call of after.mock.calls) {
    const task = call[0] as () => Promise<void> | void
    await task()
  }
}

/** The messages the gateway actually sent, from the recorded provider request. */
function sentMessages(fetchMock: ReturnType<typeof vi.fn>): { role: string; content: string }[] {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined
  const body = JSON.parse(init?.body ?? "{}") as { messages?: { role: string; content: string }[] }
  return body.messages ?? []
}

let persistence: FakePersistence

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AI_PIPELINE = "v1"
  delete process.env.AI_MEMORY
  process.env.GROQ_API_KEY = KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY_2
  delete process.env.CEREBRAS_API_KEY
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  maybeSingle.mockResolvedValue({ data: { display_name: "Noah", username: "noah" } })
  rateLimitPersistent.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  searchAll.mockResolvedValue({ episodes: [], cases: [], dcwWiki: [] })
  persistence = fakePersistence()
  createRequestPersistence.mockImplementation(async () => persistence)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.AI_MEMORY
})

describe("POST /api/ai-chat with server-owned transcripts", () => {
  it("resolves a conversation when the body carries no id and returns its id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi ", "there"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))

    expect(createRequestPersistence).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: undefined,
    })
    expect(response.headers.get("X-Conversation-Id")).toBe(CONVERSATION_ID)
    expect(answerText(await readStream(response))).toBe("Hi there")
  })

  it("passes a body conversationId through to the seam", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE, conversationId: "conv-9" }))

    expect(createRequestPersistence).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: "conv-9",
    })
    expect(response.headers.get("X-Conversation-Id")).toBe(CONVERSATION_ID)
    await readText(response)
  })

  it("still answers from the client's history when the store rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    createRequestPersistence.mockRejectedValue(new Error("db down"))
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi there")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(
      post({ message: USER_MESSAGE, history: [{ role: "user", content: "earlier question" }] })
    )

    expect(response.status).toBe(200)
    expect(answerText(await readStream(response))).toBe("Hi there")
    expect(sentMessages(fetchMock).some((m) => m.content === "earlier question")).toBe(true)
    expect(spy.mock.calls[0]?.[0]).toContain("[ai-chat]")
    spy.mockRestore()
  })

  it("records both turns and injects nothing when memory is off", async () => {
    // The kill switch itself lives in the seam; at this level its effect is a
    // seam that returns no block while the transcript keeps working. The seam's
    // own half of the rule is pinned in chat-persistence.test.ts.
    process.env.AI_MEMORY = "off"
    persistence.memories.mockResolvedValue("")
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi there"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))
    await readText(response)
    await runAfterTasks()

    expect(persistence.record).toHaveBeenCalledWith("user", USER_MESSAGE)
    expect(persistence.afterTurn).toHaveBeenCalledWith({ answer: "Hi there" })
    const promptArgs = buildSystemPromptArgs.mock.calls[0]?.[0] as { memories?: string }
    expect(promptArgs.memories ?? "").not.toContain("[")
  })

  it("injects the remembered facts into the prompt the gateway receives", async () => {
    persistence.memories.mockResolvedValue("[MEM] favorite_character: Haibara (conf 0.9)")
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))
    await readText(response)

    expect(persistence.memories).toHaveBeenCalledWith(USER_MESSAGE)
    expect(buildSystemPromptArgs.mock.calls[0]?.[0]?.memories).toContain("[MEM]")
    expect(sentMessages(fetchMock)[0]?.content).toContain("Haibara")
  })

  it("stores the user turn before the first token and the streamed text after", async () => {
    const events: string[] = []
    persistence.record.mockImplementation(async (role: string) => {
      events.push(`record:${role}`)
    })
    const fetchMock = vi.fn(async () => {
      events.push("fetch")
      return providerResponse(sse("Hi ", "there"))
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))
    expect(answerText(await readStream(response))).toBe("Hi there")
    await runAfterTasks()

    expect(events).toEqual(["record:user", "fetch"])
    expect(persistence.record).toHaveBeenCalledWith("user", USER_MESSAGE)
    expect(persistence.afterTurn).toHaveBeenCalledWith({ answer: "Hi there" })
  })

  it("stores no assistant turn when nothing was emitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })))
    const { POST } = await import("@/app/api/ai-chat/route")

    const message = await readStream(await POST(post({ message: USER_MESSAGE })))
    await runAfterTasks()

    // The synthetic capacity message is not an answer, so it is never stored.
    expect(answerText(message)).toMatch(/at capacity/i)
    expect(persistence.afterTurn).not.toHaveBeenCalled()
  })

  it("stores a partial answer without the synthetic suffix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            pull(controller) {
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        )
      })
    )
    const { POST } = await import("@/app/api/ai-chat/route")

    const message = await readStream(await POST(post({ message: USER_MESSAGE })))
    await runAfterTasks()

    expect(answerText(message)).toContain("cut short")
    expect(persistence.afterTurn).toHaveBeenCalledWith({ answer: "The victim was" })
  })

  it("degrades to the client's history when resolution exceeds 400 ms", async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    createRequestPersistence.mockReturnValue(new Promise(() => {}))
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi there")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const pending = POST(
      post({ message: USER_MESSAGE, history: [{ role: "user", content: "earlier question" }] })
    )
    await vi.advanceTimersByTimeAsync(400)
    const response = await pending

    expect(response.status).toBe(200)
    expect(answerText(await readStream(response))).toBe("Hi there")
    expect(sentMessages(fetchMock).some((m) => m.content === "earlier question")).toBe(true)
    expect(spy.mock.calls[0]?.[0]).toContain("[ai-chat]")
    spy.mockRestore()
  })

  it("falls back to the client's history when the window read exceeds 400 ms", async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    persistence.window.mockReturnValue(new Promise(() => {}))
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi there")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const pending = POST(
      post({ message: USER_MESSAGE, history: [{ role: "user", content: "earlier question" }] })
    )
    await vi.advanceTimersByTimeAsync(400)
    const response = await pending

    expect(answerText(await readStream(response))).toBe("Hi there")
    expect(sentMessages(fetchMock).some((m) => m.content === "earlier question")).toBe(true)
    expect(spy.mock.calls[0]?.[0]).toContain("[ai-chat]")
    spy.mockRestore()
  })

  it("answers without a memory block when the fact read exceeds 400 ms", async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    persistence.memories.mockReturnValue(new Promise(() => {}))
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi there"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const pending = POST(post({ message: USER_MESSAGE }))
    await vi.advanceTimersByTimeAsync(400)
    const response = await pending

    expect(answerText(await readStream(response))).toBe("Hi there")
    const promptArgs = buildSystemPromptArgs.mock.calls[0]?.[0] as { memories?: string }
    expect(promptArgs.memories).toBe("")
    spy.mockRestore()
  })

  it("omits the conversation header when persistence is unavailable", async () => {
    createRequestPersistence.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi there"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: USER_MESSAGE }))

    expect(response.status).toBe(200)
    expect(response.headers.get("X-Conversation-Id")).toBeNull()
    expect(answerText(await readStream(response))).toBe("Hi there")
  })

  it("uses the server's window instead of the client's history when it has one", async () => {
    persistence.window.mockResolvedValue({
      summary: "They discussed episode 5.",
      turns: [{ role: "user", content: "server turn" }],
    })
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    await readText(await POST(post({ message: USER_MESSAGE, history: [{ role: "user", content: "client turn" }] })))

    const messages = sentMessages(fetchMock)
    expect(messages.some((m) => m.content === "server turn")).toBe(true)
    expect(messages.some((m) => m.content === "client turn")).toBe(false)
    expect(messages[0]?.content).toContain("They discussed episode 5.")
  })
})

/**
 * Rule 6: a question about what the bot remembers of the user is answered from
 * the memory table, without a model call — and a tracker question that merely
 * sounds like one is not.
 */
describe("POST /api/ai-chat with a memory question", () => {
  const RECALL_ANSWER =
    "Here is what I remember about you:\n\nPreferences\n- favorite_character: Haibara (confidence 0.90)"

  it("answers it from the seam, in the plain-text response shape, with no model call", async () => {
    persistence.recallAnswer.mockResolvedValue(RECALL_ANSWER)
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "what do you remember about me" }))
    const text = await readText(response)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8")
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-store, no-transform")
    expect(persistence.recallAnswer).toHaveBeenCalled()
    expect(text).toContain("Haibara")
    // The whole point of the branch: a listing is data, not generation.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("leaves a domain question to retrieval and the gateway", async () => {
    persistence.recallAnswer.mockResolvedValue(RECALL_ANSWER)
    const fetchMock = vi.fn(async () => providerResponse(sse("Episode 5 is")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const message = await readStream(
      await POST(post({ message: "what do you remember about episode 5" }))
    )

    expect(answerText(message)).toBe("Episode 5 is")
    expect(persistence.recallAnswer).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalled()
  })

  it("falls through to the model when the memory read exceeds 400 ms", async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    persistence.recallAnswer.mockReturnValue(new Promise(() => {}))
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi there")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const pending = POST(
      post({
        message: "what do you remember about me",
        // An in-domain earlier turn, so the fall-through is decided by the
        // branch rather than by the retrieval gate's own refusal.
        history: [{ role: "user", content: "Who is Haibara?" }],
      })
    )
    await vi.advanceTimersByTimeAsync(400)
    const response = await pending

    expect(answerText(await readStream(response))).toBe("Hi there")
    expect(fetchMock).toHaveBeenCalled()
    expect(spy.mock.calls[0]?.[0]).toContain("[ai-chat]")
    spy.mockRestore()
  })

  it("falls through when the seam has nothing to say", async () => {
    // AI_MEMORY=off reaches the route as "", and an empty 200 would read as a
    // broken answer rather than as "memory is off".
    persistence.recallAnswer.mockResolvedValue("")
    const fetchMock = vi.fn(async () => providerResponse(sse("Hi there")))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const message = await readStream(
      await POST(
        post({
          message: "what do you remember about me",
          history: [{ role: "user", content: "Who is Haibara?" }],
        })
      )
    )

    expect(answerText(message)).toBe("Hi there")
    expect(fetchMock).toHaveBeenCalled()
  })
})
