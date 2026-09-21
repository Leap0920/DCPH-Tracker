import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  DEGRADED_REASONS,
  PROTOCOL_VERSION,
  type ActivityPart,
} from "@/lib/ai/stream/protocol"
import {
  ActivityTrace,
  DEGRADE_WORDING,
  PLAN_SOURCE_WORDING,
  activitySummary,
  degradeWording,
  evictionWording,
  formatDuration,
  totalActivityMs,
  toolVerb,
} from "@/components/chat/ActivityTrace"

/**
 * The activity trace as a reader meets it: one collapsed line the server's own
 * numbers produced, an expansion that shows each stage's measurement, and one
 * badge per degrade reason — including a reason this client has never seen.
 *
 * Every duration asserted here is a value the test handed the component in the
 * activity part. Nothing in the suite touches a clock, so a passing duration
 * cannot be a client wall-clock reading.
 */

const ACTIVITY: ActivityPart = {
  protocol: PROTOCOL_VERSION,
  planSource: "router",
  tools: ["search_catalog", "lookup_character"],
  timings: { planMs: 200, retrieveMs: 1100, assembleMs: 100 },
}

function activity(overrides: Partial<ActivityPart> = {}): ActivityPart {
  return { ...ACTIVITY, ...overrides }
}

/** Render, then open the trace the way a reader does. */
async function renderExpanded(props: {
  activity: ActivityPart
  degraded?: string[]
}): Promise<void> {
  render(<ActivityTrace {...props} />)
  await userEvent.setup().click(screen.getByRole("button"))
}

