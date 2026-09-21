import * as React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import { PARTS, PROTOCOL_VERSION } from "@/lib/ai/stream/protocol"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import { ChatWidget } from "@/components/chat/ChatWidget"

/**
 * The widget as the reader drives it: open the panel, send a turn, stop it,
 * regenerate it, edit it.
 *
 * Every transport here is scripted and the two collaborators that would reach
 * outside the test — Supabase's browser client and the auth modal — are mocked,
 * because the dom project has no `.env.local` and a component test must never
 * touch a socket. `ChatWidget`'s `transport` prop is the seam the send/stop/
 * regenerate/edit tests drive; only the error test uses the real default
 * transport, and it stubs `fetch` for the one request it makes.
 */

// jsdom implements no layout and no scrolling: `Element.prototype.scrollTo` does
// not exist at all, and the widget's scroll-to-bottom effect calls it on every
// transcript change. A no-op is the honest stub — the effect's contract here is
// only that it does not throw.
Element.prototype.scrollTo = () => {}

// `vi.hoisted` because the two `vi.mock` factories below are hoisted above the
// imports and would otherwise close over bindings still in their temporal dead
// zone when the mocked module is first imported.
const mocks = vi.hoisted(() => ({
  /** What `createClient().auth.getUser()` resolves with, per test. */
  user: null as { id: string } | null,
  openAuthModal: vi.fn(),
}))

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))

vi.mock("@/lib/auth-modal", () => ({
  openAuthModal: mocks.openAuthModal,
}))

type Part = UIMessage["parts"][number]
type User = ReturnType<typeof userEvent.setup>

const REF: EvidenceRef = { n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }
const REPORT: CitationReport = { cited: [REF], unknown: [], valid: true, uncited: false }

function dataPart(type: `data-${string}`, data: unknown): Part {
  return { type, data }
}

/** A whole turn, parts and all, as the route emits it. */
function completeTurnChunks(delta: string): UIMessageChunk[] {
  return [
    dataPart(PARTS.activity, {
      protocol: PROTOCOL_VERSION,
      planSource: "router",
      tools: ["search_catalog"],
      timings: { planMs: 12, retrieveMs: 34, assembleMs: 56 },
    }) as UIMessageChunk,
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

/** Render, open the panel, and hand back the user the interactions need. */
async function renderWidget(transport?: ChatTransport<UIMessage>): Promise<User> {
  const user = userEvent.setup()
  render(<ChatWidget transport={transport} />)
  await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))
  await screen.findByRole("dialog", { name: "DCPH Bot — episode finder" })
  return user
}

/** A scripted SSE response, the framing the hook's default transport parses. */
function sseResponse(chunks: UIMessageChunk[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

const DRAWER_ID = "33333333-3333-4333-8333-333333333333"

/** A stored conversation, as the route's two reads answer it. */
const DRAWER_TRANSCRIPT = [
  { id: "m1", role: "user", content: "Who is Bourbon?", createdAt: Date.now() - 60_000 },
  {
    id: "m2",
    role: "assistant",
    content: "A member of the Black Organization.",
    createdAt: Date.now() - 30_000,
  },
]

/** One fact, in the shape `GET /api/ai-chat/memory` answers with. */
const MEMORY_FACT = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "preference",
  key: "favorite_character",
  value: "Bourbon",
  confidence: 0.9,
  lastConfirmedAt: Date.now() - 3 * 60 * 60 * 1000,
  status: "active",
}

/**
 * One `fetch` for the drawer's reads, the memory panel's list and the hook's
 * chat POST. Those are the only things here that touch the network, so a single
 * stub keeps them apart by URL and lets a test watch the request body.
 */
function stubRoutes(chatChunks: UIMessageChunk[] = completeTurnChunks("live answer")) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/api/ai-chat/memory")) {
      return jsonResponse({ facts: [MEMORY_FACT], cap: 50, memoryEnabled: true })
    }
    if (url.includes("/api/ai-chat/conversations")) {
      if (url.includes("?id=")) {
        return jsonResponse({ id: DRAWER_ID, title: "Bourbon trivia", messages: DRAWER_TRANSCRIPT })
      }
      return jsonResponse({
        conversations: [
          {
            id: DRAWER_ID,
            title: "Bourbon trivia",
            messageCount: 2,
            lastMessageAt: Date.now() - 30_000,
            archivedAt: null,
          },
        ],
      })
    }
    return sseResponse(chatChunks)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** The chat POSTs among the stub's calls, newest last. */
