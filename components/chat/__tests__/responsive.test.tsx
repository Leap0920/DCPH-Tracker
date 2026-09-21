import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActivityTrace } from "@/components/chat/ActivityTrace"
import { ChatInput } from "@/components/chat/ChatInput"
import { ConversationDrawer, type ConversationSummary } from "@/components/chat/ConversationDrawer"
import { MemoryPanel, type MemoryFactView } from "@/components/chat/MemoryPanel"
import { SourcesPanel } from "@/components/chat/SourcesPanel"
import { PROTOCOL_VERSION, type ActivityPart } from "@/lib/ai/stream/protocol"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"

/**
 * The chat panels on a 360 px phone.
 *
 * jsdom computes no layout — `getBoundingClientRect` returns zeros and
 * `getComputedStyle` never sees the stylesheet — so a responsive contract
 * written in Tailwind breakpoint classes cannot be asserted through geometry.
 * This file therefore asserts two different kinds of thing and keeps them
 * apart:
 *
 * 1. **Real rendered structure**, wherever the DOM can carry it — roles, names,
 *    attributes, whether an element is in the document. Asserted normally.
 * 2. **The responsive class contract**, where nothing else is observable. Each
 *    such assertion names the one breakpoint class that carries the behaviour
 *    (`h-dvh`, `sm:size-7`, `top-0`), never the whole class string, so
 *    restyling that leaves the breakpoint behaviour alone cannot fail this file.
 *
 * No test here touches a socket or a real timer: every fetch is stubbed, and
 * the clock is never read (no assertion depends on `timeAgo`).
 */

const REFS: EvidenceRef[] = [{ n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }]

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

function stubFetch(handler: FetchFn): void {
  vi.stubGlobal("fetch", vi.fn<FetchFn>(handler))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * An element's class tokens as a set. A set rather than a substring search
 * because `top-[50%]` is a substring of `sm:top-[50%]`, and those two are
 * opposite facts about a full-height sheet.
 */
function classTokens(el: Element): Set<string> {
  return new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean))
}

/**
 * A Tailwind spacing token in CSS pixels. The scale is 4 px per unit, so
 * `size-11` is 44 px — the arithmetic a hit-area assertion needs, because jsdom
 * reports every rendered box as 0 × 0.
 */
function spacingPx(token: string): number {
  const match = token.match(/^(?:size|h|w|p)-(\d+(?:\.\d+)?)$/)
  if (match === null) throw new Error(`not a spacing token: ${token}`)
  return Number(match[1]) * 4
}

/**
 * The sheet contract each full-height panel carries, read off the rendered
 * class list. The primitive's centring pair is the part worth spelling out:
 * `top-[50%]` resolves against the containing block while `translate-y-[-50%]`
 * resolves against the element's own height, so the pair cancels only for an
 * element exactly as tall as the percentage base. `h-dvh` is the *dynamic*
 * viewport height and need not equal that base, so a full-height sheet pins
 * itself to the top and the pair is restored at `sm`.
 */
function expectSheet(dialog: HTMLElement): void {
  const tokens = classTokens(dialog)

  // Mobile: the sheet is the viewport, and it scrolls its own content.
  expect(tokens.has("h-dvh")).toBe(true)
  expect(tokens.has("overflow-y-auto")).toBe(true)

  // Pinned to the top instead of riding the centring pair.
  expect(tokens.has("top-0")).toBe(true)
  expect(tokens.has("translate-y-0")).toBe(true)
  expect(tokens.has("top-[50%]")).toBe(false)
  expect(tokens.has("translate-y-[-50%]")).toBe(false)
  // Pinning vertically must not un-centre it horizontally.
  expect(tokens.has("translate-x-[-50%]")).toBe(true)

  // From `sm` up: auto height, no scroll container, the centring pair back.
  expect(tokens.has("sm:h-auto")).toBe(true)
  expect(tokens.has("sm:overflow-y-visible")).toBe(true)
  expect(tokens.has("sm:top-[50%]")).toBe(true)
  expect(tokens.has("sm:translate-y-[-50%]")).toBe(true)
}

function renderDrawer(): void {
  stubFetch(async () => jsonResponse({ conversations: [BOURBON] }))
  render(<ConversationDrawer open onOpenChange={() => {}} onSelect={() => {}} />)
}

