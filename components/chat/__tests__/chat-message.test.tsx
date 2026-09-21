import * as React from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PROTOCOL_VERSION, type ActivityPart } from "@/lib/ai/stream/protocol"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import type { ChatMessageView } from "@/components/chat/useChatStream"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { FeedbackControls } from "@/components/chat/FeedbackControls"
import { DEGRADE_WORDING } from "@/components/chat/ActivityTrace"

/**
 * The message as the reader meets it, in both shapes.
 *
 * The legacy describe pins the `{ message, isStreaming }` caller's rendering —
 * the exact class names included — because `ChatWidget` still calls it that way
 * (C23) and a change there would be a break the widget's own tests cannot see.
 * The parts describe drives the view model the hook produces, including the two
 * absent-part cases (`activity === null`, `citations === null`) that are normal
 * rather than errors, and the v1 shape that is text alone.
 *
 * Every feedback test stubs `fetch`: the dom project has no `.env.local`, and a
 * component test must never reach a socket.
 */

const RET: EvidenceRef = { n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }
const CONV: EvidenceRef = { n: 3, id: "conv-1", tag: "[CONV]", label: "Earlier in this conversation" }
const REFS: EvidenceRef[] = [RET, CONV]
const REPORT: CitationReport = { cited: REFS, unknown: [], valid: true, uncited: false }

const ACTIVITY: ActivityPart = {
  protocol: PROTOCOL_VERSION,
  planSource: "router",
  tools: ["search_catalog"],
  timings: { planMs: 10, retrieveMs: 100, assembleMs: 5 },
}

function view(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: "a1",
    role: "assistant",
    text: "An answer.",
    refs: [],
    activity: null,
    degraded: [],
    citations: null,
    state: { kind: "complete" },
    ...overrides,
  }
}

function okResponse(value: 1 | -1): Response {
  return new Response(JSON.stringify({ recorded: true, value }), { status: 200 })
}