function chatBodies(fetchMock: ReturnType<typeof stubRoutes>) {
  return fetchMock.mock.calls
    .filter((call) => {
      const url = String(call[0])
      return url.includes("/api/ai-chat") && !url.includes("conversations") && !url.includes("memory")
    })
    .map((call) => JSON.parse(String(call[1]?.body)) as { conversationId?: string })
}

/** Open the drawer from its header control and wait for the server's list. */
async function openDrawer(user: User): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Your conversations" }))
  await screen.findByRole("dialog", { name: "Conversations" })
  await screen.findByRole("button", { name: /^Bourbon trivia/ })
}

/** Type a turn into the composer and send it. */
async function sendText(user: User, text: string): Promise<void> {
  const box = screen.getByRole("textbox", { name: /ask about detective conan episodes/i })
  await user.type(box, text)
  await user.click(screen.getByRole("button", { name: "Send message" }))
}

/**
 * Tabs forward until `target` holds focus, so a test asserts that a control is
 * keyboard-reachable rather than a fixed tab count. The same helper as
 * `a11y.test.tsx`: the counts differ between the inline and modal shapes, and
 * Radix's trap owns the order inside a dialog.
 */
async function tabTo(user: User, target: HTMLElement, limit = 12): Promise<void> {
  for (let i = 0; i < limit && document.activeElement !== target; i += 1) {
    await user.tab()
  }
  expect(target).toHaveFocus()
}

/**
 * Open the panel with the keyboard alone. Every test in the keyboard-only block
 * starts here: a launcher that only opens under a pointer would be the failure
 * the block exists to catch.
 */
async function openPanelWithKeyboard(user: User): Promise<void> {
  const launcher = screen.getByRole("button", { name: "Open DCPH Bot" })
  await tabTo(user, launcher)
  await user.keyboard("{Enter}")
  await screen.findByRole("dialog", { name: "DCPH Bot — episode finder" })
}

beforeEach(() => {
  mocks.user = { id: "user-1" }
  mocks.openAuthModal.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("the launcher and the panel", () => {
  it("toggles the panel from the launcher", async () => {
    const user = userEvent.setup()
    render(<ChatWidget />)

    const launcher = screen.getByRole("button", { name: "Open DCPH Bot" })
    expect(launcher).toHaveAttribute("aria-expanded", "false")
    // The 3.25rem square is an inline style, not a class.
    expect(launcher.style.height).toBe("3.25rem")
    expect(launcher.style.width).toBe("3.25rem")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(launcher)

    expect(screen.getByRole("button", { name: "Close DCPH Bot" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })

  it("keeps the panel's dialog contract and its enter transition", async () => {
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))

    const dialog = await screen.findByRole("dialog", { name: "DCPH Bot — episode finder" })
    expect(dialog).toHaveAttribute("aria-modal", "false")

    const tokens = new Set(dialog.className.split(/\s+/).filter(Boolean))
    expect(tokens.has("fixed")).toBe(true)
    expect(tokens.has("bottom-5")).toBe(true)
    expect(tokens.has("right-5")).toBe(true)
    expect(tokens.has("w-[min(26rem,calc(100vw-1.5rem))]")).toBe(true)
    // `dvh` is the dynamic viewport height, so the height tracks the visible
    // area when the on-screen keyboard shrinks it; the old `vh` unit did not.
    expect(tokens.has("h-[min(34rem,calc(100dvh-6rem))]")).toBe(true)

    // `mounted` flips on the next frame, which is the enter transition.
    await waitFor(() => expect(dialog.className).toContain("translate-y-0"))
    expect(dialog.className).toContain("opacity-100")
  })

  it("anchors the panel to the visible bottom with a dynamic-viewport height", async () => {
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))

    const dialog = await screen.findByRole("dialog", { name: "DCPH Bot — episode finder" })
    const tokens = new Set(dialog.className.split(/\s+/).filter(Boolean))

    // `bottom-5` is the anchor: the panel is fixed to the bottom edge, so when
    // the on-screen keyboard shrinks the viewport the composer stays at the
    // bottom of the visible area.
    expect(tokens.has("bottom-5")).toBe(true)
    // The height is a dynamic viewport unit, not `vh`, so it tracks the visible
    // area on its own rather than relying solely on `interactiveWidget:
    // "resizes-content"` in app/layout.tsx, which a browser may ignore.
    expect([...tokens].some((token) => token.includes("100dvh"))).toBe(true)
    expect([...tokens].some((token) => token.includes("100vh"))).toBe(false)
  })

  it("keeps the drawer and the memory panel as full-height sheets", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await openDrawer(user)
    const drawer = screen.getByRole("dialog", { name: "Conversations" })
    // `h-dvh` makes the sheet the dynamic viewport and `top-0`/`translate-y-0`
    // pins it; the centring pair returns at `sm`. The full sheet contract,
    // including the modal sources panel, is pinned in responsive.test.tsx.
    expect(drawer.className).toContain("h-dvh")
    expect(drawer.className).toContain("top-0")

    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument()
    )

    await user.click(screen.getByRole("button", { name: "What the bot remembers" }))
    const memory = await screen.findByRole("dialog", { name: "What the bot remembers" })
    expect(memory.className).toContain("h-dvh")
    expect(memory.className).toContain("top-0")
  })
})

