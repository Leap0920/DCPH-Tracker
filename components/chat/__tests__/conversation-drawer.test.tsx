import * as React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import {
  ConversationDrawer,
  type ConversationSummary,
  type TranscriptMessage,
} from "@/components/chat/ConversationDrawer"

/**
 * The drawer as a reader meets it: the server's list, the states around it, and
 * the two writes it can make — open one thread, archive another.
 *
 * The clock is pinned because `timeAgo` reads `Date.now()`; a relative-time
 * assertion against the wall clock would flip at a minute or hour boundary. Only
 * `Date` is mocked (`vi.setSystemTime` without fake timers), so `userEvent` and
 * `waitFor` keep real timers and nothing here can hang on a faked one.
 *
 * Every request is answered by a stubbed `fetch`; no test touches a socket.
 */

const NOW = Date.parse("2026-09-20T12:00:00.000Z")
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const EPISODE_THEORIES: ConversationSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Episode 1000 theories",
  messageCount: 12,
  lastMessageAt: NOW - 3 * HOUR,
  archivedAt: null,
}

const UNTITLED_THREAD: ConversationSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  title: null,
  messageCount: 1,
  lastMessageAt: NOW - 2 * DAY,
  archivedAt: null,
}

const BOURBON: ConversationSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Bourbon trivia",
  messageCount: 5,
  lastMessageAt: NOW - 30 * MINUTE,
  archivedAt: null,
}

const TRANSCRIPT: TranscriptMessage[] = [
  { id: "m1", role: "user", content: "Who is Bourbon?", createdAt: NOW - MINUTE },
  { id: "m2", role: "assistant", content: "A member of the Black Organization.", createdAt: NOW - 30_000 },
]

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubFetch(handler: FetchFn): Mock<FetchFn> {
  const fetchMock = vi.fn<FetchFn>(handler)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** The route's three calls, answered as the real one answers them. */
function route(): Mock<FetchFn> {
  return stubFetch(async (input, init) => {
    const url = String(input)
    if (init?.method === "DELETE") return jsonResponse({ archived: true })
    if (url.includes("?id=")) {
      return jsonResponse({
        id: BOURBON.id,
        title: BOURBON.title,
        summary: null,
        messages: TRANSCRIPT,
      })
    }
    return jsonResponse({ conversations: [EPISODE_THEORIES, UNTITLED_THREAD, BOURBON] })
  })
}

function deletes(fetchMock: Mock<FetchFn>) {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE")
}

/**
 * A controlled drawer plus the trigger that reopens it, because closing and
 * reopening is how a reader reaches a second list load.
 */
function Harness({
  activeConversationId = null,
  onSelect = () => {},
}: {
  activeConversationId?: string | null
  onSelect?: (loaded: { id: string; title: string | null; messages: TranscriptMessage[] }) => void
}) {
  const [open, setOpen] = React.useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open conversations
      </button>
      <ConversationDrawer
        open={open}
        onOpenChange={setOpen}
        activeConversationId={activeConversationId}
        onSelect={onSelect}
      />
    </>
  )
}

