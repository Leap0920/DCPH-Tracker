import * as React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { MemoryPanel, type MemoryFactView } from "@/components/chat/MemoryPanel"

/**
 * The panel as a reader meets it: the server's facts, the states around them,
 * and the one write it can make — delete a fact, for real.
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

const FAVORITE_CHARACTER: MemoryFactView = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "preference",
  key: "favorite_character",
  value: "Bourbon",
  confidence: 0.9,
  lastConfirmedAt: NOW - 3 * HOUR,
  status: "active",
}

const WATCH_PROGRESS: MemoryFactView = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "progress",
  key: "watch_progress",
  value: "Episode 1000",
  confidence: 0.7,
  lastConfirmedAt: NOW - 2 * DAY,
  status: "superseded",
}

const ANSWER_STYLE: MemoryFactView = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "preference",
  key: "answer_style",
  value: "short answers",
  confidence: 0.55,
  lastConfirmedAt: NOW - 30 * MINUTE,
  status: "expired",
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubFetch(handler: FetchFn): Mock<FetchFn> {
  const fetchMock = vi.fn<FetchFn>(handler)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** `GET` as the route answers it; `DELETE` succeeds unless a test says otherwise. */
function route(
  facts: MemoryFactView[] = [FAVORITE_CHARACTER, WATCH_PROGRESS],
  overrides: Record<string, unknown> = {}
): Mock<FetchFn> {
  return stubFetch(async (_input, init) => {
    if (init?.method === "DELETE") return jsonResponse({ deleted: true })
    return jsonResponse({ facts, cap: 50, memoryEnabled: true, ...overrides })
  })
}

function deletes(fetchMock: Mock<FetchFn>) {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE")
}

/** The row for a key, found by the button that deletes it. */
function rowFor(key: string): HTMLElement {
  const row = screen.getByRole("button", { name: `Delete ${key}` }).closest("li")
  if (row === null) throw new Error(`No row rendered for ${key}`)
  return row as HTMLElement
}

/**
 * A controlled panel plus the trigger that reopens it, because closing and
 * reopening is how a reader reaches a second list load.
 */