describe("ActivityTrace summary", () => {
  it("summarises the steps, the server's duration and what the tools did", () => {
    render(<ActivityTrace activity={ACTIVITY} />)

    const button = screen.getByRole("button")
    // 1100 + 100 = 1200 ms, all of it the server's own measurement. The plan's
    // 200 ms is deliberately not added: retrieve is measured over a window that
    // contains the plan stage, so summing both would report a duration longer
    // than the request took.
    expect(button).toHaveTextContent(
      "2 steps · 1.2 s · searched the catalog, looked up a character"
    )
    expect(button).toHaveAccessibleName(/Show details/)
  })

  it("says so when no step ran, without inventing a duration", () => {
    const summary = activitySummary(
      activity({ tools: [], timings: { planMs: null, retrieveMs: null, assembleMs: null } })
    )

    expect(summary).toBe("no steps")
  })

  it("renders nothing when the turn carried no activity part", () => {
    const { container } = render(<ActivityTrace activity={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("never renders a raw snake_case tool id", () => {
    const { container } = render(<ActivityTrace activity={activity({ tools: ["some_new_tool"] })} />)

    expect(container.textContent).not.toContain("some_new_tool")
    expect(container.textContent).toContain("ran a step")
  })
})

describe("ActivityTrace expansion", () => {
  it("lists each stage's own server-sent measurement", async () => {
    await renderExpanded({ activity: ACTIVITY })

    expect(screen.getByText("Plan")).toBeInTheDocument()
    expect(screen.getByText("200 ms")).toBeInTheDocument()
    expect(screen.getByText("Retrieve (includes plan)")).toBeInTheDocument()
    expect(screen.getByText("1100 ms")).toBeInTheDocument()
    expect(screen.getByText("Assemble")).toBeInTheDocument()
    expect(screen.getByText("100 ms")).toBeInTheDocument()
  })

  it("renders a missing measurement as absent, not as zero", async () => {
    await renderExpanded({
      activity: activity({ timings: { planMs: null, retrieveMs: 1200, assembleMs: null } }),
    })

    expect(screen.getAllByText("not measured")).toHaveLength(2)
    expect(screen.queryByText("0 ms")).not.toBeInTheDocument()
    expect(screen.getByText("1200 ms")).toBeInTheDocument()
  })

  it("shows the router as the planning path", async () => {
    await renderExpanded({ activity: activity({ planSource: "router" }) })

    expect(screen.getByText(PLAN_SOURCE_WORDING.router)).toBeInTheDocument()
  })

  it("shows the model as the planning path", async () => {
    await renderExpanded({ activity: activity({ planSource: "model" }) })

    expect(screen.getByText(PLAN_SOURCE_WORDING.model)).toBeInTheDocument()
  })

  it("shows the fallback as a normal plan, not an error", async () => {
    await renderExpanded({ activity: activity({ planSource: "fallback" }) })

    const panel = screen.getByText(PLAN_SOURCE_WORDING.fallback).closest("div")
    expect(panel).not.toBeNull()
    expect(panel?.textContent ?? "").not.toMatch(/error|fail|unavailable/i)
  })

  it("says no planner ran when the server sent no plan source", async () => {
    await renderExpanded({
      activity: activity({ planSource: null, timings: { planMs: null, retrieveMs: 100, assembleMs: null } }),
    })

    expect(screen.getByText("No planner ran")).toBeInTheDocument()
  })
})

describe("ActivityTrace evicted evidence", () => {
  it("words document and wiki ids as sources that did not fit", () => {
    expect(evictionWording(["entry:6", "entry:5", "wiki:dcw:Ai Haibara"])).toEqual([
      "3 sources did not fit: entry:6, entry:5, wiki:dcw:Ai Haibara",
    ])
  })

  it("words a trimmed-turn marker as turns, never as a source", () => {
    expect(evictionWording(["turns:2"])).toEqual(["2 earlier turns were trimmed"])
    expect(evictionWording(["entry:1", "turns:2"])).toEqual([
      "1 source did not fit: entry:1",
      "2 earlier turns were trimmed",
    ])
    // The turn count is not folded into the source count: a trimmed turn is
    // earlier conversation, not an evicted source.
    expect(evictionWording(["turns:2"]).join(" ")).not.toContain("source")
    expect(evictionWording(["turns:1"])).toEqual(["1 earlier turn was trimmed"])
  })

  it("words the dropped summary as the summary, never as a source", () => {
    expect(evictionWording(["summary"])).toEqual(["the earlier conversation summary was dropped"])
    expect(evictionWording(["turns:2", "summary"]).join(" ")).not.toContain("source")
    expect(evictionWording(["entry:1", "turns:2", "summary"])).toEqual([
      "1 source did not fit: entry:1",
      "2 earlier turns were trimmed",
      "the earlier conversation summary was dropped",
    ])
  })

  it("says nothing for an empty list", () => {
    expect(evictionWording([])).toEqual([])
  })

  it("lists each eviction shape in the expansion, worded for what it is", async () => {
    await renderExpanded({
      activity: activity({
        evicted: ["entry:6", "entry:5", "wiki:dcw:Ai Haibara", "turns:2", "summary"],
      }),
    })

    const list = screen.getByRole("list", { name: "Evicted evidence" })
    expect(list).toHaveTextContent("3 sources did not fit: entry:6, entry:5, wiki:dcw:Ai Haibara")
    expect(list).toHaveTextContent("2 earlier turns were trimmed")
    expect(list).toHaveTextContent("the earlier conversation summary was dropped")
    // The collapsed line is unchanged: eviction is detail, not a headline.
    expect(screen.getByRole("button")).toHaveTextContent(
      "2 steps · 1.2 s · searched the catalog, looked up a character"
    )
  })

  it("renders no eviction list when the server sent none", async () => {
    await renderExpanded({ activity: ACTIVITY })

    expect(screen.queryByRole("list", { name: "Evicted evidence" })).not.toBeInTheDocument()
  })
})

describe("ActivityTrace keyboard", () => {
  it("toggles aria-expanded on a real button", async () => {
    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)

    const button = screen.getByRole("button")
    expect(button).toHaveAttribute("aria-expanded", "false")

    await user.click(button)
    expect(button).toHaveAttribute("aria-expanded", "true")

    await user.click(button)
    expect(button).toHaveAttribute("aria-expanded", "false")
  })

  it("collapses on Escape while focus is inside and it is expanded", async () => {
    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)

    const button = screen.getByRole("button")
    await user.click(button)
    expect(button).toHaveAttribute("aria-expanded", "true")

    await user.keyboard("{Escape}")

    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveFocus()
  })
})

describe("ActivityTrace degrade wording", () => {
  it.each(DEGRADED_REASONS)("renders wording for %s", (reason) => {
    render(<ActivityTrace activity={ACTIVITY} degraded={[reason]} />)

    expect(screen.getByText(DEGRADE_WORDING[reason])).toBeInTheDocument()
  })

  it("covers exactly the reasons DEGRADED_REASONS carries", () => {
    expect(Object.keys(DEGRADE_WORDING).sort()).toEqual([...DEGRADED_REASONS].sort())
    for (const reason of DEGRADED_REASONS) {
      expect(DEGRADE_WORDING[reason].length).toBeGreaterThan(0)
    }
  })

  it("reports an unknown reason by name with a neutral badge", () => {
    render(<ActivityTrace activity={ACTIVITY} degraded={["brand_new_reason"]} />)

    expect(screen.getByText("degraded: brand_new_reason")).toBeInTheDocument()
    expect(degradeWording("brand_new_reason")).toBe("degraded: brand_new_reason")
  })

  it("renders every reason at once without hiding any", () => {
    render(<ActivityTrace activity={ACTIVITY} degraded={[...DEGRADED_REASONS]} />)

    expect(screen.getByRole("list", { name: "Answer state" })).toBeInTheDocument()
    for (const reason of DEGRADED_REASONS) {
      expect(screen.getByText(DEGRADE_WORDING[reason])).toBeInTheDocument()
    }
  })

  it("renders no provider name, key or raw error", () => {
    const { container } = render(
      <ActivityTrace activity={ACTIVITY} degraded={[...DEGRADED_REASONS]} />
    )

    const text = container.textContent ?? ""
    expect(text).not.toMatch(/openai|anthropic|deepseek|groq|gemini|mistral/i)
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/)
    expect(text).not.toMatch(/api[_-]?key|bearer\s/i)
    expect(text).not.toMatch(/\b(?:Error|TypeError|stack trace)\b/)
  })
})

describe("ActivityTrace motion and helpers", () => {
  it("renders without animation when prefers-reduced-motion is reduce", async () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true)

    const user = userEvent.setup()
    render(<ActivityTrace activity={ACTIVITY} />)
    const button = screen.getByRole("button")
    await user.click(button)

    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "")
    expect(panel).not.toBeNull()
    expect(panel?.style.opacity).not.toBe("0")
  })

  it("formats durations and totals from the server's fields only", () => {
    expect(formatDuration(850)).toBe("850 ms")
    expect(formatDuration(1400)).toBe("1.4 s")
    expect(totalActivityMs({ planMs: null, retrieveMs: null, assembleMs: null })).toBeNull()
    // Retrieve contains the plan stage, so the wider window wins rather than
    // both being summed.
    expect(totalActivityMs({ planMs: 200, retrieveMs: 1100, assembleMs: 100 })).toBe(1200)
    // A response that measured only the plan still gets an honest total.
    expect(totalActivityMs({ planMs: 200, retrieveMs: null, assembleMs: 100 })).toBe(300)
    expect(totalActivityMs({ planMs: null, retrieveMs: 1200, assembleMs: null })).toBe(1200)
    expect(toolVerb("search_cases")).toBe("searched the cases")
  })
})