describe("the signed-out gate", () => {
  it("renders the gate and opens the sign-in modal from its control", async () => {
    mocks.user = null
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))

    expect(await screen.findByText("Member Access Only")).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: /ask about detective conan episodes/i })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Sign In to Chat" }))

    expect(mocks.openAuthModal).toHaveBeenCalledWith("signin")
  })
})

describe("the greeting and the suggestion chips", () => {
  it("renders the greeting as a static intro, not as a message", async () => {
    await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    // Present, and not rendered through ChatMessage: a message with text would
    // carry the copy control, and the transcript has no turns at all yet.
    expect(screen.getByText(/your assistant for Detective Conan episodes/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Copy response" })).not.toBeInTheDocument()
  })

  it("shows the suggestion chips only while the conversation is fresh", async () => {
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("Hello world")).transport)

    expect(screen.getByText("Suggested questions:")).toBeInTheDocument()

    await sendText(user, "hi")
    await screen.findByText("Hello world")

    expect(screen.queryByText("Suggested questions:")).not.toBeInTheDocument()
  })
})

describe("sending a turn", () => {
  it("shows the reader's turn and an assistant placeholder before any delta", async () => {
    const { transport, push } = controllableTransport()
    const user = await renderWidget(transport)

    await sendText(user, "Who is Bourbon?")

    expect(screen.getByText("Who is Bourbon?")).toBeInTheDocument()
    expect(await screen.findByLabelText("DCPH Bot is typing")).toBeInTheDocument()

    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is Rei Furuya." })
    })

    expect(screen.getByText("Bourbon is Rei Furuya.")).toBeInTheDocument()
    // The placeholder gives way to the real message on its first part.
    expect(screen.queryByLabelText("DCPH Bot is typing")).not.toBeInTheDocument()
  })

  it("renders the settled answer through the parts path", async () => {
    const user = await renderWidget(
      scriptedTransport(() => completeTurnChunks("Bourbon is Rei Furuya.")).transport
    )

    await sendText(user, "Who is Bourbon?")
    await screen.findByText("Bourbon is Rei Furuya.")

    // The chips are built from the view model, so a chip on screen proves the
    // message was rendered with `view` rather than the legacy `{ message }`.
    expect(screen.getByRole("button", { name: "Episode 1" })).toBeInTheDocument()
    // The trace's toggle carries its summary and the action word together.
    expect(screen.getByRole("button", { name: /Show details/ })).toBeInTheDocument()
  })

  it("never sends the greeting to the server", async () => {
    const { transport, calls } = scriptedTransport(() => completeTurnChunks("Hello world"))
    const user = await renderWidget(transport)

    await sendText(user, "hi")
    await screen.findByText("Hello world")

    expect(calls).toHaveLength(1)
    expect(calls[0].messages).toHaveLength(1)
    expect(calls[0].messages[0].role).toBe("user")
    expect(JSON.stringify(calls[0].messages)).not.toContain("DCPH Bot")
  })

  it("renders the hook's error", async () => {
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
    const user = await renderWidget()

    await sendText(user, "hi")

    expect(await screen.findByText("not signed in")).toBeInTheDocument()
  })
})

