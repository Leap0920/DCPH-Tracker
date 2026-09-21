import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import {
  PARTS,
  PROTOCOL_VERSION,
  isKnownProtocol,
} from "@/lib/ai/stream/protocol"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import {
  toChatRequestBody,
  toMessageView,
  toMessageViews,
  transcriptToUIMessages,
  useChatStream,
  type StreamViewContext,
  type TranscriptMessageLike,
} from "@/components/chat/useChatStream"

// The jsdom project has no .env.local and must not reach a socket, so every
// transport here is scripted and every fetch is stubbed. `vi.unstubAllGlobals`
// puts the real one back between tests.
afterEach(() => {
  vi.unstubAllGlobals()
})

type Part = UIMessage["parts"][number]

const IDLE: StreamViewContext = { streamingMessageId: null, stoppedMessageId: null }

const REF: EvidenceRef = { n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }
const REPORT: CitationReport = { cited: [REF], unknown: [], valid: true, uncited: false }

/** A stored transcript, as the drawer hands it back. */
const STORED_ROWS: TranscriptMessageLike[] = [
  { id: "s1", role: "user", content: "Who is Bourbon?" },
  { id: "s2", role: "assistant", content: "A member of the Black Organization." },
]

function textPart(text: string): Part {
  return { type: "text", text }
}

function dataPart(type: `data-${string}`, data: unknown): Part {
  return { type, data }
}

function assistant(parts: Part[], id = "a1"): UIMessage {
  return { id, role: "assistant", parts }
}

function user(text: string, id = "u1"): UIMessage {
  return { id, role: "user", parts: [textPart(text)] }
}

function assistantText(text: string, id = "a1"): UIMessage {
  return { id, role: "assistant", parts: [textPart(text)] }
}

function activityPart(overrides: Partial<{ protocol: number }> = {}): Part {
  return dataPart(PARTS.activity, {
    protocol: overrides.protocol ?? PROTOCOL_VERSION,
    planSource: "router",
    tools: ["search_catalog"],
    timings: { planMs: 12, retrieveMs: 34, assembleMs: 56 },
  })
}

function completeTurnChunks(delta = "Hello world"): UIMessageChunk[] {
  return [
    activityPart() as UIMessageChunk,
    dataPart(PARTS.evidence, { refs: [REF] }) as UIMessageChunk,
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta },
    { type: "text-end", id: "answer" },
    dataPart(PARTS.citations, { report: REPORT }) as UIMessageChunk,
  ]
}

interface TransportCall {
  trigger: "submit-message" | "regenerate-message"
  messages: UIMessage[]
  messageId: string | undefined
}

/** A transport that answers each call with a scripted, already-closed stream. */
function scriptedTransport(script: (call: TransportCall, index: number) => UIMessageChunk[]) {
  const calls: TransportCall[] = []
  const transport: ChatTransport<UIMessage> = {
    async sendMessages(options) {
      const call: TransportCall = {
        trigger: options.trigger,
        messages: options.messages,
        messageId: options.messageId,
      }
      calls.push(call)
      const chunks = script(call, calls.length - 1)
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        },
      })
    },
    async reconnectToStream() {
      return null
    },
  }
  return { transport, calls }
}

/** A transport whose stream stays open, so a test can stop it mid-answer. */
function controllableTransport() {
  const calls: TransportCall[] = []
  let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null
  const transport: ChatTransport<UIMessage> = {
    async sendMessages(options) {
      calls.push({
        trigger: options.trigger,
        messages: options.messages,
        messageId: options.messageId,
      })
      return new ReadableStream<UIMessageChunk>({
        start(streamController) {
          controller = streamController
        },
      })
    },
    async reconnectToStream() {
      return null
    },
  }
  return {
    transport,
    calls,
    push(chunk: UIMessageChunk) {
      controller?.enqueue(chunk)
    },
  }
}

/** A scripted SSE response, exactly the framing `createUIMessageStreamResponse` emits. */
function sseResponse(chunks: UIMessageChunk[], headers: Record<string, string> = {}): Response {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  })
}