describe("full-height sheets", () => {
  it("fills the viewport for the conversation drawer", async () => {
    renderDrawer()

    await screen.findByRole("button", { name: /^Bourbon trivia/ })
    expectSheet(screen.getByRole("dialog"))
  })

  it("fills the viewport for the memory panel", async () => {
    stubFetch(async () => jsonResponse({ facts: [FAVORITE_CHARACTER], cap: 50, memoryEnabled: true }))
    render(<MemoryPanel open onOpenChange={() => {}} />)

    await screen.findByText("favorite_character")
    expectSheet(screen.getByRole("dialog"))
  })

  it("fills the viewport for the modal sources panel", () => {
    render(<SourcesPanel refs={REFS} open onOpenChange={() => {}} modal />)

    expectSheet(screen.getByRole("dialog"))
  })

  it("leaves the inline sources panel in the chat's own flow", () => {
    render(<SourcesPanel refs={REFS} open onOpenChange={() => {}} />)

    expect(screen.getByRole("complementary")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(classTokens(screen.getByRole("complementary")).has("h-dvh")).toBe(false)
  })
})

describe("touch targets", () => {
  it("gives the drawer's archive control a 44 px hit area on a phone", async () => {
    renderDrawer()

    const archive = await screen.findByRole("button", { name: "Archive Bourbon trivia" })
    expect(archive).toHaveClass("size-11")
    expect(archive).toHaveClass("sm:size-7")
    expect(spacingPx("size-11")).toBeGreaterThanOrEqual(44)
    // The compact desktop size is on the other side of the minimum, so the pair
    // cannot both be satisfied by one value.
    expect(spacingPx("size-7")).toBeLessThan(44)
    // Only the hit area grew: the glyph keeps its own size.
    expect(archive.querySelector("svg") as SVGElement).toHaveClass("size-3.5")
  })

  it("gives the memory panel's delete control a 44 px hit area on a phone", async () => {
    stubFetch(async () => jsonResponse({ facts: [FAVORITE_CHARACTER], cap: 50, memoryEnabled: true }))
    render(<MemoryPanel open onOpenChange={() => {}} />)

    const remove = await screen.findByRole("button", { name: "Delete favorite_character" })
    expect(remove).toHaveClass("size-11")
    expect(remove).toHaveClass("sm:size-7")
    expect(spacingPx("size-11")).toBeGreaterThanOrEqual(44)
    expect(remove.querySelector("svg") as SVGElement).toHaveClass("size-3.5")
  })

  it("brings the shared dialog close control to the 24 px minimum", async () => {
    renderDrawer()

    await screen.findByRole("button", { name: /^Bourbon trivia/ })
    const close = screen.getByRole("button", { name: "Close" })
    const icon = close.querySelector("svg") as SVGElement

    // The glyph is 16 px and the padding is 4 px a side, so the box the pointer
    // can hit is 24 × 24 — the minimum of WCAG 2.2 SC 2.5.8 — while the glyph
    // itself and the control's visual weight are unchanged.
    expect(icon).toHaveClass("h-4")
    expect(icon).toHaveClass("w-4")
    expect(classTokens(close).has("p-1")).toBe(true)
    expect(spacingPx("h-4") + 2 * spacingPx("p-1")).toBeGreaterThanOrEqual(24)
  })
})

describe("activity trace", () => {
  it("is its one collapsed line until the toggle is used, at every width", async () => {
    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)

    // The collapsed form is the default and there is no width-dependent branch
    // in the component, so this structure is what every width gets.
    const toggle = screen.getByRole("button")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(toggle).toHaveTextContent("1 step")
    // Absent from the document, not merely hidden.
    expect(screen.queryByText("Retrieve (includes plan)")).not.toBeInTheDocument()
    expect(toggle).not.toHaveAttribute("aria-controls")

    await user.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Retrieve (includes plan)")).toBeInTheDocument()
  })
})

describe("composer", () => {
  /**
   * jsdom reports `scrollHeight` as 0 for every element, so the composer's own
   * `Math.min(el.scrollHeight, 120)` would write "0px" whatever the content is.
   * The reading it consumes is therefore set on the element before the resize is
   * triggered; the effect runs again on every change to the box's value.
   */
  function setScrollHeight(el: HTMLElement, px: number): void {
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => px })
  }

  function setup() {
    render(<ChatInput onSend={() => {}} />)
    const box = screen.getByRole("textbox", {
      name: /ask about detective conan episodes/i,
    }) as HTMLTextAreaElement
    return box
  }

  it("is a single row that grows with the text and stops at its maximum", async () => {
    const user = userEvent.setup()
    const box = setup()

    // The single-row contract is the `rows` attribute. The height the component
    // wrote at mount is jsdom's 0, which is an artifact of having no layout and
    // not a measurement of the box.
    expect(box).toHaveAttribute("rows", "1")
    expect(box.style.height).toBe("0px")

    setScrollHeight(box, 48)
    await user.type(box, "Who is Bourbon?")

    expect(box.style.height).toBe("48px")

    setScrollHeight(box, 400)
    await user.type(box, " And what about Vermouth?")

    // 120 px is the cap, whatever the content would ask for.
    expect(box.style.height).toBe("120px")
  })

  it("keeps the box and its controls on one row", () => {
    const box = setup()
    const form = box.closest("form") as HTMLFormElement

    expect(classTokens(form).has("flex")).toBe(true)
    expect(classTokens(box).has("flex-1")).toBe(true)
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument()
  })

  /**
   * Where the composer sits in the viewport is decided by the panel that hosts
   * it — `fixed bottom-5` in `components/chat/ChatWidget.tsx`, which is frozen
   * and out of scope here. Nothing in this component positions the row, so
   * nothing in this component can be what keeps it above the keyboard; that is
   * asserted as the absence of a positioning utility, and it is not a claim
   * that the composer clears the keyboard.
   */
  it("does not position itself: viewport placement belongs to the widget", () => {
    const box = setup()
    const tokens = classTokens(box.closest("form") as HTMLFormElement)

    expect(tokens.has("fixed")).toBe(false)
    expect(tokens.has("absolute")).toBe(false)
    expect(tokens.has("sticky")).toBe(false)
  })
})