describe("ChatMessage legacy shape", () => {
  it("renders the { message, isStreaming } caller unchanged", () => {
    const { container } = render(
      <ChatMessage message={{ id: "m1", role: "assistant", content: "Hello **world**" }} />
    )

    const wrapper = container.firstChild as HTMLElement
    const bubble = wrapper.firstElementChild as HTMLElement
    expect(wrapper.className).toBe("group flex flex-col w-full items-start")
    expect(bubble.className).toBe(
      "max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed break-words border-line bg-surface-muted text-ink rounded-bl-md"
    )
    expect(screen.getByText("world").tagName).toBe("STRONG")
    expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument()
  })

  it("renders a user turn against the right edge with no controls", () => {
    const { container } = render(
      <ChatMessage message={{ id: "u1", role: "user", content: "hi" }} />
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toBe("group flex flex-col w-full items-end")
    expect((wrapper.firstElementChild as HTMLElement).className).toBe(
      "max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed break-words border-accent/30 bg-accent/15 text-ink rounded-br-md"
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("adds no parts sections the legacy caller did not ask for", () => {
    render(<ChatMessage message={{ id: "m1", role: "assistant", content: "plain" }} />)

    expect(screen.queryByRole("list", { name: "Sources cited" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Show details/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Good answer" })).not.toBeInTheDocument()
  })

  it("renders typing dots for a streaming legacy message with no text yet", () => {
    render(<ChatMessage message={{ id: "m1", role: "assistant", content: "" }} isStreaming />)

    expect(screen.getByLabelText("DCPH Bot is typing")).toBeInTheDocument()
  })
})

describe("ChatMessage parts", () => {
  it("renders the answer text with its markdown treatment", () => {
    render(<ChatMessage view={view({ text: "Hello **world**\n\n- first item" })} />)

    expect(screen.getByText("world").tagName).toBe("STRONG")
    expect(screen.getByText("first item")).toBeInTheDocument()
  })

  it("renders chips from the citation report and none when it is null", () => {
    const first = render(<ChatMessage view={view({ refs: REFS, citations: REPORT })} />)
    expect(screen.getByRole("button", { name: "Episode 1" })).toBeInTheDocument()
    first.unmount()

    render(<ChatMessage view={view({ refs: REFS, citations: null })} />)
    expect(screen.queryByRole("list", { name: "Sources cited" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Episode 1" })).not.toBeInTheDocument()
  })

  it("renders the activity trace when activity exists and nothing when it is null", () => {
    const first = render(<ChatMessage view={view({ activity: ACTIVITY })} />)
    expect(screen.getByRole("button", { name: /Show details/ })).toBeInTheDocument()
    first.unmount()

    render(<ChatMessage view={view({ activity: null })} />)
    expect(screen.queryByRole("button", { name: /Show details/ })).not.toBeInTheDocument()
  })

  it("opens the sources panel at the ref a chip was clicked for", async () => {
    const user = userEvent.setup()
    render(<ChatMessage view={view({ refs: REFS, citations: REPORT })} />)

    await user.click(screen.getByRole("button", { name: "Earlier in this conversation" }))

    const panel = screen.getByRole("complementary")
    const item = within(panel).getByText("Earlier in this conversation").closest("li")
    expect(item).toHaveAttribute("aria-current", "true")
    expect(within(panel).getByText("Episode 1")).toBeInTheDocument()
  })

  it("says so when the reader stopped the answer", () => {
    render(<ChatMessage view={view({ text: "partial answer", state: { kind: "stopped" } })} />)

    expect(screen.getByText(/stopped/i)).toBeInTheDocument()
    expect(screen.getByText("partial answer")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Good answer" })).not.toBeInTheDocument()
  })

  it("shows the synthetic state badge with the message text unchanged", () => {
    const text = "I'm being rate-limited right now. Please try again in a moment."
    render(
      <ChatMessage
        view={view({
          text,
          degraded: ["rate_limited"],
          state: { kind: "synthetic", reason: "rate_limited" },
        })}
      />
    )

    expect(screen.getByText(DEGRADE_WORDING.rate_limited)).toBeInTheDocument()
    expect(screen.getByText(text).textContent).toBe(text)
  })

  it("says a synthetic state once, not from the trace too (C24)", () => {
    render(
      <ChatMessage
        view={view({
          text: "I'm being rate-limited right now.",
          degraded: ["rate_limited", "uncited"],
          activity: ACTIVITY,
          state: { kind: "synthetic", reason: "rate_limited" },
        })}
      />
    )

    expect(screen.getAllByText(DEGRADE_WORDING.rate_limited)).toHaveLength(1)
    expect(screen.getAllByText(DEGRADE_WORDING.uncited)).toHaveLength(1)
    const state = screen.getByRole("list", { name: "Answer state" })
    expect(within(state).queryByText(DEGRADE_WORDING.rate_limited)).not.toBeInTheDocument()
    expect(within(state).getByText(DEGRADE_WORDING.uncited)).toBeInTheDocument()
  })

  it("renders a text-only message as a finished answer (v1)", () => {
    render(<ChatMessage view={view({ text: "v1 answer" })} />)

    expect(screen.getByText("v1 answer")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Sources cited" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Show details/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/degraded/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Good answer" })).toBeInTheDocument()
  })

  it("renders the v1 activity shape as finished, with no evidence", () => {
    render(
      <ChatMessage
        view={view({
          text: "v1 answer",
          activity: {
            protocol: PROTOCOL_VERSION,
            planSource: null,
            tools: [],
            timings: { planMs: null, retrieveMs: 8, assembleMs: null },
          },
        })}
      />
    )

    expect(screen.getByText("v1 answer")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /no steps/ })).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Sources cited" })).not.toBeInTheDocument()
  })

  it("hides the feedback controls while the message is streaming", () => {
    render(<ChatMessage view={view({ text: "partial", state: { kind: "streaming" } })} />)

    expect(screen.queryByRole("button", { name: "Good answer" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Bad answer" })).not.toBeInTheDocument()
  })

  it("offers feedback once the message is complete", () => {
    render(<ChatMessage view={view({ text: "done" })} />)

    expect(screen.getByRole("button", { name: "Good answer" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bad answer" })).toBeInTheDocument()
  })
})

describe("FeedbackControls", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("selects optimistically and keeps the vote when the route accepts it", async () => {
    let accept!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      accept = resolve
    })
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => pending
    )
    vi.stubGlobal("fetch", fetchMock)

    const user = userEvent.setup()
    render(<FeedbackControls messageId="a1" />)

    await user.click(screen.getByRole("button", { name: "Good answer" }))
    // The request is still open, and the thumb is already lit.
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    accept(okResponse(1))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Good answer" })).not.toBeDisabled()
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai-chat/feedback",
      expect.objectContaining({ method: "POST" })
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messageId: string
      value: number
    }
    expect(body).toEqual({ messageId: "a1", value: 1 })
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("rolls the vote back and surfaces an error when the route refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () => new Response(JSON.stringify({ error: "no" }), { status: 500 })
      )
    )
    const user = userEvent.setup()
    render(<FeedbackControls messageId="a1" />)

    await user.click(screen.getByRole("button", { name: "Good answer" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
        "aria-pressed",
        "false"
      )
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Could not record your feedback.")
  })

  it("replaces the first vote with a second without a reload", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => okResponse(1)
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    render(<FeedbackControls messageId="a1" />)

    await user.click(screen.getByRole("button", { name: "Good answer" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )

    await user.click(screen.getByRole("button", { name: "Bad answer" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bad answer" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )

    const values = fetchMock.mock.calls.map(
      (call) => (JSON.parse(String(call[1]?.body)) as { value: number }).value
    )
    expect(values).toEqual([1, -1])
  })

  it("disables both thumbs while a vote is in flight", async () => {
    let accept!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      accept = resolve
    })
    vi.stubGlobal("fetch", vi.fn(() => pending))
    const user = userEvent.setup()
    render(<FeedbackControls messageId="a1" />)

    await user.click(screen.getByRole("button", { name: "Good answer" }))

    expect(screen.getByRole("button", { name: "Good answer" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Bad answer" })).toBeDisabled()

    accept(okResponse(1))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bad answer" })).not.toBeDisabled()
    )
  })

  it("posts the vote for the message it was rendered with", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => okResponse(1)
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    render(<ChatMessage view={view({ id: "msg-42", text: "done" })} />)

    await user.click(screen.getByRole("button", { name: "Good answer" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messageId: string }
    expect(body.messageId).toBe("msg-42")
  })
})