beforeEach(() => {
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("ConversationDrawer list", () => {
  it("renders each conversation with its relative time and message count", async () => {
    route()
    render(<Harness />)

    const row = await screen.findByRole("button", { name: /^Episode 1000 theories/ })
    expect(row).toHaveTextContent("3h ago")
    expect(row).toHaveTextContent("12 messages")
    expect(screen.getByRole("button", { name: /^Untitled conversation/ })).toHaveTextContent("2d ago")
    expect(screen.getByRole("button", { name: /^Bourbon trivia/ })).toHaveTextContent("30m ago")
    expect(screen.getByRole("button", { name: /^Untitled conversation/ })).toHaveTextContent("1 message")
  })

  it("falls back to an honest title when the conversation has none", async () => {
    route()
    render(<Harness />)

    expect(await screen.findByText("Untitled conversation")).toBeInTheDocument()
  })

  it("marks the conversation that is open in the chat", async () => {
    route()
    render(<Harness activeConversationId={EPISODE_THEORIES.id} />)

    expect(await screen.findByRole("button", { name: /^Episode 1000 theories/ })).toHaveAttribute(
      "aria-current",
      "true"
    )
    expect(screen.getByRole("button", { name: /^Bourbon trivia/ })).not.toHaveAttribute("aria-current")
  })

  it("does not fetch while the drawer is closed", () => {
    const fetchMock = route()
    render(<ConversationDrawer open={false} onOpenChange={() => {}} onSelect={() => {}} />)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("ConversationDrawer states", () => {
  it("shows a loading state until the list arrives", () => {
    stubFetch(() => new Promise<Response>(() => {}))
    render(<Harness />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading conversations…")
  })

  it("says there are no conversations rather than showing an error", async () => {
    stubFetch(async () => jsonResponse({ conversations: [] }))
    render(<Harness />)

    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error with a retry when the first load fails", async () => {
    let failing = true
    stubFetch(async () =>
      failing ? new Response(null, { status: 500 }) : jsonResponse({ conversations: [BOURBON] })
    )
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your conversations.")

    failing = false
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByRole("button", { name: /^Bourbon trivia/ })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps the loaded list on screen when a later load fails", async () => {
    let failing = false
    stubFetch(async () =>
      failing
        ? new Response(null, { status: 500 })
        : jsonResponse({ conversations: [EPISODE_THEORIES] })
    )
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByRole("button", { name: /^Episode 1000 theories/ })).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    failing = true
    await user.click(screen.getByRole("button", { name: "Open conversations" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your conversations.")
    expect(screen.getByRole("button", { name: /^Episode 1000 theories/ })).toBeInTheDocument()
  })
})

describe("ConversationDrawer selecting", () => {
  it("loads the transcript and hands it to onSelect", async () => {
    const fetchMock = route()
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)

    await user.click(await screen.findByRole("button", { name: /^Bourbon trivia/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(onSelect).toHaveBeenCalledWith({
      id: BOURBON.id,
      title: "Bourbon trivia",
      messages: TRANSCRIPT,
    })
    expect(fetchMock).toHaveBeenCalledWith(`/api/ai-chat/conversations?id=${BOURBON.id}`)
  })

  it("shows the row as pending while its transcript loads", async () => {
    let acceptTranscript!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      acceptTranscript = resolve
    })
    stubFetch(async (input) =>
      String(input).includes("?id=") ? pending : jsonResponse({ conversations: [BOURBON] })
    )
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: /^Bourbon trivia/ }))

    const row = screen.getByRole("button", { name: /^Bourbon trivia/ })
    expect(row).toBeDisabled()
    expect(row).toHaveAttribute("aria-busy", "true")

    acceptTranscript(
      jsonResponse({ id: BOURBON.id, title: BOURBON.title, summary: null, messages: TRANSCRIPT })
    )
    await waitFor(() => expect(screen.getByRole("button", { name: /^Bourbon trivia/ })).not.toBeDisabled())
  })
})

describe("ConversationDrawer archive", () => {
  it("asks for confirmation before sending any archive request", async () => {
    const fetchMock = route()
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Archive Bourbon trivia" }))

    expect(screen.getByText("Archive this conversation?")).toBeInTheDocument()
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it("removes the row at once and archives the right conversation", async () => {
    let acceptArchive!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      acceptArchive = resolve
    })
    const fetchMock = stubFetch(async (_input, init) =>
      init?.method === "DELETE" ? pending : jsonResponse({ conversations: [BOURBON] })
    )
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Archive Bourbon trivia" }))
    await user.click(screen.getByRole("button", { name: "Archive" }))

    // The request is still open and the row is already gone.
    expect(screen.queryByRole("button", { name: /^Bourbon trivia/ })).not.toBeInTheDocument()
    expect(deletes(fetchMock).map((call) => String(call[0]))).toEqual([
      `/api/ai-chat/conversations?id=${BOURBON.id}`,
    ])

    acceptArchive(jsonResponse({ archived: true }))
    await waitFor(() => expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument())
  })

  it("puts the row back and says so when the archive fails", async () => {
    stubFetch(async (_input, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 500 })
        : jsonResponse({ conversations: [BOURBON, EPISODE_THEORIES] })
    )
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Archive Bourbon trivia" }))
    await user.click(screen.getByRole("button", { name: "Archive" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not archive that conversation.")
    expect(screen.getByRole("button", { name: /^Bourbon trivia/ })).toBeInTheDocument()
  })
})

describe("ConversationDrawer keyboard", () => {
  it("closes on Escape", async () => {
    route()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<ConversationDrawer open onOpenChange={onOpenChange} onSelect={() => {}} />)

    expect(await screen.findByRole("button", { name: /^Bourbon trivia/ })).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