describe("toMessageView", () => {
  it("carries the evidence refs, activity and citation report verbatim", () => {
    const view = toMessageView(
      assistant([
        activityPart(),
        dataPart(PARTS.evidence, { refs: [REF] }),
        textPart("The answer cites [E1]."),
        dataPart(PARTS.citations, { report: REPORT }),
      ]),
      IDLE
    )

    expect(view.refs).toEqual([REF])
    expect(view.activity).toEqual({
      protocol: PROTOCOL_VERSION,
      planSource: "router",
      tools: ["search_catalog"],
      timings: { planMs: 12, retrieveMs: 34, assembleMs: 56 },
    })
    expect(view.citations).toEqual(REPORT)
    expect(view.state).toEqual({ kind: "complete" })
  })

  it("keeps the answer text exactly as the SDK assembled it", () => {
    const text = "  line one\n\nline two [E9]  "
    const view = toMessageView(assistant([textPart(text)]), IDLE)

    expect(view.text).toBe(text)
  })

  it("merges the degrade reasons of every degraded part, deduped in arrival order", () => {
    const view = toMessageView(
      assistant([
        dataPart(PARTS.degraded, { reasons: ["screened", "uncited"] }),
        textPart("text"),
        dataPart(PARTS.degraded, { reasons: ["uncited", "partial_answer"] }),
      ]),
      IDLE
    )

    expect(view.degraded).toEqual(["screened", "uncited", "partial_answer"])
    // A synthetic token wins the state summary (D5), even arriving late.
    expect(view.state).toEqual({ kind: "synthetic", reason: "partial_answer" })
  })

  it("ignores part types it does not know", () => {
    const view = toMessageView(
      assistant([
        dataPart("data-mystery", { anything: true }),
        { type: "reasoning", text: "thinking" },
        textPart("hello"),
      ]),
      IDLE
    )

    expect(view.text).toBe("hello")
    expect(view.refs).toEqual([])
    expect(view.activity).toBeNull()
    expect(view.degraded).toEqual([])
    expect(view.citations).toBeNull()
    expect(view.state).toEqual({ kind: "complete" })
  })

  it("renders the text alone when the protocol version is unknown", () => {
    const view = toMessageView(
      assistant([
        activityPart({ protocol: PROTOCOL_VERSION + 1 }),
        dataPart(PARTS.evidence, { refs: [REF] }),
        dataPart(PARTS.degraded, { reasons: ["uncited"] }),
        dataPart(PARTS.citations, { report: REPORT }),
        textPart("answer"),
      ]),
      IDLE
    )

    expect(isKnownProtocol(PROTOCOL_VERSION + 1)).toBe(false)
    expect(view.text).toBe("answer")
    expect(view.refs).toEqual([])
    expect(view.activity).toBeNull()
    expect(view.degraded).toEqual([])
    expect(view.citations).toBeNull()
  })

  it("ignores a malformed payload rather than trusting a cast", () => {
    const view = toMessageView(
      assistant([dataPart(PARTS.evidence, { refs: "not an array" }), textPart("text")]),
      IDLE
    )

    expect(view.refs).toEqual([])
    expect(view.text).toBe("text")
  })

  it("marks the message the hook is streaming", () => {
    const view = toMessageView(assistant([textPart("partial")], "a1"), {
      streamingMessageId: "a1",
      stoppedMessageId: null,
    })

    expect(view.state).toEqual({ kind: "streaming" })
  })

  it("marks the message the reader stopped", () => {
    const view = toMessageView(assistant([textPart("partial")], "a1"), {
      streamingMessageId: null,
      stoppedMessageId: "a1",
    })

    expect(view.state).toEqual({ kind: "stopped" })
  })

  it("marks a degrade ending with its reasons", () => {
    const view = toMessageView(
      assistant([textPart("t"), dataPart(PARTS.degraded, { reasons: ["uncited"] })]),
      IDLE
    )

    expect(view.state).toEqual({ kind: "degraded", reasons: ["uncited"] })
  })

  it("marks a synthetic ending by its token", () => {
    const view = toMessageView(
      assistant([textPart("t"), dataPart(PARTS.degraded, { reasons: ["rate_limited"] })]),
      IDLE
    )

    expect(view.state).toEqual({ kind: "synthetic", reason: "rate_limited" })
  })

  it("reads a v1 turn — activity and text only — as finished", () => {
    const view = toMessageView(
      assistant([
        dataPart(PARTS.activity, {
          protocol: PROTOCOL_VERSION,
          planSource: null,
          tools: [],
          timings: { planMs: null, retrieveMs: 8, assembleMs: null },
        }),
        textPart("v1 answer"),
      ]),
      IDLE
    )

    expect(view.text).toBe("v1 answer")
    expect(view.refs).toEqual([])
    expect(view.citations).toBeNull()
    expect(view.activity?.planSource).toBeNull()
    expect(view.state).toEqual({ kind: "complete" })
  })
})

describe("toMessageViews", () => {
  it("maps every message in order, preserving ids and roles", () => {
    const views = toMessageViews(
      [user("hi", "u1"), assistantText("hello", "a1")],
      IDLE
    )

    expect(views.map((view) => [view.id, view.role, view.text])).toEqual([
      ["u1", "user", "hi"],
      ["a1", "assistant", "hello"],
    ])
  })
})

