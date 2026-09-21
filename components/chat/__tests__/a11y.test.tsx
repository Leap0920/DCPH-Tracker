import * as React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi, type Mock } from "vitest"
import { join } from "node:path"
import { PROTOCOL_VERSION, type ActivityPart } from "@/lib/ai/stream/protocol"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import { ActivityTrace } from "@/components/chat/ActivityTrace"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { CitationChips } from "@/components/chat/CitationChips"
import {
  ConversationDrawer,
  type ConversationSummary,
  type TranscriptMessage,
} from "@/components/chat/ConversationDrawer"
import { MemoryPanel, type MemoryFactView } from "@/components/chat/MemoryPanel"
import { SourcesPanel } from "@/components/chat/SourcesPanel"

/**
 * The chat components as a keyboard and a screen reader meet them.
 *
 * Every path here is driven with `user-event` keys alone — no test in this file
 * calls `.click()`, because a control that only works under a pointer is the
 * failure this file exists to catch. Send and stop already have their own
 * coverage in `chat-input.test.tsx` and are not repeated.
 *
 * Focus management is asserted through its observable contract (where
 * `document.activeElement` is), never through Radix's internals.
 */

const RET: EvidenceRef = { n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }
const CONV: EvidenceRef = { n: 3, id: "conv-1", tag: "[CONV]", label: "Earlier in this conversation" }
const REFS: EvidenceRef[] = [RET, CONV]
/** Cites E1 and E3; E9 is fabricated, so the chip list has three entries. */
const REPORT: CitationReport = { cited: [RET, CONV], unknown: [9], valid: false, uncited: false }

const ACTIVITY: ActivityPart = {
  protocol: PROTOCOL_VERSION,
  planSource: "router",
  tools: ["search_catalog"],
  timings: { planMs: 200, retrieveMs: 1100, assembleMs: 100 },
}

const BOURBON: ConversationSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Bourbon trivia",
  messageCount: 5,
  lastMessageAt: Date.parse("2026-09-20T11:30:00.000Z"),
  archivedAt: null,
}

const TRANSCRIPT: TranscriptMessage[] = [
  { id: "m1", role: "user", content: "Who is Bourbon?", createdAt: Date.parse("2026-09-20T11:29:00.000Z") },
  {
    id: "m2",
    role: "assistant",
    content: "A member of the Black Organization.",
    createdAt: Date.parse("2026-09-20T11:29:30.000Z"),
  },
]

const FAVORITE_CHARACTER: MemoryFactView = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "preference",
  key: "favorite_character",
  value: "Bourbon",
  confidence: 0.9,
  lastConfirmedAt: Date.parse("2026-09-20T09:00:00.000Z"),
  status: "active",
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

/** The conversation route's three calls, answered as the real one answers them. */
function conversationRoute(): Mock<FetchFn> {
  return stubFetch(async (input, init) => {
    if (init?.method === "DELETE") return jsonResponse({ archived: true })
    if (String(input).includes("?id=")) {
      return jsonResponse({ id: BOURBON.id, title: BOURBON.title, summary: null, messages: TRANSCRIPT })
    }
    return jsonResponse({ conversations: [BOURBON] })
  })
}

function memoryRoute(): Mock<FetchFn> {
  return stubFetch(async (_input, init) =>
    init?.method === "DELETE"
      ? jsonResponse({ deleted: true })
      : jsonResponse({ facts: [FAVORITE_CHARACTER], cap: 50, memoryEnabled: true })
  )
}

function deletes(fetchMock: Mock<FetchFn>) {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE")
}

type User = ReturnType<typeof userEvent.setup>

/**
 * Tabs forward until `target` holds focus, so a test asserts that a control is
 * keyboard-reachable rather than a fixed tab count — the counts differ between
 * the inline and modal shapes, and Radix's trap owns the order inside a dialog.
 */
async function tabTo(user: User, target: HTMLElement, limit = 6): Promise<void> {
  for (let i = 0; i < limit && document.activeElement !== target; i += 1) {
    await user.tab()
  }
  expect(target).toHaveFocus()
}

const defaultMatchMedia = window.matchMedia

interface ReducedMotionState {
  hasReducedMotionListener: { current: boolean }
  prefersReducedMotion: { current: boolean | null }
}

/**
 * framer-motion reads `(prefers-reduced-motion)` once and caches the answer in
 * module state (`dist/es/utils/reduced-motion/state.mjs`), so swapping
 * `window.matchMedia` after the first render is invisible to it. Clearing the
 * cache makes the next render re-read whichever stub is installed — which is
 * what lets the two branches be told apart from real rendered style instead of a
 * mocked hook.
 *
 * There is no public way to do this: `useReducedMotion()` reads that state and
 * not `MotionConfig`, so `reducedMotion="never"` would not move it. This is the
 * one test in the repo that reaches into a dependency's internals, and the
 * version it was written against is pinned in the guard below — a framer-motion
 * bump that reshapes the module fails here, by name, rather than as a confusing
 * opacity mismatch two tests later.
 */
