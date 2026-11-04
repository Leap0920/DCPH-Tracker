import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { nextEpisodeLabel, type ArcIndexRow } from "@/lib/arcs-view"

interface ArcRowProps {
  row: ArcIndexRow
  signedIn: boolean
  /** Alternating rows get a faint wash so the eye can track a long line. */
  striped: boolean
}

/**
 * One era, as a row in a divided surface rather than a card of its own.
 *
 * The row is a fixed grid so the columns line up down the whole list: ordinal,
 * title block, episode span, then progress. Under a flex row every span would
 * shift by the width of the title beside it, and the column stops being
 * scannable — which is the point of putting seven arcs in one surface.
 */
export function ArcRow({ row, signedIn, striped }: ArcRowProps) {
  const next = nextEpisodeLabel(row, signedIn)
  const complete = signedIn && row.total > 0 && row.watched >= row.total

  return (
    <Link
      href={`/arcs/${row.slug}`}
      aria-label={`${row.title}, ${row.span}${signedIn ? `, ${row.watched} of ${row.total} watched` : ""}`}
      className={cn(
        "group grid items-center gap-x-4 gap-y-1.5 px-4 py-3.5 sm:gap-y-2 sm:px-5 sm:py-4",
        // Two columns at narrow width; five at reading width — ordinal, title,
        // span, progress, arrow. The count must match the children below or the
        // arrow wraps to a second row and the row doubles in height.
        "grid-cols-[1.75rem_minmax(0,1fr)]",
        "sm:grid-cols-[1.75rem_minmax(0,1fr)_7rem_10.5rem_0.875rem]",
        "transition-colors hover:bg-surface-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-bright",
        striped && "bg-surface-muted/40"
      )}
    >
      <span
        aria-hidden
        className="font-mono text-[11px] tabular-nums leading-none text-ink-faint"
      >
        {row.ordinal}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="font-display text-base leading-snug tracking-tight text-ink group-hover:text-accent-bright">
            {row.title}
          </h3>
          {row.status === "ongoing" && (
            <span className="rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-success">
              ongoing
            </span>
          )}
          {complete && (
            // Green, matching the completed bar in the same row. The badge and
            // the bar say the same thing, so they must not disagree on colour.
            <span className="rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-success">
              done
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[13px] leading-snug text-ink-dim">
          {row.tagline}
        </p>
        {/* The span and years live under the title on narrow screens, where
            there is no room for the dedicated columns. */}
        <p className="mt-1 font-mono text-[10px] text-ink-faint sm:hidden">
          {row.span} · {row.years}
        </p>
      </div>

      <div className="hidden sm:col-start-auto sm:block sm:text-right">
        <span className="hidden font-mono text-[11px] tabular-nums text-ink-dim sm:block">
          {row.span}
        </span>
        <span className="hidden font-mono text-[10px] text-ink-faint sm:block">
          {row.years}
        </span>
      </div>

      <div className="col-start-2 sm:col-start-auto">
        {signedIn ? (
          <>
            <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
              <span className="text-ink-dim">
                {row.watched}
                <span className="text-ink-faint">/{row.total}</span>
              </span>
              <span className="text-ink-faint">{row.percent}%</span>
            </div>
            {/* The track needs to be visible: a 1px bar on a track that is the
                same value as the row background reads as an empty slot, and
                the bar length stops being measurable. */}
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-faint/20">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  complete ? "bg-success" : "bg-accent"
                )}
                style={{ width: `${row.percent}%` }}
              />
            </div>
            {next && (
              <span className="mt-1 block font-mono text-[10px] text-ink-faint">{next}</span>
            )}
          </>
        ) : (
          // Signed out there is no progress to show, so the slot carries the
          // arc's size instead of an empty bar — a zeroed bar reads as "you
          // have watched none of this", which is a claim we cannot make.
          <span className="block text-right font-mono text-[10px] text-ink-faint">
            {row.total.toLocaleString()} eps
          </span>
        )}
      </div>

      <ArrowRight
        aria-hidden
        className="hidden h-3.5 w-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-accent-bright sm:col-start-auto sm:block"
      />
    </Link>
  )
}