describe("the live region", () => {
  it("is polite while streaming and goes quiet once the turn settles", async () => {
    const { transport, push } = controllableTransport()
    const user = await renderWidget(transport)

    // Idle: a settled transcript is a log, and its announcements are off, so a
    // screen reader does not re-read the whole conversation on every change.
    const region = screen.getByRole("log")
    expect(region).toHaveAttribute("aria-live", "off")
    expect(region).toHaveAttribute("aria-atomic", "false")

    await sendText(user, "Who is Bourbon?")
    await screen.findByLabelText("DCPH Bot is typing")

    // Streaming: polite, so the answer is announced as it arrives. The log role
    // belongs to the settled state, so it is not present mid-turn.
    expect(region).toHaveAttribute("aria-live", "polite")
    expect(region).not.toHaveAttribute("role")

    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is" })
    })
    expect(screen.getByText("Bourbon is")).toBeInTheDocument()
    expect(region).toHaveAttribute("aria-live", "polite")

    // Stopping settles the turn; the same node must go quiet, not stay polite.
    await user.click(screen.getByRole("button", { name: "Stop generating" }))

    await waitFor(() => expect(region).toHaveAttribute("aria-live", "off"))
    expect(region).toHaveAttribute("role", "log")
    expect(region).toHaveAttribute("aria-atomic", "false")
  })
})

describe("stopping and regenerating", () => {
  it("keeps the partial answer when the reader stops, and offers regenerate", async () => {
    const { transport, push } = controllableTransport()
    const user = await renderWidget(transport)

    await sendText(user, "Who is Bourbon?")
    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is" })
    })
    await screen.findByText("Bourbon is")

    await user.click(screen.getByRole("button", { name: "Stop generating" }))

    expect(screen.getByText("Bourbon is")).toBeInTheDocument()
    expect(await screen.findByText("Stopped — this answer may be incomplete.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Regenerate answer" })).toBeInTheDocument()
  })

  it("regenerates the last turn in place rather than appending", async () => {
    const { transport, calls } = scriptedTransport((_call, index) => [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: index === 0 ? "first answer" : "second answer" },
      { type: "text-end", id: "answer" },
    ])
    const user = await renderWidget(transport)

    await sendText(user, "Who is Bourbon?")
    await screen.findByText("first answer")

    await user.click(screen.getByRole("button", { name: "Regenerate answer" }))

    expect(await screen.findByText("second answer")).toBeInTheDocument()
    expect(screen.queryByText("first answer")).not.toBeInTheDocument()
    expect(calls).toHaveLength(2)
    expect(calls[1].trigger).toBe("regenerate-message")
  })

  it("offers no regenerate while the answer is still streaming", async () => {
    const { transport, push } = controllableTransport()
    const user = await renderWidget(transport)

    await sendText(user, "hi")
    await screen.findByLabelText("DCPH Bot is typing")
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).not.toBeInTheDocument()

    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "still going" })
    })

    expect(screen.getByText("still going")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Regenerate answer" })).not.toBeInTheDocument()
  })
})

describe("Escape", () => {
  it("stops a streaming answer without closing the panel", async () => {
    const { transport, push } = controllableTransport()
    const user = await renderWidget(transport)

    await sendText(user, "Who is Bourbon?")
    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is" })
    })
    await screen.findByText("Bourbon is")

    await user.keyboard("{Escape}")

    // Stopping is not closing: the panel and the partial answer it holds stay.
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
    expect(screen.getByText("Bourbon is")).toBeInTheDocument()
    expect(await screen.findByText("Stopped — this answer may be incomplete.")).toBeInTheDocument()
  })

  it("stops a turn sent from a chip, where the composer never took focus", async () => {
    const { transport } = controllableTransport()
    const user = await renderWidget(transport)

    await user.click(screen.getByRole("button", { name: /What should I watch next/ }))
    await screen.findByLabelText("DCPH Bot is typing")
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument()
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })

  it("closes the panel once nothing is streaming", async () => {
    const user = await renderWidget(
      scriptedTransport(() => completeTurnChunks("Hello world")).transport
    )

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("closes the panel from the signed-out gate, where there is no session at all", async () => {
    mocks.user = null
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))
    await screen.findByText("Member Access Only")

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

describe("editing a turn", () => {
  it("truncates the later turns and resends the edited text", async () => {
    const { transport, calls } = scriptedTransport((_call, index) => [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: index === 0 ? "original answer" : "new answer" },
      { type: "text-end", id: "answer" },
    ])
    const user = await renderWidget(transport)

    await sendText(user, "original question")
    await screen.findByText("original answer")

    await user.click(screen.getByRole("button", { name: "Edit message" }))
    const box = screen.getByRole("textbox", { name: "Edit your message" })
    await user.clear(box)
    await user.type(box, "edited question")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("new answer")).toBeInTheDocument()
    expect(screen.getByText("edited question")).toBeInTheDocument()
    expect(screen.queryByText("original answer")).not.toBeInTheDocument()
    // The transport saw the truncated transcript: the edited turn is all that is
    // left, so the server rewrites its own transcript from the normal write path.
    expect(calls).toHaveLength(2)
    expect(calls[1].messages).toHaveLength(1)
  })
})