const FRAMER_MOTION_WRITTEN_AGAINST = "11.18.2"

async function resetReducedMotionCache(): Promise<void> {
  const statePath = join(
    process.cwd(),
    "node_modules/framer-motion/dist/es/utils/reduced-motion/state.mjs"
  )
  const state = (await import(/* @vite-ignore */ statePath)) as unknown as ReducedMotionState
  const shaped =
    typeof state?.hasReducedMotionListener?.current === "boolean" &&
    "prefersReducedMotion" in state &&
    typeof state.prefersReducedMotion?.current !== "undefined"

  if (!shaped) {
    throw new Error(
      `framer-motion's reduced-motion state module is not the shape this test was written ` +
        `against (${FRAMER_MOTION_WRITTEN_AGAINST}). Re-read the two branches below and update ` +
        `resetReducedMotionCache, or drop the reduced-motion-off case.`
    )
  }

  state.hasReducedMotionListener.current = false
  state.prefersReducedMotion.current = null
}

/** A `matchMedia` reporting reduced motion off, for the one test that needs it. */
function reduceMotionOff(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

afterEach(async () => {
  window.matchMedia = defaultMatchMedia
  vi.unstubAllGlobals()
  // The cache outlives a test, so the reduced-motion-off case would otherwise
  // leak its branch into whatever runs after it.
  await resetReducedMotionCache()
})

describe("keyboard path", () => {
  it("opens a citation chip with the keyboard and reports that chip's number", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CitationChips refs={REFS} citations={REPORT} onSelect={onSelect} />)

    // The second chip, so this is not the first-control case another test pins.
    const chip = screen.getByRole("button", { name: "Earlier in this conversation" })
    await tabTo(user, chip)
    await user.keyboard("{Enter}")

    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it("closes the inline sources panel on Escape and reports it to onOpenChange", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()

    function Harness() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Show sources
          </button>
          <SourcesPanel
            refs={REFS}
            citations={REPORT}
            open={open}
            onOpenChange={(next) => {
              onOpenChange(next)
              setOpen(next)
            }}
          />
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByRole("button", { name: "Show sources" })
    await tabTo(user, trigger)
    await user.keyboard("{Enter}")
    expect(screen.getByRole("complementary")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })

  it("opens a conversation from the drawer with the keyboard and hands onSelect the transcript", async () => {
    const fetchMock = conversationRoute()
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ConversationDrawer open onOpenChange={() => {}} onSelect={onSelect} />)

    const row = await screen.findByRole("button", { name: /^Bourbon trivia/ })
    await tabTo(user, row)
    await user.keyboard("{Enter}")

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(onSelect).toHaveBeenCalledWith({
      id: BOURBON.id,
      title: "Bourbon trivia",
      messages: TRANSCRIPT,
    })
    expect(fetchMock).toHaveBeenCalledWith(`/api/ai-chat/conversations?id=${BOURBON.id}`)
  })

  it("archives a conversation with the keyboard alone", async () => {
    const fetchMock = conversationRoute()
    const user = userEvent.setup()
    render(<ConversationDrawer open onOpenChange={() => {}} onSelect={() => {}} />)

    await screen.findByRole("button", { name: /^Bourbon trivia/ })
    const archiveControl = screen.getByRole("button", { name: "Archive Bourbon trivia" })
    await tabTo(user, archiveControl)
    await user.keyboard("{Enter}")
    expect(screen.getByText("Archive this conversation?")).toBeInTheDocument()

    const confirm = screen.getByRole("button", { name: "Archive" })
    await tabTo(user, confirm)
    await user.keyboard("{Enter}")

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1))
    expect(deletes(fetchMock).map((call) => String(call[0]))).toEqual([
      `/api/ai-chat/conversations?id=${BOURBON.id}`,
    ])
  })

  it("deletes a remembered fact with the keyboard alone", async () => {
    const fetchMock = memoryRoute()
    const user = userEvent.setup()
    render(<MemoryPanel open onOpenChange={() => {}} />)

    await screen.findByText("favorite_character")
    const deleteControl = screen.getByRole("button", { name: "Delete favorite_character" })
    await tabTo(user, deleteControl)
    await user.keyboard("{Enter}")
    expect(screen.getByText("Delete this fact?")).toBeInTheDocument()

    const confirm = screen.getByRole("button", { name: "Delete" })
    await tabTo(user, confirm)
    await user.keyboard("{Enter}")

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1))
    expect(deletes(fetchMock).map((call) => String(call[0]))).toEqual([
      `/api/ai-chat/memory?id=${FAVORITE_CHARACTER.id}`,
    ])
  })

  it("toggles the activity trace from the keyboard and puts the details region in the document", async () => {
    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)

    const toggle = screen.getByRole("button")
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    await tabTo(user, toggle)
    await user.keyboard("{Enter}")

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "")
    expect(panel).not.toBeNull()
    expect(panel).toHaveTextContent("Retrieve (includes plan)")
  })

  it("closes the activity trace on Escape once it is open", async () => {
    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)

    const toggle = screen.getByRole("button")
    await tabTo(user, toggle)
    await user.keyboard("{Enter}")
    expect(toggle).toHaveAttribute("aria-expanded", "true")

    await user.keyboard("{Escape}")

    expect(toggle).toHaveAttribute("aria-expanded", "false")
  })
})

