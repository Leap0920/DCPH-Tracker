import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type {
  FeedbackSummary,
  LatencySummary,
  RequestLogRow,
  WindowSummary,
} from "@/lib/ai/observability/store"

/**
 * The operator surface for `ai_request_log`, as a pure render of what the store
 * returned. No fetching, no client directive and no `lib/env`: the page reads the
 * store server-side (D1), and the vitest dom project -- which deliberately loads
 * no `.env.local` -- can therefore render this directly.
 *
 * Two absences are distinguished, because they mean different things.
 * `unavailable` is the log that cannot be read at all: the deployed project has
 * none of the `20260919*` migrations applied, so every store method rejects, and
 * the PostgREST text differs by version -- which is why nothing here matches on
 * it. A zero-row window is not that: it is a window with no traffic, and it says
 * so.
 */
export type AiObservabilityReportProps =
  | { status: "unavailable" }
  | {
      status: "ready"
      summary: WindowSummary
      recent: RequestLogRow[]
      feedback: FeedbackSummary
    }

const numberFormat = new Intl.NumberFormat("en-US")

function formatCount(value: number): string {
  return numberFormat.format(value)
}

/** Epoch ms as ISO text; an undatable row renders as a dash rather than throwing. */
function formatTimestamp(ms: number): string {
  return Number.isNaN(ms) ? "—" : new Date(ms).toISOString()
}

/**
 * A latency with no samples is "no data", never "0 ms": `count` is the non-null
 * samples, so a stage that never ran has no latency to report.
 */
function formatLatency(ms: number | null): string {
  return ms === null ? "no data" : `${Math.round(ms)} ms`
}

function formatCitations(value: boolean | null): string {
  if (value === null) return "unmeasured"
  return value ? "valid" : "invalid"
}

/** `[]` (nothing was dispatched) and `null` (the row predates the pipeline) differ. */
function formatTools(tools: string[] | null): string {
  if (tools === null) return "not recorded"
  if (tools.length === 0) return "none"
  return tools.join(", ")
}

function Tile({
  label,
  value,
  hint,
  badge,
}: {
  label: string
  value: string
  hint?: string
  badge?: ReactNode
}) {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          {label}
        </span>
        {badge}
      </div>
      <div className="mt-2 font-display text-[22px] leading-none tracking-tight tabular-nums text-ink">
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 font-mono text-[10px] text-ink-faint">{hint}</div>
      ) : null}
    </div>
  )
}