describe("starting a new conversation", () => {
  it("clears the transcript and brings the chips back", async () => {
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("Hello world")).transport)

    await sendText(user, "hi")
    await screen.findByText("Hello world")

    await user.click(screen.getByRole("button", { name: "Start a new conversation" }))

    expect(screen.queryByText("Hello world")).not.toBeInTheDocument()
    expect(screen.queryByText("hi")).not.toBeInTheDocument()
    expect(screen.getByText("Suggested questions:")).toBeInTheDocument()
  })
})

describe("the conversation drawer", () => {
  it("offers the header control to a signed-in reader", async () => {
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    expect(screen.getByRole("button", { name: "Your conversations" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start a new conversation" })).toBeInTheDocument()
  })

  it("hides the header control from a signed-out reader", async () => {
    mocks.user = null
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))
    await screen.findByText("Member Access Only")

    expect(screen.queryByRole("button", { name: "Your conversations" })).not.toBeInTheDocument()
  })

  it("opens the drawer from the header control", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await openDrawer(user)

    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument()
  })

  it("replaces the transcript on screen rather than appending the loaded one", async () => {
    stubRoutes()
    const user = await renderWidget(
      scriptedTransport(() => completeTurnChunks("live answer")).transport
    )

    await sendText(user, "live question")
    await screen.findByText("live answer")

    await openDrawer(user)
    await user.click(screen.getByRole("button", { name: /^Bourbon trivia/ }))

    expect(await screen.findByText("A member of the Black Organization.")).toBeInTheDocument()
    expect(screen.getByText("Who is Bourbon?")).toBeInTheDocument()
    // The turn that was on screen is gone: a load replaces, it does not append.
    expect(screen.queryByText("live answer")).not.toBeInTheDocument()
    expect(screen.queryByText("live question")).not.toBeInTheDocument()
  })

  it("posts a turn sent after a selection with that conversation's id", async () => {
    const fetchMock = stubRoutes(completeTurnChunks("follow-up answer"))
    const user = await renderWidget()

    await openDrawer(user)
    await user.click(screen.getByRole("button", { name: /^Bourbon trivia/ }))
    await screen.findByText("A member of the Black Organization.")

    await sendText(user, "follow up")
    await screen.findByText("follow-up answer")

    expect(chatBodies(fetchMock).at(-1)?.conversationId).toBe(DRAWER_ID)
  })

  it("closes the drawer after a selection", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await openDrawer(user)
    await user.click(screen.getByRole("button", { name: /^Bourbon trivia/ }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument()
    )
  })

  it("lets Escape close the drawer without closing the panel", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await openDrawer(user)
    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument()
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })
})

describe("the memory panel", () => {
  /** The header control and the dialog share a name; the role tells them apart. */
  const MEMORY_CONTROL = "What the bot remembers"

  it("opens the memory panel from its header control", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    const control = screen.getByRole("button", { name: MEMORY_CONTROL })
    expect(control).toHaveAttribute("title", MEMORY_CONTROL)

    await user.click(control)

    expect(await screen.findByRole("dialog", { name: MEMORY_CONTROL })).toBeInTheDocument()
    // The list is the server's: the control opened a panel that loaded it.
    expect(await screen.findByText("favorite_character")).toBeInTheDocument()
  })

  it("hides the header control from a signed-out reader", async () => {
    mocks.user = null
    const user = userEvent.setup()
    render(<ChatWidget />)
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))
    await screen.findByText("Member Access Only")

    expect(screen.queryByRole("button", { name: MEMORY_CONTROL })).not.toBeInTheDocument()
  })

  it("lets Escape close the memory panel without closing the chat panel", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await user.click(screen.getByRole("button", { name: MEMORY_CONTROL }))
    await screen.findByRole("dialog", { name: MEMORY_CONTROL })

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: MEMORY_CONTROL })).not.toBeInTheDocument()
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })

  it("closes the memory panel with the chat panel, so no portal outlives it", async () => {
    stubRoutes()
    const user = await renderWidget(scriptedTransport(() => completeTurnChunks("x")).transport)

    await user.click(screen.getByRole("button", { name: MEMORY_CONTROL }))
    await screen.findByRole("dialog", { name: MEMORY_CONTROL })

    // The memory dialog is modal, so while it is open the panel's own controls
    // sit outside the accessibility tree and no pointer can reach them. The
    // close is dispatched straight at the button: the requirement is that
    // closing the panel takes its overlay with it, by whichever path `open`
    // became false.
    fireEvent.click(screen.getByRole("button", { name: "Close chat", hidden: true }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    // Reopening starts with the panel alone: the memory dialog did not survive
    // the panel it belonged to.
    await user.click(screen.getByRole("button", { name: "Open DCPH Bot" }))
    await screen.findByRole("dialog", { name: "DCPH Bot — episode finder" })
    expect(screen.queryByRole("dialog", { name: MEMORY_CONTROL })).not.toBeInTheDocument()
  })
})