describe("focus management", () => {
  /** A modal panel plus a real trigger outside it, opened from the trigger. */
  function ModalHarness() {
    const [open, setOpen] = React.useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Show sources
        </button>
        <SourcesPanel refs={REFS} citations={REPORT} open={open} onOpenChange={setOpen} modal />
      </>
    )
  }

  it("moves focus into a modal panel when it opens", async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const trigger = screen.getByRole("button", { name: "Show sources" })
    await tabTo(user, trigger)
    await user.keyboard("{Enter}")

    const dialog = screen.getByRole("dialog")
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).not.toBe(trigger)
  })

  it("restores focus to the control that opened a modal panel when it closes", async () => {
    const user = userEvent.setup()
    render(<ModalHarness />)

    const trigger = screen.getByRole("button", { name: "Show sources" })
    await tabTo(user, trigger)
    await user.keyboard("{Enter}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("leaves focus on the trigger when the inline sources panel opens", async () => {
    function InlineHarness() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Show sources
          </button>
          <SourcesPanel refs={REFS} citations={REPORT} open={open} onOpenChange={setOpen} />
        </>
      )
    }

    const user = userEvent.setup()
    render(<InlineHarness />)

    const trigger = screen.getByRole("button", { name: "Show sources" })
    await tabTo(user, trigger)
    await user.keyboard("{Enter}")

    expect(screen.getByRole("complementary")).toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe("streaming placeholder", () => {
  it("does not move focus when a streaming message renders", async () => {
    const view = render(
      <button type="button">Somewhere else on the page</button>
    )
    const anchor = screen.getByRole("button", { name: "Somewhere else on the page" })
    anchor.focus()
    expect(anchor).toHaveFocus()

    view.rerender(
      <>
        <button type="button">Somewhere else on the page</button>
        <ChatMessage message={{ id: "m1", role: "assistant", content: "" }} isStreaming />
      </>
    )

    expect(screen.getByLabelText("DCPH Bot is typing")).toBeInTheDocument()
    expect(document.activeElement).toBe(anchor)
  })
})

describe("reduced motion", () => {
  it("renders the motion components at their final state when reduced motion is on", async () => {
    await resetReducedMotionCache()
    expect(window.matchMedia("(prefers-reduced-motion)").matches).toBe(true)

    const user = userEvent.setup()
    render(
      <>
        <CitationChips refs={REFS} citations={REPORT} />
        <SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={() => {}} />
        <ActivityTrace activity={ACTIVITY} />
      </>
    )

    const toggle = screen.getByRole("button", { name: /Show details/ })
    await tabTo(user, toggle)
    await user.keyboard("{Enter}")
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "")

    // `initial={false}` is the reduced branch: framer applies the `animate`
    // values at once, so nothing is left sitting at the animated opacity 0.
    expect(screen.getByRole("list", { name: "Sources cited" }).style.opacity).toBe("1")
    expect(screen.getByRole("complementary").style.opacity).toBe("1")
    expect(panel?.style.opacity).toBe("1")

    // The chevron's CSS transform transition is the trace's other
    // reduced-motion branch: with the preference set it carries no
    // `transition-transform`.
    expect(toggle.querySelector("svg")).not.toHaveClass("transition-transform")
  })

  it("applies the animated initial state when reduced motion is off", async () => {
    reduceMotionOff()
    await resetReducedMotionCache()

    render(
      <>
        <CitationChips refs={REFS} citations={REPORT} />
        <SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={() => {}} />
        <ActivityTrace activity={ACTIVITY} />
      </>
    )

    // The same components on the opposite branch: the animated `initial` is
    // applied, so the two branches cannot collapse into one unnoticed.
    expect(screen.getByRole("list", { name: "Sources cited" }).style.opacity).toBe("0")
    expect(screen.getByRole("complementary").style.opacity).toBe("0")

    // The trace's expansion is the third `motion.*` transition in the chat
    // surface. Its framer `initial` is asserted in the reduced-on test above;
    // here its chevron's CSS transition is the branch that can be read off the
    // rendered class list without racing the animation.
    const toggle = screen.getByRole("button", { name: /Show details/ })
    expect(toggle.querySelector("svg")).toHaveClass("transition-transform")
  })
})
