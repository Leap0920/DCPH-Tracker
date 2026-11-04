import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ArcSegment } from "@/lib/arcs-view"

interface ArcSpineProps {
  segments: ArcSegment[]
  signedIn: boolean
  /** First and last episode of the main plot, for the axis labels. */
  firstEpisode: number
  lastEpisode: number
}

/**
 * The whole main plot as one proportional bar, with your progress inside it.
 *
 * Each segment's width is its share of the episode count, so the eras are read
 * as a map: Bourbon (275 episodes) is visibly more than twice the Conan arc
 * (128), and the segments together are the entire show. The wash inside each
 * segment is how far through that era you are, so the bar answers "how much of
 * this is left" for all seven eras at once — which is the question a tracker
 * exists to answer.
 *
 * No text sits inside the segments. The narrowest era is ~40px wide, so a name
 * would clip to an ellipsis, and a label sitting on a 100%-filled segment would
 * be washed out by its own fill. A legend beneath carries every name at a size
 * that reads, keyed to the segments by ordinal — and because all seven get the
 * same treatment, none of them looks like missing data.
 */
export function ArcSpine({
  segments,
  signedIn,
  firstEpisode,
  lastEpisode,
}: ArcSpineProps) {
  if (segments.length === 0) return null

  const totalEpisodes = segments.reduce((sum, seg) => sum + seg.episodes, 0)
  const watchedTotal = segments.reduce((sum, seg) => sum + seg.watched, 0)

  return (
    <section aria-label="The main plot to scale">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-sm tracking-tight text-ink">
          The main plot, to scale
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          {signedIn
            ? `${watchedTotal.toLocaleString()} of ${totalEpisodes.toLocaleString()} watched`
            : `${totalEpisodes.toLocaleString()} episodes`}
        </p>
      </div>

      {/* The spine. A 2px gap over a line-coloured track means the hairlines
          between segments are the track showing through, not extra borders —
          without them two adjacent segments at similar progress merge into one
          block and the boundaries stop being readable. */}
      <div className="mt-3 flex h-16 w-full gap-[2px] overflow-hidden rounded-md bg-line">
        {segments.map((seg) => {
          const done = signedIn && seg.episodes > 0 && seg.watched >= seg.episodes
          return (
            <Link
              key={seg.slug}
              href={`/arcs/${seg.slug}`}
              title={
                signedIn
                  ? `${seg.title} — ${seg.watched} of ${seg.episodes.toLocaleString()} watched`
                  : `${seg.title} — ${seg.episodes.toLocaleString()} episodes`
              }
              aria-label={
                signedIn
                  ? `${seg.title}: ${seg.watched} of ${seg.episodes} episodes watched, ${seg.widthPercent}% of the main plot`
                  : `${seg.title}: ${seg.episodes} episodes, ${seg.widthPercent}% of the main plot`
              }
              style={{ width: `${seg.widthPercent}%` }}
              className={cn(
                "group relative min-w-0 bg-surface-muted",
                "transition-colors hover:bg-surface",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
                "focus-visible:ring-accent-bright"
              )}
            >
              {/* The progress wash. Anchored to the bottom so all seven fills
                  sit on one baseline and can be compared across the row — a
                  top-anchored fill would make the segments jump as they grow. */}
              {signedIn && (
                <span
                  aria-hidden
                  style={{ height: `${seg.percent}%` }}
                  className={cn(
                    "absolute inset-x-0 bottom-0 transition-[height] duration-500",
                    done ? "bg-success/30" : "bg-accent/30"
                  )}
                />
              )}
              {/* A hairline of accent at the very bottom marks the hovered
                  segment without covering its wash. */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] bg-accent-bright opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </Link>
          )
        })}
      </div>

      {/* The axis: the bar spans the whole show, so it needs its ends named. */}
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-ink-faint">
        <span>Ep {firstEpisode}</span>
        <span>Ep {lastEpisode.toLocaleString()}</span>
      </div>

      {/* The legend. Every era, same treatment, so nothing looks like missing
          data — and at this size the names are legible, which they are not
          inside a 40px segment. */}
      <ul className="mt-2 grid grid-cols-2 gap-x-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
        {segments.map((seg) => (
          <li key={seg.slug}>
            {/* A wrapped flex row left the second line ragged and misaligned;
                two fixed columns keep the ordinals in a readable stack. The
                vertical padding is the tap target — 10px text alone is far
                too small to hit. */}
            <Link
              href={`/arcs/${seg.slug}`}
              className="group flex items-baseline gap-1.5 py-1.5 font-mono text-[11px] text-ink-faint transition-colors hover:text-ink"
            >
              <span aria-hidden className="tabular-nums">
                {seg.ordinal}
              </span>
              <span className="truncate border-b border-transparent transition-colors group-hover:border-line">
                {seg.title.replace(/ Arc.*$/, "")}
              </span>
              {/* The percentage is what ties the legend to the bar: without a
                  number the names are a list next to a chart, and the reader
                  has to eyeball which shade belongs to which era. */}
              {signedIn && (
                <span className="tabular-nums text-ink-faint/70">{seg.percent}%</span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-ink-faint">
        {signedIn
          ? "Width is episode count; the shade is how much you have watched. Pick an era for its episodes, key figures and where you are."
          : "Width is episode count. Sign in to track your progress through each era."}
      </p>
    </section>
  )
}
