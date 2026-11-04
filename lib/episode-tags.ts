/**
 * Episode tags — the single source of truth for the chips shown on a tracker row.
 *
 * WHY THIS MODULE EXISTS
 * The tracker used to show one tag per episode: the story arc, and only when
 * `content_entries.arc_id` was populated. It is null on all 1,371 catalog rows,
 * so the badge never rendered and every episode looked identical. Meanwhile the
 * data that *does* describe an episode was already in the database and unused by
 * the list: canon/filler classification (lib/canon-guide.ts), the DCW crime
 * taxonomy (dcw_cases_view), runtime, and the arc era (arcs.start_episode /
 * end_episode ranges).
 *
 * So tags are DERIVED, not stored. Nothing here writes to the DB, and every
 * derivation is a pure function of the entry plus small lookup maps, which is
 * what makes the whole thing testable without a Supabase session.
 *
 * DELIBERATELY NOT A TAG
 * Synopsis is null on 1,317 of 1,371 rows, so it is not a tag source. Runtime is
 * 25 minutes on 1,180 of 1,216 episodes, so a "25 min" chip would be noise on
 * almost every row — it is only surfaced when it is NOT the standard length
 * (a double episode or a film-length special is genuinely worth flagging).
 */

import {
  CANON_TYPES,
  canonTypeForEpisode,
  type CanonType,
} from "@/lib/canon-guide"
import { STORY_ARCS } from "@/lib/arcs-guide"

/* ────────────────────────────── Types ────────────────────────────── */

/** Tag families. Drives grouping, sort order and the filter UI. */
export const TAG_KINDS = {
  CANON: "canon",
  ARC: "arc",
  CRIME: "crime",
  LENGTH: "length",
  MILESTONE: "milestone",
} as const

export type TagKind = (typeof TAG_KINDS)[keyof typeof TAG_KINDS]

/**
 * Family names, as the filter menu labels its groups. These are reading
 * categories, not database vocabulary — "Case type" tells a reader what a
 * "Murder" chip is; "crime" does not.
 */
export const TAG_KIND_LABELS: Record<TagKind, string> = {
  [TAG_KINDS.CANON]: "Classification",
  [TAG_KINDS.ARC]: "Story arc",
  [TAG_KINDS.CRIME]: "Case type",
  [TAG_KINDS.LENGTH]: "Runtime",
  [TAG_KINDS.MILESTONE]: "Milestone",
}

export interface EpisodeTag {
  /** Stable identity — also the React key. */
  key: string
  kind: TagKind
  label: string
  /**
   * What the chip means, for the tooltip. Every tag carries one: a chip whose
   * meaning has to be guessed is decoration, not information.
   */
  title: string
  /** Lower sorts first within its kind. */
  rank: number
}

/** The slice of a content_entries row the tag builder reads. */
export interface TaggableEntry {
  id: string
  type: string
  title: string
  episode_number: number | null
  movie_number?: number | null
  runtime_minutes?: number | null
  arc_id?: string | null
}

/** Crime slugs per content id, as built by lib/queries/client/content.ts. */
export type CrimeTagMap = Map<string, string[]>

/* ─────────────────────────── Canon tags ──────────────────────────── */

/**
 * Canon is the single most useful thing to know about a Conan episode: it is
 * the difference between "watch this" and "safe to skip". It is also already
 * computed for the Canon Guide view, so the list gets it for free.
 */
const CANON_TAG_META: Record<
  CanonType,
  { label: string; title: string; rank: number }
> = {
  [CANON_TYPES.MANGA]: {
    label: "Canon",
    title: "Adapted from Gosho Aoyama's manga — part of the main story.",
    rank: 0,
  },
  [CANON_TYPES.ANIME_CANON]: {
    label: "Anime Canon",
    title: "Anime-original but story-relevant — don't skip.",
    rank: 1,
  },
  [CANON_TYPES.FILLER]: {
    label: "Non-canon",
    title: "Anime-original — not part of the main story. Safe to skip.",
    rank: 2,
  },
}

/**
 * The tag key for a canon type. Exported because the colour map in
 * `tag-styles.ts` keys off it: hand-written keys ("canon:manga" for a type
 * actually called `manga_canon`) silently fall back to the family style, so the
 * facet looks styled while every override is dead.
 */