describe("toChatRequestBody", () => {
  it("sends the newest user message and the prior turns as history", () => {
    const messages = [user("one", "u1"), assistantText("answer one", "a1"), user("two", "u2")]

    expect(toChatRequestBody({ messages, conversationId: null })).toEqual({
      message: "two",
      history: [
        { role: "user", content: "one" },
        { role: "assistant", content: "answer one" },
      ],
    })
  })

  it("includes the conversation id when there is one", () => {
    expect(toChatRequestBody({ messages: [user("hi")], conversationId: "conv-9" })).toEqual({
      message: "hi",
      history: [],
      conversationId: "conv-9",
    })
  })

  it("omits the conversation id when it is null or blank", () => {
    expect(
      toChatRequestBody({ messages: [user("hi")], conversationId: null })
    ).not.toHaveProperty("conversationId")
    expect(
      toChatRequestBody({ messages: [user("hi")], conversationId: "   " })
    ).not.toHaveProperty("conversationId")
  })

  it("drops empty turns and roles the route would reject", () => {
    const messages: UIMessage[] = [
      { id: "s1", role: "system", parts: [textPart("system prompt")] },
      { id: "u1", role: "user", parts: [textPart("   ")] },
      user("real", "u2"),
    ]

    expect(toChatRequestBody({ messages, conversationId: null })).toEqual({
      message: "real",
      history: [],
    })
  })

  it("takes the edited turn as the message after a truncation", () => {
    expect(
      toChatRequestBody({ messages: [user("edited", "u1")], conversationId: "conv-9" })
    ).toEqual({ message: "edited", history: [], conversationId: "conv-9" })
  })
})

describe("transcriptToUIMessages", () => {
  it("maps stored rows to text-only parts, in order and with their ids", () => {
    const messages = transcriptToUIMessages(STORED_ROWS)

    expect(messages).toEqual([
      { id: "s1", role: "user", parts: [{ type: "text", text: "Who is Bourbon?" }] },
      {
        id: "s2",
        role: "assistant",
        parts: [{ type: "text", text: "A member of the Black Organization." }],
      },
    ])
  })

  it("keeps a row whose content is empty rather than dropping it", () => {
    // A dropped row would silently change the history the server is told about.
    const messages = transcriptToUIMessages([
      { id: "s1", role: "user", content: "" },
      { id: "s2", role: "assistant", content: "answer" },
    ])

    expect(messages.map((message) => message.id)).toEqual(["s1", "s2"])
    expect(messages[0].parts).toEqual([{ type: "text", text: "" }])
  })
})

