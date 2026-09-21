import * as React from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { UIMessage } from "ai"
import { PARTS, PROTOCOL_VERSION } from "@/lib/ai/stream/protocol"
import { toMessageView, type StreamViewContext } from "@/components/chat/useChatStream"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import { CitationChips, brokenReferenceLabel } from "@/components/chat/CitationChips"
import { SourcesPanel } from "@/components/chat/SourcesPanel"

/**
 * The citation contract, as the reader sees it: chips built from the server's
 * refs and verdict, a panel that lists every admitted source, and a fabricated
 * citation that stays visible instead of vanishing.
 *
 * No test here renders the answer text as a prop, because neither component
 * takes it — the no-parsing test below builds its props through the real view
 * model to prove the text never reaches a chip.
 */

const IDLE: StreamViewContext = { streamingMessageId: null, stoppedMessageId: null }

const RET: EvidenceRef = { n: 1, id: "ep-1", tag: "[RET]", label: "Episode 1" }
const WIKI: EvidenceRef = { n: 2, id: "wiki:dcw:Shinichi", tag: "[WIKI]", label: "Shinichi Kudo" }
const CONV: EvidenceRef = { n: 3, id: "conv-1", tag: "[CONV]", label: "Earlier in this conversation" }
const REFS: EvidenceRef[] = [RET, WIKI, CONV]

/** Cites E1 and E3; E9 is fabricated. */
const REPORT: CitationReport = { cited: [RET, CONV], unknown: [9], valid: false, uncited: false }

const ALL_CITED: CitationReport = { cited: REFS, unknown: [], valid: true, uncited: false }

type Part = UIMessage["parts"][number]

function textPart(text: string): Part {
  return { type: "text", text }
}

function dataPart(type: `data-${string}`, data: unknown): Part {
  return { type, data }
}

function activityPart(): Part {
  return dataPart(PARTS.activity, {
    protocol: PROTOCOL_VERSION,
    planSource: "router",
    tools: [],
    timings: { planMs: null, retrieveMs: null, assembleMs: null },
  })
}

describe("CitationChips", () => {
  it("renders one chip per cited number, in the order the answer cited them", () => {
    render(<CitationChips refs={REFS} citations={REPORT} />)

    const chips = screen.getAllByRole("button")
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveAccessibleName("Episode 1")
    expect(chips[1]).toHaveAccessibleName("Earlier in this conversation")
    expect(within(chips[0]).getByText("E1")).toBeInTheDocument()
    expect(within(chips[1]).getByText("E3")).toBeInTheDocument()
  })

  it("renders the tag as the tier label and the document label as the accessible name", () => {
    render(<CitationChips refs={REFS} citations={ALL_CITED} />)

    const chip = screen.getByRole("button", { name: "Shinichi Kudo" })
    expect(within(chip).getByText("[WIKI]")).toBeInTheDocument()
    expect(within(screen.getByRole("button", { name: "Episode 1" })).getByText("[RET]")).toBeInTheDocument()
    expect(
      within(screen.getByRole("button", { name: "Earlier in this conversation" })).getByText("[CONV]")
    ).toBeInTheDocument()
  })

  it("shows the label in a tooltip", async () => {
    const user = userEvent.setup()
    render(<CitationChips refs={REFS} citations={ALL_CITED} />)

    await user.hover(screen.getByRole("button", { name: "Shinichi Kudo" }))

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Shinichi Kudo")
  })

  it("renders an unknown number as a broken reference and never drops it", () => {
    render(<CitationChips refs={REFS} citations={REPORT} />)

    const broken = screen.getByRole("button", { name: brokenReferenceLabel(9) })
    expect(within(broken).getByText("E9")).toBeInTheDocument()
    expect(broken).toHaveClass("text-danger")
    expect(broken.querySelector("svg")).not.toBeNull()
  })

  it("never parses the answer text for a citation number", () => {
    const message: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        activityPart(),
        dataPart(PARTS.evidence, { refs: REFS }),
        textPart("See [E1] for the episode, and [E7] for something that does not exist."),
        dataPart(PARTS.citations, {
          report: { cited: [RET], unknown: [], valid: true, uncited: false } satisfies CitationReport,
        }),
      ],
    }

    const view = toMessageView(message, IDLE)
    render(<CitationChips refs={view.refs} citations={view.citations} />)

    // E7 is in the prose and in no ref, so it must not become a chip.
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByText("E7")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Episode 1" })).toBeInTheDocument()
  })

  it("renders nothing when the turn carried no citation report", () => {
    const { container } = render(<CitationChips refs={REFS} citations={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders without animation when prefers-reduced-motion is reduce", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true)

    render(<CitationChips refs={REFS} citations={REPORT} />)

    expect(screen.getByRole("list", { name: "Sources cited" }).style.opacity).not.toBe("0")
  })

  it("is reachable and activatable by keyboard alone", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CitationChips refs={REFS} citations={REPORT} onSelect={onSelect} />)

    await user.tab()
    expect(screen.getAllByRole("button")[0]).toHaveFocus()
    await user.keyboard("{Enter}")

    expect(onSelect).toHaveBeenCalledWith(1)
  })
})

