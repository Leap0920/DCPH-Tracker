"use client"

import Link from "next/link"
import { useState } from "react"
import { cn } from "@/lib/utils"
import type { CrimeSegment } from "@/lib/cases-view"

interface CrimeSpectrumProps {
  segments: CrimeSegment[]
  /** Active ?type= slug, so the matching slice can show as selected. */
  activeSlug: string
  /** Total classified crimes, printed once at the end of the header line. */
  totalCrimes: number
}

/**
 * The archive's crime mix as one proportional strip.
 *
 * This is the map the page was missing: 2,018 crimes across twelve groups, and
 * until now the only way to learn the shape was to open a dropdown and read
 * twelve counts. Here the shape is the composition — murder is visibly most of
 * the archive, and the long tail is visibly a tail.
 *
 * Each segment is a filter link, so the map doubles as navigation: the thing
 * you noticed is the thing you click. Widths come from buildCrimeDistribution,
 * which partitions exactly 100%.
 *
 * Colour is deliberately NOT per-category. Twelve hues would be decoration —
 * the categories are not ordered on any scale the reader needs to hold in
 * memory, and the legend labels every slice anyway. One accent marks the
 * selected slice; the rest stay neutral so the shape reads as one object.
 */

/**
 * A slice label that fits inside a narrow box.
 *
 * "Kidnapping & Hostage" never fits in a 9%-wide slice, but "Kidnapping" does.
 * The full name is still in the key below and in the title/aria-label, so the
 * short form costs nothing — it just stops the tail of the bar from being a
 * run of anonymous grey blocks.
 */
export function shortSliceLabel(label: string): string {
  if (label === "Attempted Murder") return "Attempted"
  if (label === "Other Cases") return "Other"
  if (label === "Missing Person") return "Missing"
  return label.split(" & ")[0]
}

/**
 * Whether a label physically fits in a slice.
 *
 * 6.2px is the width of one character at 10px in this mono face and 18px is the
 * horizontal padding, both measured off the rendered bar. Percentages are taken
 * against the 1024px max-w-5xl container — the labels only render at `lg`, so
 * that is the width they are always measured against.
 */
function sliceLabelFits(label: string, widthPercent: number): boolean {
  const neededPx = label.length * 6.2 + 18
  return (neededPx / 1024) * 100 <= widthPercent
}

