import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  AiObservabilityReport,
  type AiObservabilityReportProps,
} from "@/components/admin/AiObservabilityReport"
import type {
  FeedbackSummary,
  LatencySummary,
  RequestLogRow,
  WindowSummary,
} from "@/lib/ai/observability/store"

/**
 * The operator surface as a pure render: the numbers the store returned, the
 * sampled disclaimer the counts depend on (C7), and the two absences kept
 * distinct. The component takes no `lib/env` and fetches nothing, which is what
 * lets this run in the dom project.
 */

const SINCE = Date.parse("2026-09-19T00:00:00.000Z")
const UNTIL = Date.parse("2026-09-20T00:00:00.000Z")

function latency(overrides: Partial<LatencySummary> = {}): LatencySummary {
  return { count: 0, p50: null, p95: null, ...overrides }
}

function summary(overrides: Partial<WindowSummary> = {}): WindowSummary {
  return {
    sinceMs: SINCE,
    untilMs: UNTIL,
    requestCount: 0,
    sampledRows: 0,
    sampled: false,
    byOutcome: {},
    byDegradedReason: {},
    byPlanSource: {},
    citations: { valid: 0, invalid: 0, unmeasured: 0 },
    latency: { retrieveMs: latency(), ttftMs: latency(), totalMs: latency() },
    ...overrides,
  }
}

function feedback(overrides: Partial<FeedbackSummary> = {}): FeedbackSummary {
  return { sinceMs: SINCE, untilMs: UNTIL, up: 0, down: 0, noted: 0, ...overrides }
}

function row(overrides: Partial<RequestLogRow> = {}): RequestLogRow {
  return {
    id: "r1",
    createdAt: Date.parse("2026-09-19T12:00:00.000Z"),
    outcome: "ok",
    targetId: "ep-1",
    planSource: "router",
    degradedReason: "budget",
    planMs: null,
    retrieveMs: null,
    ttftMs: null,
    totalMs: null,
    docCount: null,
    citationsValid: null,
    tools: null,
    promptTokens: null,
    completionTokens: null,
    userId: null,
    conversationId: null,
    ...overrides,
  }
}

function ready(
  props: {
    summary?: Partial<WindowSummary>
    recent?: RequestLogRow[]
    feedback?: Partial<FeedbackSummary>
  } = {}
): AiObservabilityReportProps {
  return {
    status: "ready",
    summary: summary(props.summary),
    recent: props.recent ?? [],
    feedback: feedback(props.feedback),
  }
}

