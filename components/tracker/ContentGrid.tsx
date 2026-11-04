"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import Image from "next/image"
import {
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clapperboard,
  Coffee,
  Film,
  Info,
  Sparkles,
  Swords,
  Users,
  Video,
  Search as SearchIcon,
} from "lucide-react"
import { cn, formatHours, padNumber } from "@/lib/utils"
import {
  CONTENT_TYPE_LABELS,
  type ContentType,
  type ViewMode,
  type WatchStatus,
} from "@/lib/constants"
import { TrackerRow } from "@/components/tracker/TrackerRow"
import { TrackerToolbar } from "@/components/tracker/TrackerToolbar"
import { TrackerSection } from "@/components/tracker/TrackerSection"
import { Rail } from "@/components/tracker/Rail"
import { PosterCard } from "@/components/tracker/PosterCard"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CANON_GUIDE_SOURCE } from "@/lib/canon-guide"
import { resolveWatchOrder } from "@/lib/watch-order"
import { isNonMainlineMovie, MAINLINE_MOVIES } from "@/lib/movies-guide"
import {
  buildEpisodeTags,
  canonTagOf,
  collectTagFacets,
  type CrimeTagMap,
  type EpisodeTag,
} from "@/lib/episode-tags"
import {
  buildSections,
  buildTypeTabs,
  canonSectionBucket,
  CANON_SECTION_LABELS,
  CANON_SECTION_ORDER,
  countRewatchableUpTo,
  countUnwatchedUpTo,
  DEFAULT_TYPE,
  entryNumber,
  isWatched,
  jumpList,
  jumpSectionKey,
  matchesStatus,
  matchesTag,
  pageForEntry,
  PAGE_SIZE,
  type CanonBucket,
  type ContentEntry,
  type StatusFilter,
  type TrackerSection as TrackerSectionData,
} from "@/lib/tracker-view"

/** Icon per content type, for section headers and the rail's context. */
const TYPE_ICONS: Record<ContentType, React.ComponentType<{ className?: string }>> = {
  episode: BookOpen,
  movie: Film,
  special: Bookmark,
  ova: Video,
  live_action: Clapperboard,
  magic_kaito: Sparkles,
  hanzawa: CircleDot,
  zero_tea_time: Coffee,
  yaiba: Swords,
}

/** Canon Guide legend swatches — the same fills the chips use. */
const CANON_SECTION_SWATCHES: Record<CanonBucket, string> = {
  manga_canon: "bg-accent-soft border-accent/40",
  anime_canon: "bg-surface border-accent ring-1 ring-accent",
  filler: "bg-surface-muted border-line",
  unclassified: "bg-transparent border-line border-dashed",
}

/**
 * Search matches one row each, and a two-letter query can match most of the
 * catalog. Cap the list; the count line still reports every match.
 */
const SEARCH_RENDER_LIMIT = 60

interface ContentGridProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
  onSetStatus?: (contentId: string, nextStatus: WatchStatus, currentCount: number) => void
  onIncrementRewatch?: (contentId: string, currentCount: number) => void
  /** watch_count per content id, for rewatch badges. */
  watchCounts?: Map<string, number>
  /** favorite flag per content id. */
  favorites?: Map<string, boolean>
  onToggleFavorite?: (contentId: string, current: boolean) => void
  /** rating (DB units 2..10) per content id, for the star input. */
  ratings?: Map<string, number>
  onSetRating?: (contentId: string, rating: number) => void
  onMarkAll?: (ids: string[], status: WatchStatus) => void
  /** Bulk rewatch: bumps every id by one. Same write as the row's rewatch button. */
  onRewatchAll?: (ids: string[]) => void
  /**
   * Initial values for the view mode / filters. The tracker page resolves these
   * from the URL params first (?mode=… deep links), then falls back to the
   * last view mode the user picked (localStorage), so leaving /tracker and
   * coming back no longer snaps the dropdown back to By Year.
   */
  initialMode?: ViewMode
  initialStatusFilter?: StatusFilter
  initialSearch?: string
  initialType?: ContentType
  initialPage?: number
  /** Notify the parent of changes so it can persist state in the URL. */
  onModeChange?: (mode: ViewMode) => void
  onStatusFilterChange?: (filter: StatusFilter) => void
  onSearchChange?: (query: string) => void
  onTypeChange?: (type: ContentType) => void
  onPageChange?: (type: string, page: number) => void
  /** When set to an episode number, the grid jumps to that episode and calls onJumped. */
  jumpTarget?: number | null
  onJumped?: () => void
  /** arc_id -> { slug, title } lookup for episode arc badges. */
  arcMap?: Map<string, { slug: string; title: string }> | null
  /** content id -> crime slugs (dcw_cases_view), for crime tags. */
  crimeByContentId?: CrimeTagMap | null
  /** Optional: intercept card title clicks (e.g. open a detail modal instead of navigating). */
  onSelect?: (entry: ContentEntry) => void
}

