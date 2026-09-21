/**
 * Which story arcs overlap an episode range.
 *
 * Users arrive with ranges ("what happens between 500 and 600", "which arc is
 * 400 in"), and the honest answer is an interval intersection over STORY_ARCS.
 * No model judgement is involved, so the answer cannot drift.
 */
import { MAX_EPISODE } from "@/lib/canon-guide"
import { STORY_ARCS, type StoryArc } from "@/lib/arcs-guide"

export interface ArcOverlap {
  slug: string
  title: string
  episodeStart: number
  /** Resolved: an ongoing arc reports MAX_EPISODE, never null. */
  episodeEnd: number
  overlapStart: number
  overlapEnd: number
}

/** Arcs overlapping [start, end], in arc order. Swaps a reversed range. */
export function arcForRange(
  start: number,
  end: number = start,
  arcs: StoryArc[] = STORY_ARCS
): ArcOverlap[] {
  // People say "500 to 100" as readily as "100 to 500"; both mean the same span.
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)

  return [...arcs]
    // Arc order, not array order: a fixture or a slice of DB rows can be shuffled.
    .sort((a, b) => a.order - b.order)
    .flatMap((arc): ArcOverlap[] => {
      // `episodeEnd: null` means still airing, so it reaches the latest tracked
      // episode. MAX_EPISODE is the authority here; ARC_DB_ROWS' literal 1209 is
      // stale and must not be copied.
      const episodeEnd = arc.episodeEnd ?? MAX_EPISODE
      const overlapStart = Math.max(lo, arc.episodeStart)
      const overlapEnd = Math.min(hi, episodeEnd)
      if (overlapStart > overlapEnd) return []
      return [
        {
          slug: arc.slug,
          title: arc.title,
          episodeStart: arc.episodeStart,
          episodeEnd,
          overlapStart,
          overlapEnd,
        },
      ]
    })
}