export function CrimeSpectrum({ segments, activeSlug, totalCrimes }: CrimeSpectrumProps) {
  // Which slice the pointer is on, so the strip and the legend light up
  // together. Twelve identically-coloured slices cannot be told apart by
  // colour, so the only honest way to answer "which sliver is that" is to make
  // hovering either half identify the other.
  const [hovered, setHovered] = useState<string | null>(null)

  if (segments.length === 0) return null

  const grouped = segments.reduce((sum, segment) => sum + segment.count, 0)
  const readout = segments.find((segment) => segment.slug === hovered)
  const ungrouped = Math.max(0, totalCrimes - grouped)

  return (
    <section aria-labelledby="crime-mix-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="crime-mix-heading"
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
        >
          What the archive is made of
        </h2>
        {/* The total lives in the masthead. Printing it again here meant the
            same number appeared twice within 200px, either side of the bar.
            In its place: a readout for the slice under the pointer. The tail
            of the bar is six slivers between 7px and 37px wide, which cannot
            hold a single glyph — this names whichever one is hovered or
            focused, so no slice is anonymous. */}
        <p className="min-h-[14px] font-mono text-[10px] tabular-nums text-ink-faint">
          {readout
            ? `${readout.label} · ${readout.count.toLocaleString()} crimes · ${readout.widthPercent}%`
            : ungrouped > 0
              ? `${ungrouped.toLocaleString()} unclassified`
              : ""}
        </p>
      </div>

      {/* A 2px gap over a line-coloured track: the hairlines between slices are
          the track showing through, not extra borders. Without them two
          adjacent groups of similar width merge into one block. */}
      {/* The strip is the map, but below `sm` it cannot also be the control:
          twelve groups across 358px puts the smallest at 3px, and a 3px link
          is not a tap target. On mobile it renders as a plain mark and the
          legend underneath carries the navigation. */}
      <div className="mt-2 flex h-9 w-full gap-[2px] overflow-hidden rounded-sm bg-surface-muted">
        {segments.map((segment) => {
          const isActive = segment.slug === activeSlug
          const inner = (
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 hidden items-center justify-center px-2 lg:flex",
                "font-mono text-[10px] uppercase tracking-[0.08em]",
                // These sit ON a fill, not on the page: ink-faint is AA against
                // the background but only ~2.4:1 against a 40% fill in light
                // theme. Full-strength ink clears both themes.
                isActive ? "text-white" : "text-ink"
              )}
            >
              {shortSliceLabel(segment.label)}
            </span>
          )
          const cls = cn(
            "group relative min-w-0 transition-colors",
            isActive ? "bg-accent" : "bg-ink-faint/40 hover:bg-ink-faint/60"
          )
          return (
            <Link
              key={segment.slug}
              href={`/cases?type=${encodeURIComponent(segment.slug)}`}
              title={`${segment.label} — ${segment.count.toLocaleString()} crimes (${segment.widthPercent}%)`}
              aria-label={`Filter by ${segment.label}: ${segment.count} crimes, ${segment.widthPercent}% of the archive`}
              style={{ width: `${segment.widthPercent}%` }}
              onMouseEnter={() => setHovered(segment.slug)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(segment.slug)}
              onBlur={() => setHovered(null)}
              className={cn(
                cls,
                "hidden sm:block",
                hovered === segment.slug && "bg-accent-bright",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
                "focus-visible:ring-accent-bright"
              )}
            >
              {/* A name clipped to an ellipsis inside a 2%-wide box reads as a
                  rendering bug, so a slice is only labelled when the short
                  name actually fits. Below `lg` the container is narrower than
                  the 1024px these measurements assume, so labels are dropped
                  rather than allowed to truncate. */}
              {sliceLabelFits(shortSliceLabel(segment.label), segment.widthPercent) && inner}
            </Link>
          )
        })}
        {/* Mobile: same geometry, no links. */}
        <div className="flex h-9 w-full gap-[2px] sm:hidden" aria-hidden>
          {segments.map((segment) => (
            <span
              key={segment.slug}
              style={{ width: `${segment.widthPercent}%` }}
              className={cn(
                "relative min-w-0",
                segment.slug === activeSlug ? "bg-accent" : "bg-ink-faint/40"
              )}
            />
          ))}
        </div>
      </div>

      {/* The legend. Every group, same treatment, with its count — the numbers
          are what tie the strip to the filter options. */}
      {/* Below `sm` the twelve chips wrapped to five rows and cost 212px
          before the first case — more vertical space than the strip itself.
          One scrollable row matches the category rail directly underneath and
          keeps every group reachable. From `sm` they wrap, because a pointer
          can hover the strip and the wrap reads as a legend. */}
      {/* Text, not chips. These twelve sat directly above the nine content
          tabs and were styled identically — two rows of bordered pills, same
          height, same grey, filtering two different things. One of them had to
          stop looking like a tab bar. This is the legend for the bar above it,
          so it reads as a legend: no boxes, no borders, dot-separated. */}
      <ul className="-mx-4 mt-1.5 flex items-center gap-x-4 gap-y-0.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {segments.map((segment) => (
          <li key={segment.slug} className="flex shrink-0 items-center">
            <Link
              href={`/cases?type=${encodeURIComponent(segment.slug)}`}
              onMouseEnter={() => setHovered(segment.slug)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(segment.slug)}
              onBlur={() => setHovered(null)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-1 py-1",
                "font-mono text-[11px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40",
                segment.slug === activeSlug
                  ? "bg-accent-soft text-accent-bright"
                  : hovered === segment.slug
                    ? "bg-surface-muted text-ink"
                    : "text-ink-faint hover:text-ink"
              )}
            >
              <span>{segment.label}</span>
              <span
                className={cn(
                  "tabular-nums",
                  segment.slug === activeSlug ? "text-accent-bright/70" : "text-ink-faint/70"
                )}
              >
                {segment.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