/**
 * The widget driven by the keyboard alone. No test in this block calls
 * `.click()`: a control that only works under a pointer is the failure the block
 * exists to catch. The pointer paths keep their own coverage above.
 */
describe("the keyboard path", () => {
  it("sends a turn with Enter in the composer", async () => {
    const { transport, calls } = scriptedTransport(() => completeTurnChunks("Bourbon is Rei Furuya."))
    const user = userEvent.setup()
    render(<ChatWidget transport={transport} />)
    await openPanelWithKeyboard(user)

    const box = screen.getByRole("textbox", { name: /ask about detective conan episodes/i })
    await tabTo(user, box)
    await user.keyboard("Who is Bourbon?{Enter}")

    expect(await screen.findByText("Bourbon is Rei Furuya.")).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0].messages)).toContain("Who is Bourbon?")
  })

  it("stops a streaming turn with Escape", async () => {
    const { transport, push } = controllableTransport()
    const user = userEvent.setup()
    render(<ChatWidget transport={transport} />)
    await openPanelWithKeyboard(user)

    const box = screen.getByRole("textbox", { name: /ask about detective conan episodes/i })
    await tabTo(user, box)
    await user.keyboard("Who is Bourbon?{Enter}")
    await screen.findByLabelText("DCPH Bot is typing")

    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is" })
    })
    await screen.findByText("Bourbon is")

    await user.keyboard("{Escape}")

    expect(await screen.findByText("Stopped — this answer may be incomplete.")).toBeInTheDocument()
    // Stopping is not closing: the panel stays, and focus is still in the
    // composer, so the reader can type the next turn without a pointer.
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
    expect(document.activeElement).toBe(box)
  })

  it("reaches and fires Regenerate", async () => {
    const { transport, calls } = scriptedTransport((_call, index) => [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: index === 0 ? "first answer" : "second answer" },
      { type: "text-end", id: "answer" },
    ])
    const user = userEvent.setup()
    render(<ChatWidget transport={transport} />)
    await openPanelWithKeyboard(user)

    const box = screen.getByRole("textbox", { name: /ask about detective conan episodes/i })
    await tabTo(user, box)
    await user.keyboard("Who is Bourbon?{Enter}")
    await screen.findByText("first answer")

    // The regenerate control sits in the transcript, behind the composer in tab
    // order, so the tab wraps around the panel to reach it.
    const regenerate = screen.getByRole("button", { name: "Regenerate answer" })
    await tabTo(user, regenerate, 20)
    await user.keyboard("{Enter}")

    expect(await screen.findByText("second answer")).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    expect(calls[1].trigger).toBe("regenerate-message")
  })

  it("fires a suggestion chip", async () => {
    const { transport, calls } = scriptedTransport(() => completeTurnChunks("ok"))
    const user = userEvent.setup()
    render(<ChatWidget transport={transport} />)
    await openPanelWithKeyboard(user)

    const chip = screen.getByRole("button", { name: /What should I watch next/ })
    await tabTo(user, chip)
    await user.keyboard("{Enter}")

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.stringify(calls[0].messages)).toContain(
      "What should I watch next based on my tracker progress?"
    )
  })

  it("opens and closes the conversation drawer", async () => {
    stubRoutes()
    const user = userEvent.setup()
    render(<ChatWidget transport={scriptedTransport(() => completeTurnChunks("x")).transport} />)
    await openPanelWithKeyboard(user)

    const control = screen.getByRole("button", { name: "Your conversations" })
    await tabTo(user, control)
    await user.keyboard("{Enter}")
    await screen.findByRole("dialog", { name: "Conversations" })
    await screen.findByRole("button", { name: /^Bourbon trivia/ })

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument()
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })

  it("opens the memory panel, deletes a fact and closes it", async () => {
    const fetchMock = stubRoutes()
    const user = userEvent.setup()
    render(<ChatWidget transport={scriptedTransport(() => completeTurnChunks("x")).transport} />)
    await openPanelWithKeyboard(user)

    const control = screen.getByRole("button", { name: "What the bot remembers" })
    await tabTo(user, control)
    await user.keyboard("{Enter}")
    await screen.findByRole("dialog", { name: "What the bot remembers" })
    await screen.findByText("favorite_character")

    const remove = screen.getByRole("button", { name: "Delete favorite_character" })
    await tabTo(user, remove, 8)
    await user.keyboard("{Enter}")
    expect(screen.getByText("Delete this fact?")).toBeInTheDocument()

    const confirm = screen.getByRole("button", { name: "Delete" })
    await tabTo(user, confirm, 4)
    await user.keyboard("{Enter}")

    await waitFor(() => expect(screen.queryByText("favorite_character")).not.toBeInTheDocument())
    const deletes = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "DELETE"
    )
    expect(deletes.map((call) => String(call[0]))).toEqual([
      `/api/ai-chat/memory?id=${MEMORY_FACT.id}`,
    ])

    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "What the bot remembers" })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByRole("dialog", { name: "DCPH Bot — episode finder" })).toBeInTheDocument()
  })
})