export function canonTagKey(type: CanonType): string {
  return `canon:${type}`
}

export function canonTag(episodeNumber: number | null | undefined): EpisodeTag | null {
  const canon = canonTypeForEpisode(episodeNumber)
  if (!canon) return null
  const meta = CANON_TAG_META[canon]
  return {
    key: canonTagKey(canon),
    kind: TAG_KINDS.CANON,
    label: meta.label,
    title: meta.title,
    rank: meta.rank,
  }
}

/* ──────────────────────────── Arc tags ───────────────────────────── */

/**
 * Which story arc an episode sits in, resolved by NUMBER RANGE rather than by
 * `arc_id`.
 *
 * This is the fix for the dead arc badge: `content_entries.arc_id` is null on
 * every row in the live catalog, but the `arcs` table carries start_episode /
 * end_episode and STORY_ARCS carries the same ranges statically. Resolving by
 * range means the badge works today, with no backfill migration, and keeps
 * working when arc_id is eventually populated.
 *
 * An `arc_id` that IS set wins over the range, so a manual override (an episode
 * that belongs to a different arc than its number suggests) is respected.
 */
export function arcForEpisode(
  episodeNumber: number | null | undefined,
  arcId?: string | null,
  arcMap?: Map<string, { slug: string; title: string }> | null
): { slug: string; title: string } | null {
  if (arcId && arcMap) {
    const explicit = arcMap.get(arcId)
    if (explicit) return explicit
  }
  if (episodeNumber == null) return null
  const arc = STORY_ARCS.find(
    (a) =>
      episodeNumber >= a.episodeStart &&
      (a.episodeEnd == null || episodeNumber <= a.episodeEnd)
  )
  return arc ? { slug: arc.slug, title: arc.title } : null
}

export function arcTag(
  episodeNumber: number | null | undefined,
  arcId?: string | null,
  arcMap?: Map<string, { slug: string; title: string }> | null
): EpisodeTag | null {
  const arc = arcForEpisode(episodeNumber, arcId, arcMap)
  if (!arc) return null
  return {
    key: `arc:${arc.slug}`,
    kind: TAG_KINDS.ARC,
    label: arc.title,
    title: `Story arc: ${arc.title}.`,
    rank: 0,
  }
}

/* ─────────────────────────── Crime tags ──────────────────────────── */

/**
 * Display labels for the crime slugs stored on dcw_cases. Mirrors the slugs in
 * lib/dcw-cases.ts (CRIME_GROUPS) but is duplicated here on purpose: that module
 * imports the DCW API client, and this one is bundled into the client-side
 * tracker. Pulling the client in for a label table would ship a wiki scraper to
 * the browser.
 *
 * lib/__tests__/episode-tags.test.ts asserts the two lists agree, so the
 * duplication cannot silently drift.
 */
export const CRIME_TAG_LABELS: Record<string, string> = {
  murder: "Murder",
  "attempted-murder": "Attempted Murder",
  kidnapping: "Kidnapping",
  suicide: "Suicide",
  accident: "Accident",
  bombing: "Bombing",
  robbery: "Robbery",
  fraud: "Fraud",
  assault: "Assault",
  vandalism: "Vandalism",
  "missing-person": "Missing Person",
  other: "Other",
}

/**
 * "Other" says nothing about the episode, and a case with no crime recorded is
 * not a fact worth a chip. Both are dropped rather than shown as filler.
 */
const CRIME_TAG_IGNORED = new Set(["other"])

/**
 * Most episodes carry one crime; a few carry several. Cap at two so the row
 * stays scannable — the full list is in the case-file drawer.
 */
const MAX_CRIME_TAGS = 2

/**
 * Slugs that are contradicted by a stronger one on the same episode.
 *
 * DCW files a case under every crime it touches, so an episode where the victim
 * died can carry both "murder" and "attempted-murder" (the attempt was on
 * someone else). Showing both chips reads as a contradiction — if there was a
 * murder, "Attempted Murder" adds nothing a reader needs on a one-line row.
 */