describe("SourcesPanel", () => {
  it("lists every admitted reference with its number, tag and title", () => {
    render(<SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={() => {}} />)

    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument()
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText("E1")).toBeInTheDocument()
    expect(within(items[0]).getByText("[RET]")).toBeInTheDocument()
    expect(within(items[0]).getByText("Episode 1")).toBeInTheDocument()
    expect(within(items[2]).getByText("Earlier in this conversation")).toBeInTheDocument()
  })

  it("reports a citation that has no matching ref instead of omitting it", () => {
    render(<SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={() => {}} />)

    expect(screen.getByText(/cited E9, which was not among the sources supplied/)).toBeInTheDocument()
  })

  it("cannot show a screened document, because it has no ref", () => {
    // Screening removes a document before assembly, so it never earns a ref.
    const admitted = [RET]
    const report: CitationReport = { cited: [RET], unknown: [], valid: true, uncited: false }

    render(<SourcesPanel refs={admitted} citations={report} open onOpenChange={() => {}} />)

    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(screen.queryByText(/excluded|screened/i)).not.toBeInTheDocument()
  })

  it("highlights the reference a chip was clicked for", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = React.useState(false)
      const [highlight, setHighlight] = React.useState<number | null>(null)
      return (
        <>
          <CitationChips
            refs={REFS}
            citations={REPORT}
            onSelect={(n) => {
              setHighlight(n)
              setOpen(true)
            }}
          />
          <SourcesPanel
            refs={REFS}
            citations={REPORT}
            open={open}
            onOpenChange={setOpen}
            highlight={highlight}
          />
        </>
      )
    }

    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Earlier in this conversation" }))

    const item = screen.getByText("Earlier in this conversation").closest("li")
    expect(item).toHaveAttribute("aria-current", "true")
  })

  it("closes on Escape when inline, without stealing focus", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return <SourcesPanel refs={REFS} citations={REPORT} open={open} onOpenChange={setOpen} />
    }

    render(<Harness />)
    expect(screen.getByRole("complementary")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })

  it("closes on Escape when modal, with a focus trap", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return <SourcesPanel refs={REFS} citations={REPORT} open={open} onOpenChange={setOpen} modal />
    }

    render(<Harness />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("is closable by keyboard alone", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={onOpenChange} />)

    await user.tab()
    expect(screen.getByRole("button", { name: "Close sources" })).toHaveFocus()
    await user.keyboard("{Enter}")

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("renders an honest empty state for an empty ref list", () => {
    render(<SourcesPanel refs={[]} citations={null} open onOpenChange={() => {}} />)

    expect(screen.getByText("No sources were supplied for this answer.")).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("renders without animation when prefers-reduced-motion is reduce", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true)

    render(<SourcesPanel refs={REFS} citations={REPORT} open onOpenChange={() => {}} />)

    expect(screen.getByRole("complementary").style.opacity).not.toBe("0")
  })
})
