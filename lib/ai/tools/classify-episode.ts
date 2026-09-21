/**
 * "Is episode 500 filler?" answered from the canon table, not from a model.
 *
 * The partition of 1..MAX_EPISODE into manga / filler / anime canon already
 * exists in lib/canon-guide.ts and is validated by its own test. A lookup makes
 * the answer correct by construction; a model guess makes it plausible and wrong.
 */
import {
  CANON_TYPE_LABELS,
  MAX_EPISODE,
  canonTypeForEpisode,
  type CanonType,
} from "@/lib/canon-guide"
import { STORY_ARCS, type StoryArc } from "@/lib/arcs-guide"
import { arcForRange } from "@/lib/ai/tools/arc-for-range"

export interface EpisodeClassification {
  episode: number
  /** False when the number is outside 1..MAX_EPISODE or not an integer. */
  valid: boolean
  canonType: CanonType | null
  canonLabel: string | null
  arcs: Array<{ slug: string; title: string }>
  /** One sentence, already correct: "Episode 500 is Manga Canon." */
  sentence: string
}

export function classifyEpisode(
  episode: number,
  arcs: StoryArc[] = STORY_ARCS
): EpisodeClassification {
  const canonType = canonTypeForEpisode(episode)
  const valid = Number.isInteger(episode) && episode >= 1 && episode <= MAX_EPISODE

  if (!valid) {
    return {
      episode,
      valid: false,
      canonType: null,
      canonLabel: null,
      // A fractional number inside a range (1.5 in 1-128) would otherwise be
      // reported as arc membership while the same result calls it invalid.
      arcs: [],
      sentence: `Episode ${episode} is outside the tracked range (1-${MAX_EPISODE}).`,
    }
  }

  // Route arc membership through the range tool so both tools share one overlap
  // rule — a second copy of "null end means MAX_EPISODE" is how 1209 came back.
  const overlapping = arcForRange(episode, episode, arcs)

  return {
    episode,
    valid: true,
    canonType,
    canonLabel: canonType ? CANON_TYPE_LABELS[canonType] : null,
    arcs: overlapping.map(({ slug, title }) => ({ slug, title })),
    sentence: canonType
      ? `Episode ${episode} is ${CANON_TYPE_LABELS[canonType]}.`
      : `Episode ${episode} is within the tracked range but has no canon classification.`,
  }
}