/**
 * Focus management through its observable contract — where
 * `document.activeElement` is — never through Radix's internals.
 */
describe("focus management", () => {
  it("moves focus into the drawer and returns it to the header control that opened it", async () => {
    stubRoutes()
    const user = userEvent.setup()
    render(<ChatWidget transport={scriptedTransport(() => completeTurnChunks("x")).transport} />)
    await openPanelWithKeyboard(user)

    const control = screen.getByRole("button", { name: "Your conversations" })
    await tabTo(user, control)
    await user.keyboard("{Enter}")

    const drawer = await screen.findByRole("dialog", { name: "Conversations" })
    await waitFor(() => expect(drawer).toContainElement(document.activeElement as HTMLElement))
    expect(document.activeElement).not.toBe(control)

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument()
    )
    await waitFor(() => expect(document.activeElement).toBe(control))
  })

  it("moves focus into the memory panel and returns it to the header control that opened it", async () => {
    stubRoutes()
    const user = userEvent.setup()
    render(<ChatWidget transport={scriptedTransport(() => completeTurnChunks("x")).transport} />)
    await openPanelWithKeyboard(user)

    const control = screen.getByRole("button", { name: "What the bot remembers" })
    await tabTo(user, control)
    await user.keyboard("{Enter}")

    const panel = await screen.findByRole("dialog", { name: "What the bot remembers" })
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement))
    expect(document.activeElement).not.toBe(control)

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "What the bot remembers" })
      ).not.toBeInTheDocument()
    )
    await waitFor(() => expect(document.activeElement).toBe(control))
  })

  it("keeps focus in the composer while the placeholder and the answer render", async () => {
    const { transport, push } = controllableTransport()
    const user = userEvent.setup()
    render(<ChatWidget transport={transport} />)
    await openPanelWithKeyboard(user)

    const box = screen.getByRole("textbox", { name: /ask about detective conan episodes/i })
    await tabTo(user, box)
    await user.keyboard("Who is Bourbon?{Enter}")

    // The typing-dots stand-in must not pull focus out of the composer.
    expect(await screen.findByLabelText("DCPH Bot is typing")).toBeInTheDocument()
    expect(document.activeElement).toBe(box)

    await act(async () => {
      push({ type: "text-start", id: "answer" })
      push({ type: "text-delta", id: "answer", delta: "Bourbon is Rei Furuya." })
    })

    // Nor does the real streaming message that replaces it.
    expect(screen.getByText("Bourbon is Rei Furuya.")).toBeInTheDocument()
    expect(document.activeElement).toBe(box)
  })
})