/** Counts by a free-text column, most frequent first. An empty map is "no rows", not a blank. */
function BucketList({
  title,
  buckets,
}: {
  title: string
  buckets: Record<string, number>
}) {
  const entries = Object.entries(buckets).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )

  return (
    <div className="min-w-0">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No rows.</p>
      ) : (
        <ul className="rounded-md border border-line">
          {entries.map(([key, count]) => (
            <li
              key={key}
              className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-1.5 last:border-b-0"
            >
              <span className="truncate font-mono text-[11px] text-ink-dim">{key}</span>
              <span className="font-mono text-[11px] tabular-nums text-ink">
                {formatCount(count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LatencyRow({ label, latency }: { label: string; latency: LatencySummary }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-3 py-2 text-[12px] text-ink-dim">{label}</td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink-dim">
        {formatCount(latency.count)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink">
        {formatLatency(latency.p50)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink">
        {formatLatency(latency.p95)}
      </td>
    </tr>
  )
}

const HEAD_CELL =
  "px-3 py-2 text-left font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint"

function RecentRow({ row }: { row: RequestLogRow }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-ink-dim">
        {formatTimestamp(row.createdAt)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink">{row.outcome}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">
        {row.planSource ?? "none"}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">
        {row.degradedReason ?? "none"}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink-dim">
        {formatLatency(row.totalMs)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">
        {formatCitations(row.citationsValid)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">
        {formatTools(row.tools)}
      </td>
      <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-ink-faint">
        {row.targetId ?? "—"}
      </td>
    </tr>
  )
}

function Unavailable() {
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="font-display text-xl tracking-tight text-ink">AI request log</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">The request log is not available yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[13px] text-ink-dim">
          <p>
            No numbers are shown because the request log could not be read. This is the expected
            state until the observability migrations are applied to this project.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export function AiObservabilityReport(props: AiObservabilityReportProps) {
  if (props.status === "unavailable") return <Unavailable />

  const { summary, recent, feedback } = props
  const sinceIso = formatTimestamp(summary.sinceMs)
  const untilIso = formatTimestamp(summary.untilMs)
  const emptyWindow = summary.requestCount === 0

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="font-display text-xl tracking-tight text-ink">AI request log</h1>
        <p className="text-[13px] text-ink-dim">
          Numbers below come from{" "}
          <span className="font-mono text-[12px]">ai_request_log</span>, for the window{" "}
          <span className="font-mono text-[12px] tabular-nums">{sinceIso}</span> to{" "}
          <span className="font-mono text-[12px] tabular-nums">{untilIso}</span> — the window that
          was actually read, after the store applies its own bounds.
        </p>
      </header>

      <section aria-labelledby="ai-summary-heading" className="space-y-3">
        <h2
          id="ai-summary-heading"
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
        >
          Summary
        </h2>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Requests"
            value={formatCount(summary.requestCount)}
            hint="exact count in the window"
          />
          <Tile
            label="Rows read"
            value={formatCount(summary.sampledRows)}
            hint={
              summary.sampled
                ? "the breakdown below is sampled"
                : "the breakdown below is complete"
            }
            badge={
              summary.sampled ? (
                <Badge variant="outline">sampled</Badge>
              ) : (
                <Badge variant="secondary">complete</Badge>
              )
            }
          />
          <Tile
            label="Feedback"
            value={`${formatCount(feedback.up)} up · ${formatCount(feedback.down)} down`}
            hint={`${formatCount(feedback.noted)} with a note`}
          />
          <Tile
            label="Citations"
            value={`${formatCount(summary.citations.valid)} valid`}
            hint={`${formatCount(summary.citations.invalid)} invalid · ${formatCount(
              summary.citations.unmeasured
            )} unmeasured`}
          />
        </div>

        {summary.sampled ? (
          <p className="text-[12px] text-ink-dim">
            The request count is exact, but the breakdown and the latency below come from a sample
            of {formatCount(summary.sampledRows)} of {formatCount(summary.requestCount)} rows.
          </p>
        ) : null}
      </section>

      {emptyWindow ? (
        <section aria-labelledby="ai-empty-heading">
          <h2
            id="ai-empty-heading"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
          >
            Recent activity
          </h2>
          <p className="mt-3 text-[13px] text-ink-dim">
            No requests were logged in this window.
          </p>
        </section>
      ) : (
        <>
          <section aria-labelledby="ai-breakdown-heading" className="space-y-3">
            <h2
              id="ai-breakdown-heading"
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
            >
              Breakdown
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <BucketList title="Outcome" buckets={summary.byOutcome} />
              <BucketList title="Degraded reason" buckets={summary.byDegradedReason} />
              <BucketList title="Plan source" buckets={summary.byPlanSource} />
            </div>
            <p className="text-[11px] text-ink-faint">
              A null reason or plan source (a request written before the pipeline) is counted under
              “none” rather than dropped.
            </p>
          </section>

          <Separator />

          <section aria-labelledby="ai-latency-heading" className="space-y-3">
            <h2
              id="ai-latency-heading"
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
            >
              Latency
            </h2>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-white/[0.02]">
                    <th className={HEAD_CELL}>Stage</th>
                    <th className={HEAD_CELL}>Samples</th>
                    <th className={HEAD_CELL}>p50</th>
                    <th className={HEAD_CELL}>p95</th>
                  </tr>
                </thead>
                <tbody>
                  <LatencyRow label="Retrieve (includes plan)" latency={summary.latency.retrieveMs} />
                  <LatencyRow label="TTFT" latency={summary.latency.ttftMs} />
                  <LatencyRow label="Total" latency={summary.latency.totalMs} />
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-faint">
              Samples count the rows that carried the measurement, not every row: a stage that did
              not run reports “no data”, not zero.
            </p>
          </section>

          <Separator />

          <section aria-labelledby="ai-recent-heading" className="space-y-3">
            <h2
              id="ai-recent-heading"
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
            >
              Recent requests
            </h2>
            {recent.length === 0 ? (
              <p className="text-[13px] text-ink-dim">No recent rows.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line bg-white/[0.02]">
                      <th className={HEAD_CELL}>Time</th>
                      <th className={HEAD_CELL}>Outcome</th>
                      <th className={HEAD_CELL}>Plan source</th>
                      <th className={HEAD_CELL}>Degraded</th>
                      <th className={HEAD_CELL}>Total</th>
                      <th className={HEAD_CELL}>Citations</th>
                      <th className={HEAD_CELL}>Tools</th>
                      <th className={HEAD_CELL}>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row) => (
                      <RecentRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