describe("AiObservabilityReport", () => {
  it("renders the missing-log state and no numbers when the table cannot be read", () => {
    render(<AiObservabilityReport status="unavailable" />)

    expect(screen.getByText("The request log is not available yet")).toBeInTheDocument()
    expect(screen.queryByText("Summary")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("renders the exact count and says the breakdown was sampled", () => {
    render(
      <AiObservabilityReport
        {...ready({ summary: { requestCount: 1234, sampledRows: 1000, sampled: true } })}
      />
    )

    expect(screen.getByText("1,234")).toBeInTheDocument()
    expect(screen.getByText("1,000")).toBeInTheDocument()
    expect(screen.getByText("sampled")).toBeInTheDocument()
    expect(screen.getByText(/come from a sample of/)).toBeInTheDocument()
  })

  it("does not claim sampling when the window fit inside the cap", () => {
    render(<AiObservabilityReport {...ready({ summary: { requestCount: 5, sampledRows: 5 } })} />)

    expect(screen.queryByText("sampled")).not.toBeInTheDocument()
    expect(screen.getByText("complete")).toBeInTheDocument()
  })

  it("renders the window actually read, not the caller's ask", () => {
    render(<AiObservabilityReport {...ready({ summary: { requestCount: 1, sampledRows: 1 } })} />)

    expect(screen.getByText("2026-09-19T00:00:00.000Z")).toBeInTheDocument()
    expect(screen.getByText("2026-09-20T00:00:00.000Z")).toBeInTheDocument()
  })

  it("renders a latency with no samples as no data, never as zero", () => {
    render(
      <AiObservabilityReport
        {...ready({
          summary: {
            requestCount: 3,
            sampledRows: 3,
            latency: {
              retrieveMs: latency(),
              ttftMs: latency(),
              totalMs: latency({ count: 3, p50: 12, p95: 40 }),
            },
          },
        })}
      />
    )

    expect(screen.queryByText("0 ms")).not.toBeInTheDocument()
    expect(screen.getAllByText("no data")).toHaveLength(4)
    expect(screen.getByText("12 ms")).toBeInTheDocument()
    expect(screen.getByText("40 ms")).toBeInTheDocument()
  })

  it("renders the citation split and the feedback split", () => {
    render(
      <AiObservabilityReport
        {...ready({
          summary: {
            requestCount: 2,
            sampledRows: 2,
            citations: { valid: 5, invalid: 1, unmeasured: 3 },
          },
          feedback: { up: 4, down: 2, noted: 1 },
        })}
      />
    )

    expect(screen.getByText("5 valid")).toBeInTheDocument()
    expect(screen.getByText("1 invalid · 3 unmeasured")).toBeInTheDocument()
    expect(screen.getByText("4 up · 2 down")).toBeInTheDocument()
    expect(screen.getByText("1 with a note")).toBeInTheDocument()
  })

  it("renders the empty-window state instead of empty tables", () => {
    render(<AiObservabilityReport {...ready({ summary: { requestCount: 0 } })} />)

    expect(screen.getByText("No requests were logged in this window.")).toBeInTheDocument()
    expect(screen.queryByText("Breakdown")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("renders each breakdown bucket with its count", () => {
    render(
      <AiObservabilityReport
        {...ready({
          summary: {
            requestCount: 3,
            sampledRows: 3,
            byOutcome: { ok: 2, error: 1 },
            byDegradedReason: { none: 3 },
            byPlanSource: { router: 2, none: 1 },
          },
        })}
      />
    )

    expect(screen.getByText("Outcome")).toBeInTheDocument()
    expect(screen.getByText("ok")).toBeInTheDocument()
    expect(screen.getByText("error")).toBeInTheDocument()
    // The null bucket is a bucket: "none" appears once per column that has one.
    expect(screen.getAllByText("none")).toHaveLength(2)
  })

  it("renders a recent row's outcome, plan source, latency and citations", () => {
    render(
      <AiObservabilityReport
        {...ready({
          summary: { requestCount: 1, sampledRows: 1 },
          recent: [
            row({
              outcome: "degraded",
              planSource: "fallback",
              degradedReason: "model",
              totalMs: 1234.6,
              citationsValid: false,
            }),
          ],
        })}
      />
    )

    expect(screen.getByText("degraded")).toBeInTheDocument()
    expect(screen.getByText("fallback")).toBeInTheDocument()
    expect(screen.getByText("model")).toBeInTheDocument()
    expect(screen.getByText("1235 ms")).toBeInTheDocument()
    expect(screen.getByText("invalid")).toBeInTheDocument()
  })

  it("keeps an empty tools list distinct from a row that predates the pipeline", () => {
    render(
      <AiObservabilityReport
        {...ready({
          summary: { requestCount: 3, sampledRows: 3 },
          recent: [
            row({ id: "a", tools: null }),
            row({ id: "b", tools: [] }),
            row({ id: "c", tools: ["retrieve", "cite"] }),
          ],
        })}
      />
    )

    expect(screen.getByText("not recorded")).toBeInTheDocument()
    expect(screen.getByText("none")).toBeInTheDocument()
    expect(screen.getByText("retrieve, cite")).toBeInTheDocument()
  })

  it("says so when the window has requests but no recent rows were returned", () => {
    render(<AiObservabilityReport {...ready({ summary: { requestCount: 1, sampledRows: 1 } })} />)

    expect(screen.getByText("No recent rows.")).toBeInTheDocument()
  })
})