const CRIME_SUPERSEDES: Record<string, string[]> = {
  murder: ["attempted-murder"],
}

export function crimeTags(slugs: string[] | undefined): EpisodeTag[] {
  if (!slugs || slugs.length === 0) return []

  // Drop any slug that a stronger slug on the same episode supersedes.
  const suppressed = new Set<string>()
  for (const slug of slugs) {
    for (const weaker of CRIME_SUPERSEDES[slug] ?? []) suppressed.add(weaker)
  }

  const seen = new Set<string>()
  const out: EpisodeTag[] = []
  for (const slug of slugs) {
    if (CRIME_TAG_IGNORED.has(slug) || suppressed.has(slug) || seen.has(slug)) continue
    seen.add(slug)
    const label = CRIME_TAG_LABELS[slug]
    if (!label) continue
    out.push({
      key: `crime:${slug}`,
      kind: TAG_KINDS.CRIME,
      label,
      title: `Case type: ${label}`,
      rank: out.length,
    })
    if (out.length === MAX_CRIME_TAGS) break
  }
  return out
}

/* ─────────────────────────── Length tags ─────────────────────────── */

/** The standard TV slot. Anything else is worth a chip; this is not. */
export const STANDARD_EPISODE_RUNTIME = 25

/**
 * Only non-standard runtimes get a tag. A 25-minute episode is the norm (1,180
 * of 1,216), so tagging it would put an identical chip on nearly every row and
 * train the reader to ignore the whole tag row.
 *
 * Hours are only used from 120 minutes up. A 95-minute film rounded to "2h"
 * overstates it by 25 minutes, and the whole point of the chip is precision —
 * so below two hours it stays in minutes.
 */
export function lengthTag(runtimeMinutes: number | null | undefined): EpisodeTag | null {
  if (runtimeMinutes == null || runtimeMinutes <= 0) return null
  if (runtimeMinutes === STANDARD_EPISODE_RUNTIME) return null

  const label =
    runtimeMinutes >= 120
      ? `${Math.round(runtimeMinutes / 60)}h`
      : `${runtimeMinutes}m`

  return {
    key: `length:${runtimeMinutes}`,
    kind: TAG_KINDS.LENGTH,
    label,
    title:
      runtimeMinutes > STANDARD_EPISODE_RUNTIME
        ? `Runs ${runtimeMinutes} minutes — longer than the standard 25-minute slot.`
        : `Runs ${runtimeMinutes} minutes — shorter than the standard 25-minute slot.`,
    rank: 0,
  }
}

/* ───────────────────────── Milestone tags ────────────────────────── */

/**
 * Round-number milestones. These exist because the tracker is a 1,200-item
 * checklist and "where am I" is the question it has to answer fastest — a
 * "100th" marker gives the eye an anchor when scrolling a 50-row page.
 */
const MILESTONES = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200])

export function milestoneTag(episodeNumber: number | null | undefined): EpisodeTag | null {
  if (episodeNumber == null || !MILESTONES.has(episodeNumber)) return null
  return {
    key: `milestone:${episodeNumber}`,
    kind: TAG_KINDS.MILESTONE,
    label: `${episodeNumber}th`,
    title: `Episode ${episodeNumber} — a milestone in the run.`,
    rank: 0,
  }
}

/* ──────────────────────────── Assembly ───────────────────────────── */

/** Render order of the tag families on a row. */
const KIND_ORDER: TagKind[] = [
  TAG_KINDS.CANON,
  TAG_KINDS.ARC,
  TAG_KINDS.CRIME,
  TAG_KINDS.LENGTH,
  TAG_KINDS.MILESTONE,
]

export interface BuildTagsOptions {
  /** arc_id → { slug, title }, from the content query. */
  arcMap?: Map<string, { slug: string; title: string }> | null
  /** content id → crime slugs, from dcw_cases_view. */
  crimeByContentId?: CrimeTagMap | null
  /** Cap the total chips rendered on a row. Default 4. */
  limit?: number
}

/**
 * Every tag that applies to one entry, in display order.
 *
 * Non-episodes (movies, OVAs, specials, spin-offs) get their type as a tag
 * instead of canon/filler, because "is this filler" is a question about the TV
 * run — a movie is not filler, it is a movie.
 */