describe("useChatStream", () => {
  it("streams a turn and settles it to complete", async () => {
    const { transport, calls } = scriptedTransport(() => completeTurnChunks())
    const { result } = renderHook(() => useChatStream({ transport }))

    await act(async () => {
      await result.current.send("hi")
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].trigger).toBe("submit-message")
    expect(result.current.status).toBe("idle")

    const [sent, answer] = result.current.messages
    expect(sent.role).toBe("user")
    expect(sent.text).toBe("hi")
    expect(answer.role).toBe("assistant")
    expect(answer.text).toBe("Hello world")
    expect(answer.refs).toEqual([REF])
    expect(answer.activity?.planSource).toBe("router")
    expect(answer.citations).toEqual(REPORT)
    expect(answer.state).toEqual({ kind: "complete" })
  })

  it("stops the stream, keeps the partial text and marks the message stopped", async () => {
    const { transport, push } = controllableTransport()
    const { result } = renderHook(() => useChatStream({ transport }))

    let sending: Promise<void> = Promise.resolve()
    await act(async () => {
      sending = result.current.send("hello")
    })
    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "partial answer" })
    })
    await act(async () => {})

    expect(result.current.status).toBe("streaming")
    expect(result.current.messages.at(-1)?.state).toEqual({ kind: "streaming" })
    expect(result.current.messages.at(-1)?.text).toBe("partial answer")

    await act(async () => {
      result.current.stop()
      await sending
    })

    expect(result.current.status).toBe("stopped")
    expect(result.current.messages.at(-1)?.state).toEqual({ kind: "stopped" })
    expect(result.current.messages.at(-1)?.text).toBe("partial answer")
  })

  it("regenerates the last turn in place", async () => {
    const { transport, calls } = scriptedTransport((_call, index) => [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: index === 0 ? "first" : "second" },
      { type: "text-end", id: "answer" },
    ])
    const { result } = renderHook(() => useChatStream({ transport }))

    await act(async () => {
      await result.current.send("hi")
    })
    expect(result.current.messages.at(-1)?.text).toBe("first")

    await act(async () => {
      await result.current.regenerate()
    })

    expect(calls).toHaveLength(2)
    expect(calls[1].trigger).toBe("regenerate-message")
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages.at(-1)?.text).toBe("second")
    expect(result.current.messages.at(-1)?.state).toEqual({ kind: "complete" })
  })

  it("edits a user turn, truncates from it and resends", async () => {
    const { transport, calls } = scriptedTransport((_call, index) => [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: index === 0 ? "original answer" : "new answer" },
      { type: "text-end", id: "answer" },
    ])
    const { result } = renderHook(() => useChatStream({ transport }))

    await act(async () => {
      await result.current.send("original")
    })
    const userMessageId = result.current.messages[0].id
    const firstAnswerId = result.current.messages[1].id

    await act(async () => {
      await result.current.editAndResend(userMessageId, "edited")
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].id).toBe(userMessageId)
    expect(result.current.messages[0].text).toBe("edited")
    expect(result.current.messages[1].id).not.toBe(firstAnswerId)
    expect(result.current.messages[1].text).toBe("new answer")
    // The transport saw the truncated transcript: the edited turn is the last one.
    expect(calls[1].messages.map((message) => message.id)).toEqual([userMessageId])
  })

  it("surfaces a route failure as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not signed in" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
      )
    )
    const { result } = renderHook(() => useChatStream({}))

    await act(async () => {
      await result.current.send("hi")
    })

    expect(result.current.status).toBe("error")
    expect(result.current.error).toBe("not signed in")
  })

  it("adopts the conversation id the server returns and sends it next time", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        sseResponse(completeTurnChunks(), { "X-Conversation-Id": "conv-1" })
    )
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useChatStream({}))

    await act(async () => {
      await result.current.send("first")
    })
    expect(result.current.conversationId).toBe("conv-1")

    await act(async () => {
      await result.current.send("second")
    })
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      conversationId?: string
    }
    expect(secondBody.conversationId).toBe("conv-1")
  })

  it("keeps the current conversation id when the response has no header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(completeTurnChunks())))
    const { result } = renderHook(() => useChatStream({ conversationId: "conv-existing" }))

    await act(async () => {
      await result.current.send("hi")
    })

    expect(result.current.conversationId).toBe("conv-existing")
  })

  it("leaves a null conversation id alone when the response has no header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(completeTurnChunks())))
    const { result } = renderHook(() => useChatStream({}))

    await act(async () => {
      await result.current.send("hi")
    })

    expect(result.current.conversationId).toBeNull()
  })

  it("loads a stored transcript by replacing the one on screen, not appending", async () => {
    const { transport } = scriptedTransport(() => completeTurnChunks("live answer"))
    const { result } = renderHook(() => useChatStream({ transport }))

    await act(async () => {
      await result.current.send("live question")
    })
    expect(result.current.messages).toHaveLength(2)

    act(() => {
      result.current.loadConversation("conv-loaded", transcriptToUIMessages(STORED_ROWS))
    })

    expect(result.current.messages.map((message) => [message.id, message.role, message.text])).toEqual(
      [
        ["s1", "user", "Who is Bourbon?"],
        ["s2", "assistant", "A member of the Black Organization."],
      ]
    )
    expect(result.current.conversationId).toBe("conv-loaded")
  })

  it("returns to idle and un-marks a stopped turn when a transcript is loaded", async () => {
    const { transport, push } = controllableTransport()
    const { result } = renderHook(() => useChatStream({ transport }))

    let sending: Promise<void> = Promise.resolve()
    await act(async () => {
      sending = result.current.send("hello")
    })
    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "partial" })
    })
    await act(async () => {
      result.current.stop()
      await sending
    })

    expect(result.current.status).toBe("stopped")
    expect(result.current.messages.at(-1)?.state).toEqual({ kind: "stopped" })

    act(() => {
      result.current.loadConversation("conv-loaded", transcriptToUIMessages(STORED_ROWS))
    })

    // `stopped` is the hook's own flag and names the last assistant turn, so it
    // must not survive a load: the loaded final answer was never stopped.
    expect(result.current.status).toBe("idle")
    expect(result.current.messages.at(-1)?.state).toEqual({ kind: "complete" })
  })

  it("posts a turn sent after a load with the loaded conversation id", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => sseResponse(completeTurnChunks())
    )
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useChatStream({}))

    // Load and send in the same tick: the transport reads the id from a ref, and
    // a state update has not committed by the time the turn is prepared.
    await act(async () => {
      result.current.loadConversation("conv-loaded", transcriptToUIMessages(STORED_ROWS))
      await result.current.send("follow up")
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      message: string
      history: { role: string; content: string }[]
      conversationId?: string
    }
    expect(body.conversationId).toBe("conv-loaded")
    expect(body.message).toBe("follow up")
    // The loaded transcript is the history the route is told about.
    expect(body.history).toEqual([
      { role: "user", content: "Who is Bourbon?" },
      { role: "assistant", content: "A member of the Black Organization." },
    ])
  })
})