function Harness() {
  const [open, setOpen] = React.useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open memories
      </button>
      <MemoryPanel open={open} onOpenChange={setOpen} />
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

describe("MemoryPanel list", () => {
  it("renders each fact with its text, kind, confidence and age", async () => {
    route()
    render(<Harness />)

    await screen.findByText("favorite_character")
    const row = rowFor("favorite_character")
    expect(row).toHaveTextContent("Bourbon")
    expect(row).toHaveTextContent("preference")
    expect(row).toHaveTextContent("90%")
    // The time is when the fact was last confirmed, and it is labelled as such.
    expect(row).toHaveTextContent("last confirmed 3h ago")

    expect(rowFor("watch_progress")).toHaveTextContent("2d ago")
    expect(rowFor("watch_progress")).toHaveTextContent("70%")
  })

  it("marks an active fact as in use and a non-active one as no longer used", async () => {
    route([FAVORITE_CHARACTER, WATCH_PROGRESS, ANSWER_STYLE])
    render(<Harness />)

    await waitFor(() => expect(rowFor("favorite_character")).toHaveTextContent("In use"))
    expect(rowFor("watch_progress")).toHaveTextContent("No longer used (superseded)")
    expect(rowFor("answer_style")).toHaveTextContent("No longer used (expired)")

    // The stored-but-unused rows are never hidden: they are what the reader audits.
    expect(screen.getByText("Episode 1000")).toBeInTheDocument()
    expect(screen.getByText("short answers")).toBeInTheDocument()
  })

  it("does not fetch while the panel is closed", () => {
    const fetchMock = route()
    render(<MemoryPanel open={false} onOpenChange={() => {}} />)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("MemoryPanel states", () => {
  it("shows a loading state until the facts arrive", () => {
    stubFetch(() => new Promise<Response>(() => {}))
    render(<Harness />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading what the bot remembers…")
  })

  it("says the bot is remembering nothing yet rather than showing an error", async () => {
    route([])
    render(<Harness />)

    expect(await screen.findByText(/not remembering anything about you yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an error with a retry when the first load fails", async () => {
    let failing = true
    stubFetch(async () =>
      failing
        ? new Response(null, { status: 500 })
        : jsonResponse({ facts: [FAVORITE_CHARACTER], cap: 50, memoryEnabled: true })
    )
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load what the bot remembers.")

    failing = false
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("favorite_character")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps the loaded list on screen when a later load fails", async () => {
    let failing = false
    stubFetch(async () =>
      failing
        ? new Response(null, { status: 500 })
        : jsonResponse({ facts: [FAVORITE_CHARACTER], cap: 50, memoryEnabled: true })
    )
    const user = userEvent.setup()
    render(<Harness />)

    expect(await screen.findByText("favorite_character")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    failing = true
    await user.click(screen.getByRole("button", { name: "Open memories" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load what the bot remembers.")
    expect(screen.getByText("favorite_character")).toBeInTheDocument()
  })

  it("says memory is off and still lists the facts already stored", async () => {
    route([FAVORITE_CHARACTER], { memoryEnabled: false })
    render(<Harness />)

    expect(await screen.findByText(/memory is off for this deployment/i)).toBeInTheDocument()
    expect(screen.getByText("favorite_character")).toBeInTheDocument()
  })

  it("makes no claim about memory when the response predates the field", async () => {
    const body = { facts: [FAVORITE_CHARACTER], cap: 50 }
    stubFetch(async () => jsonResponse(body))
    render(<Harness />)

    expect(await screen.findByText("favorite_character")).toBeInTheDocument()
    expect(screen.queryByText(/memory is off/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not remembering anything/i)).not.toBeInTheDocument()
  })

  it("says the list is capped rather than presenting it as everything stored", async () => {
    route([FAVORITE_CHARACTER, WATCH_PROGRESS], { cap: 2 })
    render(<Harness />)

    expect(await screen.findByText(/capped at 2/i)).toBeInTheDocument()
  })
})

describe("MemoryPanel delete", () => {
  it("asks for confirmation before sending any delete request", async () => {
    const fetchMock = route()
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Delete favorite_character" }))

    expect(screen.getByText("Delete this fact?")).toBeInTheDocument()
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it("removes the row at once and deletes the right fact", async () => {
    let acceptDelete!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      acceptDelete = resolve
    })
    const fetchMock = stubFetch(async (_input, init) =>
      init?.method === "DELETE"
        ? pending
        : jsonResponse({ facts: [FAVORITE_CHARACTER, WATCH_PROGRESS], cap: 50, memoryEnabled: true })
    )
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Delete favorite_character" }))
    await user.click(screen.getByRole("button", { name: "Delete" }))

    // The request is still open and the row is already gone.
    expect(screen.queryByText("favorite_character")).not.toBeInTheDocument()
    expect(deletes(fetchMock).map((call) => String(call[0]))).toEqual([
      `/api/ai-chat/memory?id=${FAVORITE_CHARACTER.id}`,
    ])

    acceptDelete(jsonResponse({ deleted: true }))
    await waitFor(() => expect(screen.getByText("watch_progress")).toBeInTheDocument())
    expect(screen.queryByText("favorite_character")).not.toBeInTheDocument()
  })

  it("puts the row back and says so when the delete fails", async () => {
    stubFetch(async (_input, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 500 })
        : jsonResponse({ facts: [FAVORITE_CHARACTER, WATCH_PROGRESS], cap: 50, memoryEnabled: true })
    )
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(await screen.findByRole("button", { name: "Delete favorite_character" }))
    await user.click(screen.getByRole("button", { name: "Delete" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete that fact.")
    expect(screen.getByText("favorite_character")).toBeInTheDocument()
  })
})

describe("MemoryPanel keyboard", () => {
  it("closes on Escape", async () => {
    route()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<MemoryPanel open onOpenChange={onOpenChange} />)

    expect(await screen.findByText("favorite_character")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