export function buildEpisodeTags(
  entry: TaggableEntry,
  options: BuildTagsOptions = {}
): EpisodeTag[] {
  const { arcMap, crimeByContentId, limit = 4 } = options
  const isEpisode = entry.type === "episode"
  const tags: EpisodeTag[] = []

  if (isEpisode) {
    const canon = canonTag(entry.episode_number)
    if (canon) tags.push(canon)

    const arc = arcTag(entry.episode_number, entry.arc_id, arcMap)
    if (arc) tags.push(arc)

    tags.push(...crimeTags(crimeByContentId?.get(entry.id)))

    const length = lengthTag(entry.runtime_minutes)
    if (length) tags.push(length)

    const milestone = milestoneTag(entry.episode_number)
    if (milestone) tags.push(milestone)
  } else {
    // The type chip is added by the row itself (it already renders the type
    // badge), so only length is derived here.
    const length = lengthTag(entry.runtime_minutes)
    if (length) tags.push(length)
  }

  return sortTags(tags).slice(0, limit)
}

/** Stable ordering: family first, then the family's own rank. */
export function sortTags(tags: EpisodeTag[]): EpisodeTag[] {
  return [...tags].sort((a, b) => {
    const kindDelta = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    if (kindDelta !== 0) return kindDelta
    return a.rank - b.rank
  })
}

/**
 * The canon verdict for one row, or null when the entry has no canon data
 * (movies and specials). Every surface that labels an episode — list row,
 * quick-access card — goes through this so "green = canon" means the same thing
 * everywhere.
 */
export function canonTagOf(tags: readonly EpisodeTag[]): EpisodeTag | null {
  return tags.find((tag) => tag.kind === TAG_KINDS.CANON) ?? null
}

/**
 * Facet families worth offering as a filter.
 *
 * Length is deliberately excluded. It is useful ON a row ("this one is 115
 * minutes") but useless AS a filter: every film in the catalog shares a
 * runtime, so "95m 8" narrows to "the movies", which the type rail already
 * does better. Canon, arc and crime are the three that actually partition the
 * episode list into sets a reader wants.
 */
const FACET_KINDS = new Set<TagKind>([TAG_KINDS.CANON, TAG_KINDS.ARC, TAG_KINDS.CRIME])

/**
 * The distinct tags across a whole catalog, for the filter UI. A tag that
 * appears on one row is not a filter worth offering, so `minCount` drops the
 * long tail.
 */
export function collectTagFacets(
  entries: TaggableEntry[],
  options: BuildTagsOptions & { minCount?: number } = {}
): { tag: EpisodeTag; count: number }[] {
  const { minCount = 2, ...buildOptions } = options
  const counts = new Map<string, { tag: EpisodeTag; count: number }>()

  for (const entry of entries) {
    // Facets ignore the per-row limit — a tag that is always the 5th chip would
    // otherwise never be filterable.
    for (const tag of buildEpisodeTags(entry, { ...buildOptions, limit: Infinity })) {
      if (!FACET_KINDS.has(tag.kind)) continue
      const existing = counts.get(tag.key)
      if (existing) existing.count += 1
      else counts.set(tag.key, { tag, count: 1 })
    }
  }

  return [...counts.values()]
    .filter((f) => f.count >= minCount)
    .sort((a, b) => {
      const kindDelta = KIND_ORDER.indexOf(a.tag.kind) - KIND_ORDER.indexOf(b.tag.kind)
      if (kindDelta !== 0) return kindDelta
      return b.count - a.count
    })
}

/**
 * Facets grouped by family, in render order, for the filter menu.
 *
 * A flat list of 25 chips is a wall; three labelled groups of four to ten is a
 * menu. Empty families are dropped so the menu never shows a heading with
 * nothing under it.
 */
export function groupTagFacets(
  facets: { tag: EpisodeTag; count: number }[]
): { kind: TagKind; label: string; facets: { tag: EpisodeTag; count: number }[] }[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: TAG_KIND_LABELS[kind],
    facets: facets.filter((facet) => facet.tag.kind === kind),
  })).filter((group) => group.facets.length > 0)
}
