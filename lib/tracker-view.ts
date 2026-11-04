/**
 * The /tracker view-model.
 *
 * WHY THIS MODULE EXISTS
 * ContentGrid used to hold the filters, the section builder, the jump maths and
 * 700 lines of JSX in one file. Every change to the list meant re-reading the
 * whole component, and none of the ordering rules could be tested without a
 * React renderer and a Supabase session.
 *
 * So the rules live here as pure functions over `content_entries` rows:
 * which types exist, which rows a filter keeps, how the catalogue splits into
 * sections for each view mode, and where a "jump to episode" lands. ContentGrid
 * is now layout + state, and the rules can be unit-tested directly
 * (lib/__tests__/tracker-view.test.ts).
 *
 * THERE IS NO "ALL" TYPE
 * The tracker always shows exactly one category. "All" was a tab that meant
 * "episodes plus everything else, grouped", which is what the year accordion
 * already does — and it made every count on the rail double-count. Episodes are
 * the default because that is what a Conan tracker is for.
 */

import { canonTypeForEpisode, type CanonType } from "@/lib/canon-guide"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
  type ViewMode,
  type WatchStatus,
} from "@/lib/constants"
import type { EpisodeTag } from "@/lib/episode-tags"
import { isNonMainlineMovie } from "@/lib/movies-guide"
import { SUBCATEGORY_CONFIGS } from "@/lib/subcategories"
import type { Database } from "@/types/database.types"

export type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

/** "all" here means "any status" — it is a filter value, not a category. */
export type StatusFilter = "all" | WatchStatus

/** The category the tracker opens on. */
export const DEFAULT_TYPE: ContentType = CONTENT_TYPES.EPISODE

/** Rail order, which is also section order for the non-episode types. */
export const TYPE_ORDER: ContentType[] = [
  CONTENT_TYPES.EPISODE,
  CONTENT_TYPES.MOVIE,
  CONTENT_TYPES.SPECIAL,
  CONTENT_TYPES.OVA,
  CONTENT_TYPES.LIVE_ACTION,
  CONTENT_TYPES.MAGIC_KAITO,
  CONTENT_TYPES.HANZAWA,
  CONTENT_TYPES.ZERO_TEA_TIME,
  CONTENT_TYPES.YAIBA,
]

/** Section key for the single Full Watch Order section. */
export const WATCH_ORDER_KEY = "watch-order"

/**
 * Rows per page.
 *
 * 50 was sized for the old 64px card rows. The redesigned row carries a 96px
 * thumbnail, so 50 rows made a page taller than most monitors and "Page 2"
 * became a scroll endurance test. 30 keeps a page roughly one screen-and-a-half.
 */
export const PAGE_SIZE = 30

export type CanonBucket = CanonType | "unclassified"

/**
 * Rendered buckets. "anime_canon" is deliberately absent: episode 1187 is the
 * lone anime-canon entry and reads as an orphan section, so
 * canonSectionBucket() folds it into the canon group.
 */
export const CANON_SECTION_ORDER: readonly CanonBucket[] = [
  "manga_canon",
  "filler",
  "unclassified",
]

export const CANON_SECTION_LABELS: Record<CanonBucket, string> = {
  manga_canon: "Canon Episodes",
  anime_canon: "Anime Canon",
  filler: "Non-canon Episodes",
  unclassified: "Unclassified",
}

export interface TrackerSection {
  key: string
  type: ContentType
  title: string
  entries: ContentEntry[]
  watched: number
  total: number
  subcats?: { key: string; label: string; count: number }[]
  activeSubcat?: string
}

export interface TypeTab {
  key: ContentType
  label: string
  /** Two-digit ordinal shown before the label. */
  index: string
  total: number
  watched: number
}

/* ─────────────────────────── URL parsing ─────────────────────────── */

/**
 * `?type=` is user-editable and old links carry `?type=all`. Anything that is
 * not a known category — including "all" — resolves to the default category
 * rather than rendering an empty list.
 */
export function parseTypeParam(raw: string | null | undefined): ContentType {
  return TYPE_ORDER.includes(raw as ContentType) ? (raw as ContentType) : DEFAULT_TYPE
}

/* ─────────────────────────── Predicates ──────────────────────────── */

export function isWatched(status: WatchStatus | null | undefined): boolean {
  return status === "watched" || status === "rewatched"
}