export function ContentGrid({
  entries,
  userStatuses,
  onSetStatus,
  onIncrementRewatch,
  watchCounts,
  favorites,
  onToggleFavorite,
  ratings,
  onSetRating,
  onMarkAll,
  onRewatchAll,
  initialMode = "year",
  initialStatusFilter = "all",
  initialSearch = "",
  initialType = DEFAULT_TYPE,
  initialPage,
  onModeChange,
  onStatusFilterChange,
  onSearchChange,
  onTypeChange,
  onPageChange,
  jumpTarget,
  onJumped,
  arcMap,
  crimeByContentId,
  onSelect,
}: ContentGridProps) {
  const [search, setSearch] = useState(initialSearch)
  const [typeFilter, setTypeFilter] = useState<ContentType>(initialType)
  const [mode, setMode] = useState<ViewMode>(initialMode)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [subcat, setSubcat] = useState<Record<string, string>>({})
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Tags for every entry, computed once per catalog load.
   *
   * buildEpisodeTags is cheap but not free (it scans STORY_ARCS and sorts), and
   * a page renders 30 rows — computing per row would repeat that work on every
   * status toggle. One Map keyed by content id keeps the row component a pure
   * lookup.
   */
  const tagsByContentId = useMemo(() => {
    const map = new Map<string, EpisodeTag[]>()
    for (const entry of entries) {
      map.set(entry.id, buildEpisodeTags(entry, { arcMap, crimeByContentId }))
    }
    return map
  }, [entries, arcMap, crimeByContentId])

  /**
   * Filterable tags, with a count each.
   *
   * minCount 3 keeps the filter honest: a chip on one or two episodes is not a
   * useful way to narrow 1,200 rows, and offering it would make the filter list
   * long enough to be unusable.
   */
  const tagFacets = useMemo(
    () => collectTagFacets(entries, { arcMap, crimeByContentId, minCount: 3 }),
    [entries, arcMap, crimeByContentId]
  )

  // Highest episode number that actually exists in the tracker, so the
  // jump / bulk-mark controls never cap at a stale hardcoded ceiling.
  const maxEpisode = useMemo(() => {
    let max = 1209
    for (const entry of entries) {
      if (
        entry.type === "episode" &&
        typeof entry.episode_number === "number" &&
        entry.episode_number > max
      ) {
        max = entry.episode_number
      }
    }
    return max
  }, [entries])

  // Full franchise watch order, resolved once per content load. Positions come
  // from the UNFILTERED list so ordinals never shift when filters change.
  const watchOrder = useMemo(() => {
    const items = resolveWatchOrder(entries)
    const indexById = new Map<string, number>()
    for (const item of items) indexById.set(item.entry.id, item.position)
    return { items, entries: items.map((item) => item.entry), indexById }
  }, [entries])

  // Canon tallies over every episode row, independent of the status filter, so
  // the legend reads as a fact about the series rather than the view.
  const canonCounts = useMemo(() => {
    const counts: Record<CanonBucket, number> = {
      manga_canon: 0,
      anime_canon: 0,
      filler: 0,
      unclassified: 0,
    }
    for (const entry of entries) {
      if (entry.type !== "episode" || typeof entry.episode_number !== "number") continue
      counts[canonSectionBucket(entry.episode_number)] += 1
    }
    return counts
  }, [entries])

  const tabs = useMemo(() => buildTypeTabs(entries, userStatuses), [entries, userStatuses])

  const sections = useMemo(
    () =>
      buildSections({
        entries,
        mode,
        type: typeFilter,
        status: statusFilter,
        activeTag,
        statuses: userStatuses,
        tagsByContentId,
        watchOrder: watchOrder.entries,
        subcat,
      }),
    [
      entries,
      mode,
      typeFilter,
      statusFilter,
      activeTag,
      userStatuses,
      tagsByContentId,
      watchOrder,
      subcat,
    ]
  )

  // Sections are built for every category; the rail decides which one renders.
  const visibleSections: TrackerSectionData[] =
    mode === "order" ? sections : sections.filter((section) => section.type === typeFilter)

  const firstVisibleKey = visibleSections[0]?.key ?? null

  // Keep exactly one section open, and keep it open as the data arrives: the
  // sections can be built a tick after the mode/type effects run, so keying
  // this only on [mode, typeFilter] left the list collapsed on a cold load.
  useEffect(() => {
    setExpandedType((current) =>
      current && visibleSections.some((section) => section.key === current)
        ? current
        : firstVisibleKey
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typeFilter, firstVisibleKey])

  function setPage(key: string, page: number) {
    setPages((prev) => ({ ...prev, [key]: page }))
    onPageChange?.(key, page)
  }

  function setSubcatKey(key: string, groupKey: string) {
    setSubcat((prev) => ({ ...prev, [key]: groupKey }))
    setPage(key, 0)
  }

  // Sync external (URL) state changes back into the grid.
  useEffect(() => setSearch(initialSearch), [initialSearch])
  useEffect(() => setTypeFilter(initialType), [initialType])
  useEffect(() => setMode(initialMode), [initialMode])
  useEffect(() => setStatusFilter(initialStatusFilter), [initialStatusFilter])
  useEffect(() => {
    if (initialPage === undefined) return
    const key = sections.find((section) => section.type === typeFilter)?.key
    if (key) setPages((prev) => ({ ...prev, [key]: initialPage }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, typeFilter, mode])

  /** Watched OR rewatched both count as "has been seen". */
  const seen = (entry: ContentEntry) => isWatched(userStatuses?.get(entry.id))

  function changeType(next: ContentType) {
    setTypeFilter(next)
    onTypeChange?.(next)
  }

  function changeStatus(next: StatusFilter) {
    setStatusFilter(next)
    onStatusFilterChange?.(next)
  }

  function changeMode(next: ViewMode) {
    setMode(next)
    onModeChange?.(next)
  }

  // Same footing as the Your Progress tile: crossovers, TV specials and the
  // manner short are catalog rows but not mainline films, and counting them made
  // this header say 34 movies while the tile said 29.
  const mainlineEntries = entries.filter((entry) => !isNonMainlineMovie(entry))
  const totalYears = new Set(mainlineEntries.map((entry) => entry.air_date?.slice(0, 4))).size
  const totalEpisodes = mainlineEntries.filter((entry) => entry.type === "episode").length
  const totalMovies = MAINLINE_MOVIES.length
  const overallWatched = mainlineEntries.filter(seen).length
  const overallPercent =
    mainlineEntries.length > 0
      ? Math.min(100, Math.round((overallWatched / mainlineEntries.length) * 100))
      : 0

  // Rails read the whole catalogue, not the active filter: a rail that empties
  // because a tag filter is on would strand the reader on a blank row.
  const railContinue = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "episode" && !isWatched(userStatuses?.get(entry.id)))
        .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
        .slice(0, 14),
    [entries, userStatuses]
  )

  // Search is deliberately catalogue-wide, not scoped to the selected category:
  // the query box is the one control that should answer "where is this thing?"
  // without the reader first guessing which tab it lives under.
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const query = search.trim().toLowerCase()
    const isNumericQuery = /^\d+$/.test(query)
    const numericQuery = Number(query)
    return entries
      .filter((entry) => {
        if (!matchesStatus(entry, statusFilter, userStatuses)) return false
        if (!matchesTag(entry, activeTag, tagsByContentId)) return false
        const titleHit = entry.title.toLowerCase().includes(query)
        const synopsisHit = (entry.synopsis ?? "").toLowerCase().includes(query)
        const numberHit = [entry.episode_number, entry.movie_number, entry.release_order]
          .filter((value): value is number => typeof value === "number")
          .some((value) => String(value).includes(query))
        const exactNumberHit = isNumericQuery && entryNumber(entry) === numericQuery
        return titleHit || synopsisHit || numberHit || exactNumberHit
      })
      .sort((a, b) => entryNumber(a) - entryNumber(b))
  }, [search, entries, statusFilter, userStatuses, activeTag, tagsByContentId])

  /**
   * Scroll to a row once it exists. A jump can change the open section, the
   * page and the category in the same tick, so the row is not in the DOM on the
   * first frame — poll a handful of frames instead of guessing a timeout.
   */
  function revealRow(entryId: string, attempt = 0) {
    const element = document.getElementById(`row-${entryId}`)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" })
      setFlashId(entryId)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashId(null), 2200)
      return
    }
    if (attempt < 12) requestAnimationFrame(() => revealRow(entryId, attempt + 1))
  }

  /** Returns an error message, or null when the jump was accepted. */
  function handleJump(episodeNumber: number): string | null {
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > maxEpisode) {
      return `Enter an episode number between 1 and ${maxEpisode}.`
    }
    const episode = entries.find(
      (entry) => entry.type === "episode" && entry.episode_number === episodeNumber
    )
    if (!episode) return `Episode ${episodeNumber} isn't in the tracker yet.`

    // A jump is a jump to an EPISODE: clear the filters that would hide it.
    changeType("episode")
    setStatusFilter("all")
    onStatusFilterChange?.("all")
    setActiveTag(null)

    const key = jumpSectionKey(mode, episode)
    const list = jumpList(mode, episode, entries, watchOrder.entries)
    setExpandedType(key)
    setPages((prev) => ({ ...prev, [key]: pageForEntry(list, episode.id) }))
    revealRow(episode.id)
    return null
  }

  /** Returns an error message, or null when the bulk mark was accepted. */
  function handleMarkUpTo(episodeNumber: number): string | null {
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > maxEpisode) {
      return `Enter an episode number between 1 and ${maxEpisode}.`
    }
    if (!onMarkAll) return "Sign in to mark episodes as watched."
    const ids = entries
      .filter(
        (entry) =>
          entry.type === "episode" &&
          (entry.episode_number ?? 0) <= episodeNumber &&
          !isWatched(userStatuses?.get(entry.id))
      )
      .map((entry) => entry.id)
    if (ids.length === 0) {
      return `Nothing to mark. Everything up to episode ${episodeNumber} is already watched.`
    }
    onMarkAll(ids, "watched")
    return null
  }

  function handleRewatchUpTo(episodeNumber: number): string | null {
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > maxEpisode) {
      return `Enter an episode number between 1 and ${maxEpisode}.`
    }
    if (!onRewatchAll) return "Sign in to rewatch episodes."
    // Only episodes already seen: a rewatch on an unwatched row would invent a
    // viewing that never happened.
    const ids = entries
      .filter(
        (entry) =>
          entry.type === "episode" &&
          (entry.episode_number ?? 0) <= episodeNumber &&
          isWatched(userStatuses?.get(entry.id))
      )
      .map((entry) => entry.id)
    if (ids.length === 0) {
      return `Nothing to rewatch. Nothing up to episode ${episodeNumber} is marked watched.`
    }
    onRewatchAll(ids)
    return null
  }

  // External jump request (from the ?ep= URL param)
  useEffect(() => {
    if (jumpTarget && Number.isInteger(jumpTarget) && jumpTarget >= 1 && jumpTarget <= maxEpisode) {
      handleJump(jumpTarget)
      onJumped?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget])

  return (
    <div className="space-y-0">
      {/* ── Rail ──
          One row, the next thing to watch. A "watched so far" row was tried and
          removed: it repeats what the list below already says, and it pushed
          the actual catalogue further down the page. */}
      {railContinue.length > 0 && (
        <div className="space-y-8 pt-8">
          {railContinue.length > 0 && (
            <Rail
              title="Continue watching"
              subtitle={
                railContinue[0]?.episode_number
                  ? `Next up · EP ${padNumber(railContinue[0].episode_number, 3)}${
                      railContinue[0].runtime_minutes
                        ? ` · ${formatHours(railContinue[0].runtime_minutes)}`
                        : ""
                    }`
                  : undefined
              }
              action={
                <button
                  type="button"
                  onClick={() => changeStatus("unwatched")}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink"
                >
                  Show unwatched →
                </button>
              }
            >
              {railContinue.map((entry) => (
                <PosterCard
                  key={entry.id}
                  entry={entry}
                  watchStatus={userStatuses?.get(entry.id) ?? null}
                  canon={canonTagOf(tagsByContentId.get(entry.id) ?? [])}
                  onSelect={onSelect}
                />
              ))}
            </Rail>
          )}

        </div>
      )}

      {/* ── Controls ── */}
      <TrackerToolbar
        tabs={tabs}
        type={typeFilter}
        onTypeChange={changeType}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          onSearchChange?.(value)
        }}
        mode={mode}
        onModeChange={changeMode}
        status={statusFilter}
        onStatusChange={changeStatus}
        facets={tagFacets}
        activeTag={activeTag}
        onTagChange={setActiveTag}
        maxEpisode={maxEpisode}
        onJump={handleJump}
        onMarkUpTo={handleMarkUpTo}
        unwatchedUpTo={(episodeNumber) => countUnwatchedUpTo(entries, episodeNumber, userStatuses)}
        markDisabled={!onMarkAll}
        markDisabledReason="Sign in to mark episodes as watched"
        onRewatchUpTo={handleRewatchUpTo}
        rewatchableUpTo={(episodeNumber) =>
          countRewatchableUpTo(entries, episodeNumber, userStatuses)
        }
        rewatchDisabled={!onRewatchAll}
        rewatchDisabledReason="Sign in to rewatch episodes"
      />

      {/* ── Search results ── */}
      {searchResults && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-3 sm:px-5">
            <p className="font-mono text-[11px] text-ink-dim">
              <span className="tabular-nums text-ink">{searchResults.length}</span>{" "}
              {searchResults.length === 1 ? "match" : "matches"} for “{search}”
              <span className="ml-2 text-ink-faint">across every category</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("")
                onSearchChange?.("")
              }}
              className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint underline decoration-dotted hover:text-ink"
            >
              Clear
            </button>
          </div>

          {searchResults.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <SearchIcon className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
              <p className="text-sm text-ink-dim">No matches found.</p>
              <p className="mt-1 text-xs text-ink-faint">
                Try an episode number, a case name, or clear the filters.
              </p>
            </div>
          ) : (
            <>
              {searchResults.slice(0, SEARCH_RENDER_LIMIT).map((entry) => (
                <TrackerRow
                  key={entry.id}
                  entry={entry}
                  watchStatus={userStatuses?.get(entry.id) ?? null}
                  onSetStatus={onSetStatus}
                  onIncrementRewatch={onIncrementRewatch}
                  watchCount={watchCounts?.get(entry.id) ?? 0}
                  favorite={favorites?.get(entry.id) ?? false}
                  onToggleFavorite={onToggleFavorite}
                  rating={ratings?.get(entry.id) ?? 0}
                  tags={tagsByContentId.get(entry.id) ?? []}
                  flash={flashId === entry.id}
                  onSelect={onSelect}
                  onTagClick={setActiveTag}
                />
              ))}
              {searchResults.length > SEARCH_RENDER_LIMIT && (
                <p className="px-5 py-4 text-xs text-ink-dim">
                  Showing the first {SEARCH_RENDER_LIMIT} of {searchResults.length} — narrow the
                  search to see the rest.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Sectioned browse ── */}
      {!searchResults && (
        <div>
          {/* Canon Guide legend — explains the grouping, not a separate layout */}
          {mode === "canon" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 pb-4 pt-4 sm:px-5">
              {CANON_SECTION_ORDER.map((bucket) =>
                canonCounts[bucket] > 0 ? (
                  <span key={bucket} className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-sm border",
                        CANON_SECTION_SWATCHES[bucket]
                      )}
                    />
                    <span className="text-xs text-ink-dim">
                      {CANON_SECTION_LABELS[bucket]}{" "}
                      <span className="font-mono text-[11px] tabular-nums text-ink">
                        {canonCounts[bucket]}
                      </span>
                    </span>
                  </span>
                ) : null
              )}
              <a
                href={CANON_GUIDE_SOURCE}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-ink-faint underline decoration-dotted hover:text-ink-dim"
              >
                source
              </a>
            </div>
          )}

          {/* Full Watch Order intro */}
          {mode === "order" && (
            <div className="border-b border-line px-3 pb-4 pt-4 sm:px-5">
              <p className="max-w-2xl text-xs leading-relaxed text-ink-dim">
                {CONTENT_TYPE_LABELS[typeFilter]} in one continuous run, positioned by where they
                sit in the franchise. The number on each row is its place in the full order.
              </p>
            </div>
          )}

          {visibleSections.map((section) => {
            const Icon = TYPE_ICONS[section.type]
            const isOpen = expandedType === section.key
            const complete = section.watched === section.total && section.total > 0
            const started = section.watched > 0
            const progressColor = complete
              ? "bg-success"
              : started
                ? "bg-accent"
                : "bg-surface-muted"
            const totalPages = Math.max(1, Math.ceil(section.entries.length / PAGE_SIZE))
            const page = Math.min(pages[section.key] ?? 0, totalPages - 1)
            const pageItems = section.entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

            return (
              <TrackerSection
                key={section.key}
                icon={Icon}
                title={section.title}
                count={section.total}
                watched={section.watched}
                progressColor={progressColor}
                progressPercent={
                  section.total > 0 ? (section.watched / section.total) * 100 : 0
                }
                isOpen={isOpen}
                onToggle={() => setExpandedType(isOpen ? null : section.key)}
                action={
                  section.subcats && section.subcats.length > 1 ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <Select
                        value={section.activeSubcat}
                        onValueChange={(value) => setSubcatKey(section.key, value)}
                      >
                        <SelectTrigger
                          className="h-9 w-auto gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-mono text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
                          aria-label={`${section.title} subcategory`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {section.subcats.map((group) => (
                            <SelectItem key={group.key} value={group.key}>
                              {group.label} ({group.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : onMarkAll && !complete && section.type === "episode" ? (
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        onMarkAll(
                          section.entries.filter((entry) => !seen(entry)).map((entry) => entry.id),
                          "watched"
                        )
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-mono text-[10px] text-ink-dim transition-colors hover:border-ink hover:text-ink"
                      title={`Mark all ${section.total - section.watched} unwatched in this section`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Mark all
                    </button>
                  ) : null
                }
              >
                <>
                  <div className="border-t border-line">
                    {pageItems.map((entry) => (
                      <TrackerRow
                        key={entry.id}
                        entry={entry}
                        watchStatus={userStatuses?.get(entry.id) ?? null}
                        onSetStatus={onSetStatus}
                        onIncrementRewatch={onIncrementRewatch}
                        watchCount={watchCounts?.get(entry.id) ?? 0}
                        favorite={favorites?.get(entry.id) ?? false}
                        onToggleFavorite={onToggleFavorite}
                        rating={ratings?.get(entry.id) ?? 0}
                        tags={tagsByContentId.get(entry.id) ?? []}
                        flash={flashId === entry.id}
                        ordinal={mode === "order" ? watchOrder.indexById.get(entry.id) : undefined}
                        onSelect={onSelect}
                        onTagClick={setActiveTag}
                        hideYear={mode === "year"}
                      />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <button
                        onClick={() => setPage(section.key, Math.max(0, page - 1))}
                        disabled={page === 0}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink-dim"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Prev
                      </button>
                      <span className="font-mono text-xs text-ink-dim">
                        Page {page + 1} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage(section.key, Math.min(totalPages - 1, page + 1))}
                        disabled={page >= totalPages - 1}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink-dim"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </>
              </TrackerSection>
            )
          })}

          {visibleSections.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="font-display text-base tracking-tight text-ink">
                No {CONTENT_TYPE_LABELS[typeFilter]} in this view
              </p>
              <p className="mt-1 text-sm text-ink-dim">
                {statusFilter !== "all" || activeTag
                  ? "The status or tag filter is hiding every row."
                  : "This category has no entries yet."}
              </p>
              {(statusFilter !== "all" || activeTag) && (
                <button
                  type="button"
                  onClick={() => {
                    changeStatus("all")
                    setActiveTag(null)
                  }}
                  className="mt-4 inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm text-ink transition-colors hover:border-ink"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* About */}
          <TrackerSection
            icon={Info}
            title="About the Series"
            isOpen={expandedType === "__about"}
            onToggle={() => setExpandedType(expandedType === "__about" ? null : "__about")}
          >
            <div className="grid gap-6 px-3 sm:px-5 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <p className="text-sm leading-relaxed text-ink-dim">
                  High-school detective Shinichi Kudo is poisoned by the Black Organization and
                  shrinks into a child. As Conan Edogawa, he solves cases while hunting the
                  syndicate — and an antidote back to his true form.
                </p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <Detail term="Creator" value="Gosho Aoyama" />
                  <Detail term="Studio" value="TMS Entertainment" />
                  <Detail term="First Aired" value="January 8, 1996" />
                  <Detail term="Status" value="Ongoing" />
                </dl>
              </div>
              <div className="flex flex-col justify-center rounded-xl border border-line bg-surface-muted p-5">
                <div className="mb-3 flex items-center gap-2 text-ink">
                  <Users className="h-4 w-4" />
                  <span className="font-display text-sm text-ink">Progress</span>
                </div>
                <div className="font-display text-3xl text-ink">{overallPercent}%</div>
                <div className="mt-1 font-mono text-[10px] text-ink-faint">
                  {overallWatched} of {mainlineEntries.length} watched
                </div>
              </div>
            </div>
          </TrackerSection>
        </div>
      )}
    </div>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] text-ink-faint">{term}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  )
}
