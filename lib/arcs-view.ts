/**
 * View logic for the Story Arcs index.
 *
 * Kept out of the page so it can be tested without React or Supabase: the
 * arc data is static (lib/arcs-guide.ts) and the watched state arrives as a
 * plain map, so everything here is a pure function of those two inputs.
 */

import type { StoryArc } from "@/lib/arcs-guide"
import type { ArcProgressInfo } from "@/lib/arcs-progress"

export interface ArcIndexRow {
  slug: string
  /** Zero-padded ordinal: "01".."07". A locator, not information. */
  ordinal: string
  title: string
  era: string
  tagline: string
  /** "Ep 1-128" or "Ep 784+". */
  span: string
  years: string
  status: "complete" | "ongoing"
  /** Episode count in this arc, after closing an open-ended arc. */
  episodes: number
  watched: number
  total: number
  percent: number
  nextUnwatchedEpisode: number | null
}

/**
 * One contiguous slice of the main plot. Widths are a true partition: the
 * arcs cover episodes 1..latest with no gaps, so the segments sum to the
 * whole show. That is what makes the spine readable as a map rather than as
 * seven unrelated bars.
 */
export interface ArcSegment {
  slug: string
  ordinal: string
  title: string
  /** Share of the main plot, to one decimal. All segments sum to 100. */
  widthPercent: number
  episodes: number
  /** Watched episodes in this era, for the progress fill inside the segment. */
  watched: number
  /** Watch progress through this era, 0-100. */
  percent: number
  /**
   * True when the floor inflated this segment, so the UI can print the count
   * outside the mark instead of squeezing it in.
   */
  isNarrowest: boolean
}

/**
 * Narrowest a segment may render, in percent of the spine. Below this the
 * ordinal cannot be read and the segment looks like a rendering artefact.
 */
const MIN_SEGMENT_WIDTH = 4

/**
 * Build the index rows in story order. `progress` is keyed by slug and may be
 * missing entries (a new arc added to the guide before its progress is
 * computed); those rows render with a zeroed bar rather than throwing.
 */
export function buildArcIndex(
  arcs: StoryArc[],
  progress: Map<string, ArcProgressInfo>
): ArcIndexRow[] {
  return [...arcs]
    .sort((a, b) => a.order - b.order)
    .map((arc) => {
      const p = progress.get(arc.slug)
      const total = p?.total ?? 0
      return {
        slug: arc.slug,
        ordinal: String(arc.order).padStart(2, "0"),
        title: arc.title,
        era: arc.era,
        tagline: arc.tagline,
        span:
          arc.episodeEnd === null
            ? `Ep ${arc.episodeStart}+`
            : `Ep ${arc.episodeStart}-${arc.episodeEnd}`,
        years: arc.years,
        status: arc.status,
        episodes: total,
        watched: p?.watched ?? 0,
        total,
        percent: p?.percent ?? 0,
        nextUnwatchedEpisode: p?.nextUnwatchedEpisode ?? null,
      }
    })
}

/**
 * Turn the rows into proportional segments.
 *
 * A segment narrower than MIN_SEGMENT_WIDTH cannot hold its ordinal and reads
 * as a rendering artefact, so narrow arcs are given the floor and the surplus
 * is taken from the segments that have room to spare. This is water-filling,
 * not "lift then renormalise": lifting first and dividing by the new total
 * shrinks every segment including the lifted one, which lands the sliver back
 * under the floor it was raised to clear (a 1-episode arc came out at 6.5%
 * against a 7% floor). Here the floor is a constraint on the RESULT, so it
 * holds by construction and the widths still sum to 100.
 */
export function buildArcSegments(rows: ArcIndexRow[]): ArcSegment[] {
  const total = rows.reduce((sum, row) => sum + row.episodes, 0)
  if (total <= 0) return []

  const raw = rows.map((row) => (row.episodes / total) * 100)
  const widest = Math.max(...raw)

  // More segments than the floor can fit: spreading 100 across them, every
  // slice is already under the floor, so fall back to the true proportions
  // rather than inventing a partition that does not add up.
  const widths =
    MIN_SEGMENT_WIDTH * raw.length >= 100
      ? raw
      : waterFill(raw, MIN_SEGMENT_WIDTH, 100)

  const rounded = roundPreservingTotal(widths, 100)
  const narrowest = Math.min(...raw)

  return rows.map((row, i) => ({
    slug: row.slug,
    ordinal: row.ordinal,
    title: row.title,
    widthPercent: rounded[i],
    episodes: row.episodes,
    watched: row.watched,
    percent: row.percent,
    isNarrowest: raw[i] === narrowest && widest > MIN_SEGMENT_WIDTH,
  }))
}

/**
 * Round each width to one decimal without losing the total.
 *
 * Rounding independently leaves up to 0.05% of slack per segment, and with
 * many segments that accumulates into a visible gap at the end of the spine
 * (30 segments summed to 98.9). Largest-remainder rounding hands the leftover
 * tenths to the segments that were rounded down hardest, so the widths always
 * sum to exactly `total`.
 */
function roundPreservingTotal(values: number[], total: number): number[] {
  const scaled = values.map((v) => v * 10)
  const floored = scaled.map(Math.floor)
  const target = Math.round(total * 10)
  let remainder = target - floored.reduce((a, b) => a + b, 0)

  // Hand out the missing tenths, largest fractional part first.
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)

  const result = [...floored]
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    result[order[k].i] += 1
  }
  // Over-rounded (remainder negative): take tenths back from the smallest.
  for (let k = order.length - 1; remainder < 0 && k >= 0; k--, remainder++) {
    if (result[order[k].i] > 0) result[order[k].i] -= 1
  }
  return result.map((v) => v / 10)
}

/**
 * Give every value at least `floor`, taking the shortfall from the values
 * above it in proportion to their surplus. Converges in one pass for any
 * input where `floor * n < total`.
 */
function waterFill(values: number[], floor: number, total: number): number[] {
  let result = [...values]
  for (let pass = 0; pass < values.length; pass++) {
    const short = result.reduce((sum, w) => sum + Math.max(0, floor - w), 0)
    if (short <= 0) break
    const spare = result.reduce((sum, w) => sum + Math.max(0, w - floor), 0)
    if (spare <= 0) break
    result = result.map((w) =>
      w < floor ? floor : w - ((w - floor) / spare) * short
    )
  }
  // Guard against float drift so the spine never overflows its track.
  const sum = result.reduce((a, b) => a + b, 0)
  return result.map((w) => (w / sum) * total)
}

/** Totals for the page's opening line: the scale of the story being indexed. */
export function summarizeArcs(rows: ArcIndexRow[]): {
  eras: number
  episodes: number
  ongoing: number
  firstYear: string
  lastYear: string
} {
  const episodes = rows.reduce((sum, row) => sum + row.episodes, 0)
  const years = rows.map((row) => row.years)
  const first = years[0] ?? ""
  const last = years[years.length - 1] ?? ""
  return {
    eras: rows.length,
    episodes,
    ongoing: rows.filter((row) => row.status === "ongoing").length,
    // "1996-1998" -> "1996"; "2015-present" -> "present"
    firstYear: first.split("-")[0] ?? first,
    lastYear: last.split("-").pop() ?? last,
  }
}

/** The episode a signed-in reader should watch next inside a given arc. */
export function nextEpisodeLabel(row: ArcIndexRow, signedIn: boolean): string | null {
  if (!signedIn || row.nextUnwatchedEpisode === null) return null
  return `Next: Ep ${row.nextUnwatchedEpisode}`
}