/* ──────────────────────── Catalogue headline ────────────────────── */

export interface CatalogueSummary {
  /** Distinct air years in the mainline catalogue. */
  years: number
  episodes: number
  movies: number
  watched: number
  total: number
  /** 0–100, rounded once so the bar and the label never disagree. */
  percent: number
}

/**
 * The numbers the tracker hero prints. Mainline rows only: crossovers, TV
 * specials and the manner short are catalogue rows but not mainline films, and
 * counting them made the banner say 34 movies while the progress tile said 29.
 */
export function catalogueSummary(
  entries: readonly ContentEntry[],
  statuses?: Map<string, WatchStatus>
): CatalogueSummary {
  const mainline = entries.filter((entry) => !isNonMainlineMovie(entry))
  const watched = mainline.filter((entry) => isWatched(statuses?.get(entry.id))).length
  return {
    years: new Set(mainline.map((entry) => entry.air_date?.slice(0, 4))).size,
    episodes: mainline.filter((entry) => entry.type === CONTENT_TYPES.EPISODE).length,
    // Counted from the rows on screen, not from the static guide list: the
    // guide carries 29 mainline films whether or not the catalogue has synced
    // them, and a banner claiming 29 movies above a Movie tab reading 8 is the
    // kind of mismatch that makes every other number look invented.
    movies: mainline.filter((entry) => entry.type === CONTENT_TYPES.MOVIE).length,
    watched,
    total: mainline.length,
    percent: mainline.length > 0 ? Math.min(100, Math.round((watched / mainline.length) * 100)) : 0,
  }
}

export function matchesStatus(
  entry: ContentEntry,
  status: StatusFilter,
  statuses?: Map<string, WatchStatus>
): boolean {
  if (status === "all") return true
  const current = statuses?.get(entry.id)
  if (status === "unwatched") return !current || current === "unwatched"
  if (status === "watched") return isWatched(current)
  return current === status
}

export function matchesTag(
  entry: ContentEntry,
  activeTag: string | null,
  tagsByContentId: Map<string, EpisodeTag[]>
): boolean {
  if (!activeTag) return true
  return (tagsByContentId.get(entry.id) ?? []).some((tag) => tag.key === activeTag)
}

/** The number a row is known by: episode number, movie number, else release order. */
export function entryNumber(entry: ContentEntry): number {
  if (entry.type === CONTENT_TYPES.MOVIE) return entry.movie_number ?? entry.release_order ?? 0
  if (entry.type === CONTENT_TYPES.EPISODE) return entry.episode_number ?? 0
  return entry.release_order ?? 0
}

/* ───────────────────────────── The rail ──────────────────────────── */

/**
 * One tab per category the catalogue actually has, with the watched tally.
 * Counts come from the unfiltered rows so the rail reads as a fact about the
 * collection rather than about the current status filter.
 */
export function buildTypeTabs(
  entries: ContentEntry[],
  statuses?: Map<string, WatchStatus>
): TypeTab[] {
  // Deduplicate by id up front. A windowed fetch that pages on a non-unique
  // column can hand back the same row twice, and a duplicated episode shows up
  // as "1218 / 1216" — a fraction that cannot exist. Filtering per type is not
  // enough: duplicates land in the same batch, so the id has to be claimed as
  // each row is kept.
  const unique: typeof entries = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    unique.push(entry)
  }

  const tabs: TypeTab[] = []
  for (const type of TYPE_ORDER) {
    const list = unique.filter((entry) => entry.type === type)
    if (list.length === 0) continue
    const watched = list.filter((entry) => isWatched(statuses?.get(entry.id))).length
    tabs.push({
      key: type,
      label: CONTENT_TYPE_LABELS[type],
      index: String(tabs.length + 1).padStart(2, "0"),
      total: list.length,
      // Clamped: `watched` can never exceed the number of rows counted, and a
      // fraction above 1 makes every number on the page look invented.
      watched: Math.min(watched, list.length),
    })
  }
  return tabs
}

/* ─────────────────────────── Canon buckets ───────────────────────── */

/**
 * Which rendered section an episode belongs to. Anime canon is story-relevant,
 * so it groups with manga canon rather than standing alone.
 */
export function canonSectionBucket(episodeNumber: number | null | undefined): CanonBucket {
  const type = canonTypeForEpisode(episodeNumber)
  if (type === "manga_canon" || type === "anime_canon") return "manga_canon"
  if (type === "filler") return "filler"
  return "unclassified"
}

/* ───────────────────────────── Sections ──────────────────────────── */

export interface BuildSectionsInput {
  entries: ContentEntry[]
  mode: ViewMode
  /** The selected category. Only Full Watch Order needs it to scope its list. */
  type: ContentType
  status: StatusFilter
  activeTag: string | null
  statuses?: Map<string, WatchStatus>
  tagsByContentId: Map<string, EpisodeTag[]>
  /** Watch order positions, from resolveWatchOrder(entries). */
  watchOrder: ContentEntry[]
  /** Selected subcategory per content type. */
  subcat: Record<string, string>
}

function makeSection(
  key: string,
  type: ContentType,
  title: string,
  entries: ContentEntry[],
  statuses?: Map<string, WatchStatus>
): TrackerSection {
  return {
    key,
    type,
    title,
    entries,
    watched: entries.filter((entry) => isWatched(statuses?.get(entry.id))).length,
    total: entries.length,
  }
}

/**
 * The accordion, for every view mode.
 *
 * Sections are built for EVERY category and the caller filters by the selected
 * one, so switching tabs never has to rebuild anything and the rail counts stay
 * stable. Order mode is the exception: it is one section by definition.
 */
export function buildSections({
  entries,
  mode,
  type,
  status,
  activeTag,
  statuses,
  tagsByContentId,
  watchOrder,
  subcat,
}: BuildSectionsInput): TrackerSection[] {
  const keep = (entry: ContentEntry) =>
    matchesStatus(entry, status, statuses) && matchesTag(entry, activeTag, tagsByContentId)

  if (mode === "order") {
    const list = watchOrder.filter((entry) => entry.type === type && keep(entry))
    if (list.length === 0) return []
    return [makeSection(WATCH_ORDER_KEY, type, "Full Watch Order", list, statuses)]
  }

  const episodeRows = entries.filter(
    (entry) => entry.type === CONTENT_TYPES.EPISODE && keep(entry)
  )
  const byEpisodeNumber = (a: ContentEntry, b: ContentEntry) =>
    (a.episode_number ?? 0) - (b.episode_number ?? 0)
  const episodeSections: TrackerSection[] = []

  if (mode === "chronological") {
    const list = [...episodeRows].sort(
      (a, b) => (a.canon_order ?? 0) - (b.canon_order ?? 0)
    )
    episodeSections.push(
      makeSection("episode", CONTENT_TYPES.EPISODE, CONTENT_TYPE_LABELS.episode, list, statuses)
    )
  } else if (mode === "canon") {
    const sorted = [...episodeRows].sort(byEpisodeNumber)
    const buckets = new Map<CanonBucket, ContentEntry[]>()
    for (const entry of sorted) {
      const bucket = canonSectionBucket(entry.episode_number)
      const list = buckets.get(bucket)
      if (list) list.push(entry)
      else buckets.set(bucket, [entry])
    }
    for (const bucket of CANON_SECTION_ORDER) {
      const list = buckets.get(bucket)
      if (!list || list.length === 0) continue
      episodeSections.push(
        makeSection(
          `canon-${bucket}`,
          CONTENT_TYPES.EPISODE,
          CANON_SECTION_LABELS[bucket],
          list,
          statuses
        )
      )
    }
  } else {
    const byYear = new Map<string, ContentEntry[]>()
    for (const entry of episodeRows) {
      const year = entry.air_date?.slice(0, 4) ?? "Unknown"
      const bucket = byYear.get(year)
      if (bucket) bucket.push(entry)
      else byYear.set(year, [entry])
    }
    for (const [year, list] of [...byYear.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      episodeSections.push(
        makeSection(`year-${year}`, CONTENT_TYPES.EPISODE, year, list.sort(byEpisodeNumber), statuses)
      )
    }
  }

  const otherSections = TYPE_ORDER.filter((entryType) => entryType !== CONTENT_TYPES.EPISODE)
    .map((entryType) => {
      const base = entries
        .filter((entry) => entry.type === entryType && keep(entry))
        .sort((a, b) => entryNumber(a) - entryNumber(b))
      const config = SUBCATEGORY_CONFIGS[entryType]
      let list = base
      let activeSubcat: string | undefined
      let subcats: { key: string; label: string; count: number }[] | undefined

      if (config) {
        activeSubcat = subcat[entryType] ?? config.defaultKey
        subcats = config.groups
          .map((group) => ({
            key: group.key,
            label: group.label,
            count: base.filter((entry) => group.match(entry)).length,
          }))
          .filter((group) => group.count > 0)
        const activeGroup = config.groups.find((group) => group.key === activeSubcat)
        if (activeGroup) list = base.filter((entry) => activeGroup.match(entry))
      }

      return {
        ...makeSection(entryType, entryType, CONTENT_TYPE_LABELS[entryType], list, statuses),
        subcats,
        activeSubcat,
      }
    })
    .filter((section) => section.total > 0)

  return [...episodeSections, ...otherSections]
}

/* ───────────────────────────── Jump maths ────────────────────────── */

/**
 * The list a jump has to page through, as it will look AFTER the jump clears
 * the status and tag filters. Searching the rendered `sections` instead would
 * measure a list built from filters the jump is about to drop.
 */
export function jumpList(
  mode: ViewMode,
  episode: ContentEntry,
  entries: ContentEntry[],
  watchOrder: ContentEntry[]
): ContentEntry[] {
  const byEpisodeNumber = (a: ContentEntry, b: ContentEntry) =>
    (a.episode_number ?? 0) - (b.episode_number ?? 0)
  const episodesOnly = entries.filter((entry) => entry.type === CONTENT_TYPES.EPISODE)

  if (mode === "order") {
    return watchOrder.filter((entry) => entry.type === CONTENT_TYPES.EPISODE)
  }
  if (mode === "canon") {
    const bucket = canonSectionBucket(episode.episode_number)
    return episodesOnly
      .filter((entry) => canonSectionBucket(entry.episode_number) === bucket)
      .sort(byEpisodeNumber)
  }
  if (mode === "chronological") {
    return [...episodesOnly].sort((a, b) => (a.canon_order ?? 0) - (b.canon_order ?? 0))
  }
  const year = episode.air_date?.slice(0, 4) ?? "Unknown"
  return episodesOnly
    .filter((entry) => (entry.air_date?.slice(0, 4) ?? "Unknown") === year)
    .sort(byEpisodeNumber)
}

/** The section a jump should open, per view mode. */
export function jumpSectionKey(mode: ViewMode, episode: ContentEntry): string {
  if (mode === "order") return WATCH_ORDER_KEY
  if (mode === "canon") return `canon-${canonSectionBucket(episode.episode_number)}`
  if (mode === "chronological") return "episode"
  return `year-${episode.air_date?.slice(0, 4) ?? "Unknown"}`
}

/** Zero-based page index holding `entryId`, clamped into the list. */
export function pageForEntry(list: ContentEntry[], entryId: string, pageSize = PAGE_SIZE): number {
  const index = list.findIndex((entry) => entry.id === entryId)
  if (index < 0) return 0
  return Math.floor(index / pageSize)
}

/**
 * How many episodes "mark watched up to N" would touch, for the live preview on
 * the bulk control. Counting before the click is the difference between a
 * destructive-looking button and a described one.
 */
export function countUnwatchedUpTo(
  entries: ContentEntry[],
  episodeNumber: number,
  statuses?: Map<string, WatchStatus>
): number {
  return entries.filter(
    (entry) =>
      entry.type === CONTENT_TYPES.EPISODE &&
      (entry.episode_number ?? 0) <= episodeNumber &&
      !isWatched(statuses?.get(entry.id))
  ).length
}

/**
 * How many episodes "rewatch up to N" would touch.
 *
 * Only episodes already seen can be rewatched — bumping the counter on an
 * unwatched episode would fabricate a viewing that never happened, so the
 * preview and the bulk write both skip them.
 */
export function countRewatchableUpTo(
  entries: ContentEntry[],
  episodeNumber: number,
  statuses?: Map<string, WatchStatus>
): number {
  return entries.filter(
    (entry) =>
      entry.type === CONTENT_TYPES.EPISODE &&
      (entry.episode_number ?? 0) <= episodeNumber &&
      isWatched(statuses?.get(entry.id))
  ).length
}
