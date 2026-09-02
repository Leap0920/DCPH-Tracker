"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search,
  Check,
  Play,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Users,
  BookOpen,
  Film,
  Bookmark,
  Video,
  Clapperboard,
  Sparkles,
  CircleDot,
  Coffee,
  Swords,
  ArrowDownToLine,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CONTENT_TYPE_LABELS,
  VIEW_MODE_OPTIONS,
  WATCH_STATUS_LABELS,
  type ContentType,
  type ViewMode,
  type WatchStatus,
} from "@/lib/constants"
import type { Database } from "@/types/database.types"
import { ContentCard } from "@/components/tracker/ContentCard"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SUBCATEGORY_CONFIGS } from "@/lib/subcategories"
import {
  CANON_GUIDE_SOURCE,
  canonTypeForEpisode,
  type CanonType,
} from "@/lib/canon-guide"
import { resolveWatchOrder } from "@/lib/watch-order"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export type StatusFilter = "all" | WatchStatus

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
  /**
   * Initial values for the view mode / filters. The tracker page resolves these
   * from the URL params first (?mode=… deep links), then falls back to the
   * last view mode the user picked (localStorage), so leaving /tracker and
   * coming back no longer snaps the dropdown back to By Year.
   */
  initialMode?: ViewMode
  initialStatusFilter?: StatusFilter
  initialSearch?: string
  initialType?: ContentType | "all"
  initialPage?: number
  /** Notify the parent of changes so it can persist state in the URL. */
  onModeChange?: (mode: ViewMode) => void
  onStatusFilterChange?: (filter: StatusFilter) => void
  onSearchChange?: (query: string) => void
  onTypeChange?: (type: ContentType | "all") => void
  onPageChange?: (type: string, page: number) => void
  /** When set to an episode number, the grid jumps to that episode and calls onJumped. */
  jumpTarget?: number | null
  onJumped?: () => void
  /** arc_id -> { slug, title } lookup for episode arc badges. */
  arcMap?: Map<string, { slug: string; title: string }> | null
  /** Optional: intercept card title clicks (e.g. open a detail modal instead of navigating). */
  onSelect?: (entry: ContentEntry) => void
}

/** Order + presentation metadata for each content-type section. */
const SECTION_ORDER: {
  type: ContentType
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { type: "episode", icon: BookOpen },
  { type: "movie", icon: Film },
  { type: "special", icon: Bookmark },
  { type: "ova", icon: Video },
  { type: "live_action", icon: Clapperboard },
  { type: "magic_kaito", icon: Sparkles },
  { type: "hanzawa", icon: CircleDot },
  { type: "zero_tea_time", icon: Coffee },
  { type: "yaiba", icon: Swords },
]

/**
 * Canon Guide grouping. Manga Canon and Anime Canon sit adjacent because both
 * are "don't skip"; Filler follows. Unclassified only ever renders if the
 * tracker contains an episode the source guide doesn't cover yet.
 */
type CanonBucket = CanonType | "unclassified"

/**
 * Rendered buckets. "anime_canon" is deliberately absent: episode 1187 is the
 * lone anime-canon entry and reads as an orphan section, so canonSectionBucket()
 * folds it into the canon group. Re-add it here to split it back out.
 */
const CANON_SECTION_ORDER: readonly CanonBucket[] = ["manga_canon", "filler", "unclassified"]

/** Presentation labels — the data-layer names live in lib/canon-guide.ts. */
const CANON_SECTION_LABELS: Record<CanonBucket, string> = {
  manga_canon: "Canon Episodes",
  anime_canon: "Anime Canon",
  filler: "Filler Episodes",
  unclassified: "Unclassified",
}

const CANON_SECTION_ICONS: Record<
  CanonBucket,
  React.ComponentType<{ className?: string }>
> = {
  manga_canon: BookOpen,
  anime_canon: Bookmark,
  filler: Sparkles,
  unclassified: CircleDot,
}

const CANON_SECTION_SWATCHES: Record<CanonBucket, string> = {
  manga_canon: "bg-accent-soft border-accent/40",
  anime_canon: "bg-surface border-accent ring-1 ring-accent",
  filler: "bg-surface-muted border-line",
  unclassified: "bg-transparent border-line border-dashed",
}

/**
 * Which rendered section an episode belongs to. Anime canon is story-relevant,
 * so it groups with manga canon rather than standing alone.
 */
function canonSectionBucket(episodeNumber: number | null | undefined): CanonBucket {
  const type = canonTypeForEpisode(episodeNumber)
  if (type === "manga_canon" || type === "anime_canon") return "manga_canon"
  if (type === "filler") return "filler"
  return "unclassified"
}

/** Section key for the single Full Watch Order section. */
const WATCH_ORDER_KEY = "watch-order"

function getNumber(entry: ContentEntry): number {
  if (entry.type === "movie") return entry.movie_number ?? entry.release_order ?? 0
  if (entry.type === "episode") return entry.episode_number ?? 0
  return entry.release_order ?? 0
}

type SectionData = {
  key: string
  type: ContentType
  title: string
  icon: React.ComponentType<{ className?: string }>
  entries: ContentEntry[]
  watched: number
  total: number
  subcats?: { key: string; label: string; count: number }[]
  activeSubcat?: string
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
  initialMode = "year",
  initialStatusFilter = "all",
  initialSearch = "",
  initialType = "all",
  initialPage,
  onModeChange,
  onStatusFilterChange,
  onSearchChange,
  onTypeChange,
  onPageChange,
  jumpTarget,
  onJumped,
  arcMap,
  onSelect,
}: ContentGridProps) {
  const [search, setSearch] = useState(initialSearch)
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">(initialType)
  const [mode, setMode] = useState<ViewMode>(initialMode)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [subcat, setSubcat] = useState<Record<string, string>>({})
  const [jumpInput, setJumpInput] = useState("")
  const [jumpError, setJumpError] = useState<string | null>(null)
  const [markInput, setMarkInput] = useState("")
  const [markError, setMarkError] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const didInit = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Resume-to-last-watched bookkeeping: skip when the user explicitly navigated
  // with a ?page= / ?ep= intent; resume once on initial load, and again when the
  // user switches INTO "Watch Order" (chronological) mode.
  const hadNavIntent = useRef(initialPage != null || jumpTarget != null)
  const didAutoJump = useRef(false)
  const resumeOnModeSwitch = useRef(false)

  const PAGE_SIZE = 30

  // Highest episode number that actually exists in the tracker, so the
  // "jump to" / "mark up to" UI never caps at a stale hardcoded ceiling.
  const maxEpisode = useMemo(() => {
    let max = 1209
    for (const e of entries) {
      if (e.type === "episode" && typeof e.episode_number === "number" && e.episode_number > max) {
        max = e.episode_number
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
    return { items, indexById }
  }, [entries])

  // Canon tallies over every episode row, independent of the status filter, so
  // the summary line reads as a fact about the series rather than the view.
  const canonCounts = useMemo(() => {
    const counts: Record<CanonBucket, number> = {
      manga_canon: 0,
      anime_canon: 0,
      filler: 0,
      unclassified: 0,
    }
    for (const e of entries) {
      if (e.type !== "episode" || typeof e.episode_number !== "number") continue
      counts[canonSectionBucket(e.episode_number)] += 1
    }
    return counts
  }, [entries])

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
    const key =
      typeFilter !== "all"
        ? sections.find((s) => s.type === typeFilter)?.key
        : mode === "chronological"
          ? "episode"
          : null
    if (key) setPages((prev) => ({ ...prev, [key]: initialPage }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, typeFilter, mode])

  function matchesStatus(entry: ContentEntry): boolean {
    if (statusFilter === "all") return true
    const s = userStatuses?.get(entry.id)
    if (statusFilter === "unwatched") return !s || s === "unwatched"
    if (statusFilter === "watched") return s === "watched" || s === "rewatched"
    return s === statusFilter
  }

  /** Watched OR rewatched both count as "has been seen". */
  function isWatched(entry: ContentEntry): boolean {
    const s = userStatuses?.get(entry.id)
    return s === "watched" || s === "rewatched"
  }

  const totalYears = new Set(entries.map((e) => e.air_date?.slice(0, 4))).size
  const totalEpisodes = entries.filter((e) => e.type === "episode").length
  const totalMovies = entries.filter((e) => e.type === "movie").length
  const overallWatched = entries.filter(isWatched).length
  const overallPercent = entries.length > 0 ? Math.round((overallWatched / entries.length) * 100) : 0

  // Sections grouped by content type. Episodes are grouped by air-date year in
  // "year" mode, or sorted by canon_order in "chronological" mode.
  const sections = useMemo(() => {
    // Full Watch Order: one section holding the whole franchise in viewing
    // order. Reuses the accordion, image cards, pagination and progress bar
    // unchanged — only the ordering and the ordinal chips are new.
    if (mode === "order") {
      const list = watchOrder.items.map((item) => item.entry).filter(matchesStatus)
      if (list.length === 0) return []
      const orderSections: SectionData[] = [
        {
          key: WATCH_ORDER_KEY,
          type: "episode",
          title: "Full Watch Order",
          icon: Play,
          entries: list,
          watched: list.filter(isWatched).length,
          total: list.length,
        },
      ]
      return orderSections
    }

    const episodeFiltered = entries.filter((e) => e.type === "episode" && matchesStatus(e))
    const episodeSections: SectionData[] = []

    if (mode === "chronological") {
      const list = [...episodeFiltered].sort((a, b) => (a.canon_order ?? 0) - (b.canon_order ?? 0))
      episodeSections.push({
        key: "episode",
        type: "episode",
        title: CONTENT_TYPE_LABELS.episode,
        icon: BookOpen,
        entries: list,
        watched: list.filter(isWatched).length,
        total: list.length,
      })
    } else if (mode === "canon") {
      // Same accordion + image cards as By Year — grouped by canon type
      // instead of air-date year.
      const sorted = [...episodeFiltered].sort(
        (a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0)
      )
      const buckets = new Map<CanonBucket, ContentEntry[]>()
      for (const e of sorted) {
        const bucket = canonSectionBucket(e.episode_number)
        const list = buckets.get(bucket)
        if (list) list.push(e)
        else buckets.set(bucket, [e])
      }
      for (const bucket of CANON_SECTION_ORDER) {
        const list = buckets.get(bucket)
        if (!list || list.length === 0) continue
        episodeSections.push({
          key: `canon-${bucket}`,
          type: "episode",
          title: CANON_SECTION_LABELS[bucket],
          icon: CANON_SECTION_ICONS[bucket],
          entries: list,
          watched: list.filter(isWatched).length,
          total: list.length,
        })
      }
    } else {
      const byYear = new Map<string, ContentEntry[]>()
      for (const e of episodeFiltered) {
        const year = e.air_date?.slice(0, 4) ?? "Unknown"
        const bucket = byYear.get(year)
        if (bucket) bucket.push(e)
        else byYear.set(year, [e])
      }
      for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sorted = list.sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
        episodeSections.push({
          key: `year-${year}`,
          type: "episode",
          title: year,
          icon: BookOpen,
          entries: sorted,
          watched: sorted.filter(isWatched).length,
          total: sorted.length,
        })
      }
    }

    const otherSections = SECTION_ORDER.filter((s) => s.type !== "episode")
      .map((s) => {
        const base = entries
          .filter((e) => e.type === s.type && matchesStatus(e))
          .sort((a, b) => getNumber(a) - getNumber(b))
        const config = SUBCATEGORY_CONFIGS[s.type]
        let list = base
        let activeSubcat: string | undefined
        let subcats: { key: string; label: string; count: number }[] | undefined
        if (config) {
          activeSubcat = subcat[s.type] ?? config.defaultKey
          subcats = config.groups
            .map((g) => ({
              key: g.key,
              label: g.label,
              count: base.filter((e) => g.match(e)).length,
            }))
            .filter((g) => g.count > 0)
          const activeGroup = config.groups.find((g) => g.key === activeSubcat)
          if (activeGroup) list = base.filter((e) => activeGroup.match(e))
        }
        return {
          key: s.type,
          type: s.type,
          title: CONTENT_TYPE_LABELS[s.type],
          icon: s.icon,
          entries: list,
          watched: list.filter(isWatched).length,
          total: list.length,
          subcats,
          activeSubcat,
        }
      })
      .filter((s) => s.total > 0)

    return [...episodeSections, ...otherSections].filter((s) => s.total > 0)
  }, [entries, userStatuses, mode, statusFilter, subcat])

  // Full Watch Order is a single section whose SectionData.type is always
  // "episode"; section-level type filtering would hide it outright.
  const visibleSections =
    typeFilter === "all" || mode === "order"
      ? sections
      : sections.filter((s) => s.type === typeFilter)

  // Open the first section by default, only once on initial load
  useEffect(() => {
    if (!didInit.current && sections.length > 0) {
      didInit.current = true
      setExpandedType(sections[0].key)
    }
  }, [sections])

  // Guide modes rebuild the section keys from scratch, so the previously open
  // key no longer exists — open the first section instead of showing a fully
  // collapsed accordion. Keyed on `mode` only: re-running on every `sections`
  // change would re-open a section the user just collapsed.
  useEffect(() => {
    if (mode === "canon" || mode === "order") setExpandedType(sections[0]?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Selecting a single type filter opens that section
  useEffect(() => {
    if (mode === "order") return
    if (typeFilter !== "all") {
      const first = sections.find((s) => s.type === typeFilter)
      setExpandedType(first?.key ?? typeFilter)
    }
  }, [typeFilter, sections, mode])

  // Continue tracking: first few unwatched episodes in order
  const continueTracking = useMemo(() => {
    return entries
      .filter((e) => e.type === "episode" && matchesStatus(e) && !isWatched(e))
      .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
      .slice(0, 12)
  }, [entries, userStatuses, statusFilter])

  // Search results (search overrides sections)
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const trimmed = q.trim()
    const isNumericQuery = /^\d+$/.test(trimmed)
    const qNum = Number(trimmed)
    return entries
      .filter((e) => {
        if (!matchesStatus(e)) return false
        const titleHit = e.title.toLowerCase().includes(q)
        const synopsisHit = (e.synopsis ?? "").toLowerCase().includes(q)
        // Numeric fields so "50" finds episode 50 (whose title has no "50")
        const numberHit = [e.episode_number, e.movie_number, e.release_order]
          .filter((n): n is number => typeof n === "number")
          .some((n) => String(n).includes(q))
        // Exact number match (e.g. "28" → movie 28)
        const exactNumberHit = isNumericQuery && getNumber(e) === qNum
        return titleHit || synopsisHit || numberHit || exactNumberHit
      })
      .sort((a, b) => getNumber(a) - getNumber(b))
  }, [search, entries, statusFilter])

  function getStatusForEntry(id: string): WatchStatus | null {
    return userStatuses?.get(id) ?? null
  }

  function getArcForEntry(entry: ContentEntry): { slug: string; title: string } | null {
    if (!arcMap || entry.type !== "episode") return null
    return arcMap.get(entry.arc_id ?? "") ?? null
  }

  function handleJump(value: string) {
    const n = parseInt(value, 10)
    if (!Number.isInteger(n) || n < 1 || n > maxEpisode) {
      setJumpError(`Enter an episode number between 1 and ${maxEpisode}.`)
      return
    }
    const ep = entries.find((e) => e.type === "episode" && e.episode_number === n)
    if (!ep) {
      setJumpError(`Episode ${n} isn't in the tracker yet.`)
      return
    }
    setJumpError(null)
    setTypeFilter("all")
    setStatusFilter("all")

    let targetKey: string
    let pageIdx = 0
    if (mode === "order") {
      targetKey = WATCH_ORDER_KEY
      const orderList = sections.find((s) => s.key === targetKey)?.entries ?? []
      pageIdx = Math.floor(Math.max(0, orderList.findIndex((e) => e.id === ep.id)) / PAGE_SIZE)
    } else if (mode === "canon") {
      // The target section is whichever canon bucket this episode belongs to.
      targetKey = `canon-${canonSectionBucket(n)}`
      const canonList = sections.find((s) => s.key === targetKey)?.entries ?? []
      pageIdx = Math.floor(
        Math.max(0, canonList.findIndex((e) => e.id === ep.id)) / PAGE_SIZE
      )
    } else if (mode === "year") {
      const year = ep.air_date?.slice(0, 4) ?? "Unknown"
      targetKey = `year-${year}`
      const yearList = sections.find((s) => s.key === targetKey)?.entries ?? []
      pageIdx = Math.floor(Math.max(0, yearList.findIndex((e) => e.id === ep.id)) / PAGE_SIZE)
    } else {
      targetKey = "episode"
      const epList = sections.find((s) => s.key === targetKey)?.entries ?? []
      pageIdx = Math.floor(Math.max(0, epList.findIndex((e) => e.id === ep.id)) / PAGE_SIZE)
    }
    setExpandedType(targetKey)
    setPages((prev) => ({ ...prev, [targetKey]: pageIdx }))

    requestAnimationFrame(() => {
      const el = document.getElementById(`card-${ep.id}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        setFlashId(ep.id)
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlashId(null), 2000)
      }
    })
  }

  // External jump request (from the ?ep= URL param)
  useEffect(() => {
    if (jumpTarget && Number.isInteger(jumpTarget) && jumpTarget >= 1 && jumpTarget <= maxEpisode) {
      handleJump(String(jumpTarget))
      onJumped?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget])

  /**
   * "Watch Order" resume: scroll the grid to the highest episode the user has
   * watched (watched OR rewatched), so reopening /tracker in chronological
   * mode lands near where they left off instead of page 1.
   */
  const resumeToLastWatched = useCallback(() => {
    if (mode !== "chronological") return
    if (statusFilter !== "all") return
    if (!userStatuses || userStatuses.size === 0) return
    const epSection = sections.find((s) => s.key === "episode")
    if (!epSection || epSection.entries.length === 0) return
    let target: ContentEntry | null = null
    for (const e of epSection.entries) {
      const s = userStatuses.get(e.id)
      if (s === "watched" || s === "rewatched") {
        if (!target || (e.episode_number ?? 0) > (target.episode_number ?? 0)) target = e
      }
    }
    if (!target) return
    const idx = Math.max(0, epSection.entries.findIndex((e) => e.id === target!.id))
    const pageIdx = Math.floor(idx / PAGE_SIZE)
    setPages((prev) => ({ ...prev, episode: pageIdx }))
    setExpandedType("episode")
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`card-${target!.id}`)
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          setFlashId(target!.id)
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlashId(null), 2000)
        }
      })
    })
  }, [mode, statusFilter, userStatuses, sections])

  // Resume once on initial load, once statuses + sections are ready. Skip when
  // the user explicitly navigated with ?page= or ?ep= intent.
  useEffect(() => {
    if (hadNavIntent.current) {
      didAutoJump.current = true
      return
    }
    if (didAutoJump.current) return
    if (userStatuses && userStatuses.size > 0 && sections.length > 0) {
      resumeToLastWatched()
      didAutoJump.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeToLastWatched, userStatuses, sections])

  // Resume again when the user switches INTO chronological mode mid-session
  // (fires after sections recompute for the new mode).
  useEffect(() => {
    if (!resumeOnModeSwitch.current) return
    if (sections.find((s) => s.key === "episode")?.entries.length) {
      resumeOnModeSwitch.current = false
      resumeToLastWatched()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sections, resumeToLastWatched])

  function handleMarkUpTo(value: string) {
    const n = parseInt(value, 10)
    if (!Number.isInteger(n) || n < 1 || n > maxEpisode) {
      setMarkError(`Enter a valid episode number (between 1 and ${maxEpisode}).`)
      return
    }
    if (!onMarkAll) return
    const ids = entries
      .filter(
        (e) =>
          e.type === "episode" &&
          (e.episode_number ?? 0) <= n &&
          !isWatched(e)
      )
      .map((e) => e.id)
    if (ids.length === 0) {
      setMarkError(`Nothing to mark. All episodes up to ${n} are already watched.`)
      return
    }
    setMarkError(null)
    onMarkAll(ids, "watched")
    setMarkInput("")
  }
  const presentTypes = new Set(sections.map((s) => s.type))
  const pillTypes = SECTION_ORDER.map((s) => s.type).filter((t) => presentTypes.has(t))

  return (
    <div className="space-y-0">
      {/* ── Hero Banner ── */}
      <div className="relative w-full h-64 sm:h-80 bg-surface-muted overflow-hidden rounded-t-lg border-b border-line/40">
        {/* Tracker Banner Image */}
        <Image
          src="/tracker-image.jpg"
          alt="Detective Conan Tracker Banner"
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="absolute inset-0 h-full w-full object-cover object-[center_10%]"
        />
        {/* Gradient overlay at bottom to ensure text readability on top of straight image */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

        <div className="relative z-10 flex flex-col justify-end h-full p-6 sm:p-8 text-white">
          <h1 className="font-display text-3xl sm:text-5xl leading-tight tracking-tight text-white mb-2 drop-shadow-md">
            Detective Conan
          </h1>
          <div className="flex items-center gap-2 text-sm text-white/90 mb-3 drop-shadow">
            <span className="font-mono text-xs">{totalYears} years</span>
            <span>·</span>
            <span className="font-mono text-xs">{totalEpisodes} episodes</span>
            <span>·</span>
            <span className="font-mono text-xs">{totalMovies} movies</span>
          </div>
          <div className="flex items-center gap-2.5 max-w-md">
            <div className="flex-1 h-2 bg-black/40 backdrop-blur-xs rounded-full overflow-hidden border border-white/20">
              <motion.div
                className="h-full bg-accent rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${overallPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <span className="font-mono text-xs text-white font-bold drop-shadow">{overallPercent}%</span>
          </div>
        </div>
      </div>

      {/* ── Sticky Toolbar ── */}
      <div className="sticky top-16 z-20 bg-surface/95 backdrop-blur border-b border-ink-dim/20 px-4 sm:px-6 py-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            type="text"
            placeholder="Search episodes, movies, specials..."
            aria-label="Search episodes, movies, specials"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              onSearchChange?.(e.target.value)
            }}
            className="w-full h-9 rounded-lg border border-ink-dim/20 bg-surface-muted pl-10 pr-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>

        {/* Dropdown filters: view mode / status / type */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Select
            value={mode}
            onValueChange={(v) => {
              setMode(v as ViewMode)
              if (v === "chronological" && mode !== "chronological") {
                resumeOnModeSwitch.current = true
              }
              onModeChange?.(v as ViewMode)
            }}
          >
            <SelectTrigger className="h-9 text-xs font-mono">
              <SelectValue placeholder="View mode" />
            </SelectTrigger>
            <SelectContent>
              {VIEW_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as StatusFilter)
              onStatusFilterChange?.(v as StatusFilter)
            }}
          >
            <SelectTrigger className="h-9 text-xs font-mono">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(Object.keys(WATCH_STATUS_LABELS) as WatchStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {WATCH_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v as ContentType | "all")
              onTypeChange?.(v as ContentType | "all")
            }}
          >
            <SelectTrigger className="h-9 text-xs font-mono col-span-2 sm:col-span-1">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {pillTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {CONTENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Jump-to-episode + mark-up-to-N */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine className="h-3.5 w-3.5 text-ink-faint shrink-0" />
            <input
              type="number"
              min={1}
              max={maxEpisode}
              placeholder="EP no."
              aria-label="Jump to episode number"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJump(jumpInput)
              }}
              className="w-20 h-9 rounded-md border border-ink-dim/20 bg-surface-muted px-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <button
              onClick={() => handleJump(jumpInput)}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-ink-dim/30 bg-surface text-[10px] font-mono text-ink-faint hover:text-ink hover:border-ink transition-colors"
              title="Jump to episode"
            >
              Jump
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-ink-faint shrink-0">
              Mark up to
            </span>
            <input
              type="number"
              min={1}
              max={maxEpisode}
              placeholder="EP no."
              aria-label="Mark up to episode number"
              value={markInput}
              onChange={(e) => setMarkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleMarkUpTo(markInput)
              }}
              className="w-20 h-9 rounded-md border border-ink-dim/20 bg-surface-muted px-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <button
              onClick={() => handleMarkUpTo(markInput)}
              disabled={!onMarkAll}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-ink-dim/30 bg-surface text-[10px] font-mono text-ink-faint hover:text-ink hover:border-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={onMarkAll ? "Mark episodes up to N as watched" : "Sign in to mark episodes"}
            >
              <Check className="h-3.5 w-3.5" />
              Mark
            </button>
          </div>

          {jumpError && <span className="text-[11px] text-red-400">{jumpError}</span>}
          {markError && <span className="text-[11px] text-red-400">{markError}</span>}
        </div>
      </div>

      {/* ── Search Results ── */}
      {searchResults && (
        <div className="px-4 sm:px-6 py-6">
          <p className="font-mono text-[10px] text-ink-faint mb-4">
            {searchResults.length} results for &quot;{search}&quot;
          </p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-ink-dim">No matches found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {searchResults.map((entry) => (
                <ContentCard
                  key={entry.id}
                  entry={entry}
                  watchStatus={getStatusForEntry(entry.id)}
                  onSetStatus={onSetStatus}
                  onIncrementRewatch={onIncrementRewatch}
                  watchCount={watchCounts?.get(entry.id) ?? 0}
                  flash={flashId === entry.id}
                  arc={getArcForEntry(entry)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sectioned Browse (accordion) ── */}
      {!searchResults && (
        <div>
          {/* Canon Guide legend — explains the grouping, not a separate layout */}
          {mode === "canon" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-dim/10 px-4 sm:px-6 pt-5 pb-4">
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
            <div className="border-b border-ink-dim/10 px-4 sm:px-6 pt-5 pb-4">
              <p className="text-xs text-ink-dim">
                Every episode, movie, OVA, TV special, live-action drama and spin-off in one
                continuous run. The number on each card is its position in the order.
              </p>
            </div>
          )}

          {/* Continue Tracking — always-visible quick strip */}
          {continueTracking.length > 0 && typeFilter === "all" && mode !== "order" && (
            <div className="px-4 sm:px-6 py-5 border-b border-ink-dim/10">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-page shrink-0">
                  <Play className="h-4 w-4" />
                </span>
                <h2 className="font-display text-sm tracking-tight text-ink">
                  Continue Tracking
                </h2>
                <span className="font-mono text-xs text-ink-dim rounded-md bg-surface-muted px-1.5 py-0.5">
                  {continueTracking.length}
                </span>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-ink-dim/40 scrollbar-track-transparent snap-x">
                {continueTracking.map((entry) => (
                  <div key={entry.id} className="snap-start w-36 sm:w-40 shrink-0">
                    <ContentCard
                      entry={entry}
                      watchStatus={getStatusForEntry(entry.id)}
                      onSetStatus={onSetStatus}
                      onIncrementRewatch={onIncrementRewatch}
                      watchCount={watchCounts?.get(entry.id) ?? 0}
                      favorite={favorites?.get(entry.id) ?? false}
                      onToggleFavorite={onToggleFavorite}
                      rating={ratings?.get(entry.id) ?? 0}
                      onSetRating={onSetRating}
                      arc={getArcForEntry(entry)}
                      onSelect={onSelect}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleSections.map((section) => {
            const Icon = section.icon
            const isOpen = expandedType === section.key
            const complete = section.watched === section.total
            const started = section.watched > 0
            const progressColor = complete
              ? "bg-green-500"
              : started
                ? "bg-ink"
                : "bg-surface-muted"
            const totalPages = Math.max(1, Math.ceil(section.entries.length / PAGE_SIZE))
            const page = Math.min(pages[section.key] ?? 0, totalPages - 1)
            const pageItems = section.entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

            return (
              <Section
                key={section.key}
                icon={Icon}
                title={section.title}
                count={section.total}
                watched={section.watched}
                progressColor={progressColor}
                progressPercent={section.total > 0 ? (section.watched / section.total) * 100 : 0}
                isOpen={isOpen}
                onToggle={() => setExpandedType(isOpen ? null : section.key)}
                action={
                  section.subcats && section.subcats.length > 1 ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={section.activeSubcat}
                        onValueChange={(v) => setSubcatKey(section.key, v)}
                      >
                        <SelectTrigger
                          className="h-8 w-auto gap-1.5 border border-ink-dim/30 bg-surface px-3 text-xs font-mono text-ink-faint hover:text-ink hover:border-ink transition-colors"
                          aria-label={`${section.title} subcategory`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {section.subcats.map((g) => (
                            <SelectItem key={g.key} value={g.key}>
                              {g.label} ({g.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : onMarkAll && !complete && section.type === "episode" ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onMarkAll(
                          section.entries.filter((en) => !isWatched(en)).map((en) => en.id),
                          "watched"
                        )
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-ink-dim/30 bg-surface text-[10px] font-mono text-ink-faint hover:text-ink hover:border-ink transition-colors"
                      title="Mark all as watched"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Mark all
                    </button>
                  ) : null
                }
              >
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-1">
                    {pageItems.map((entry) => {
                      const card = (
                        <ContentCard
                          key={entry.id}
                          entry={entry}
                          watchStatus={getStatusForEntry(entry.id)}
                          onSetStatus={onSetStatus}
                          onIncrementRewatch={onIncrementRewatch}
                          watchCount={watchCounts?.get(entry.id) ?? 0}
                          favorite={favorites?.get(entry.id) ?? false}
                          onToggleFavorite={onToggleFavorite}
                          rating={ratings?.get(entry.id) ?? 0}
                          onSetRating={onSetRating}
                          flash={flashId === entry.id}
                          arc={getArcForEntry(entry)}
                          onSelect={onSelect}
                        />
                      )
                      if (mode !== "order") return card
                      const ordinal = watchOrder.indexById.get(entry.id)
                      return (
                        <div key={entry.id} className="relative">
                          {ordinal !== undefined && (
                            <span
                              className={cn(
                                "pointer-events-none absolute left-1.5 top-1.5 z-10 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow-sm",
                                // Non-episodes get the accent so movies, OVAs and
                                // specials stand out from the run of episodes.
                                entry.type === "episode"
                                  ? "bg-ink/90 text-page"
                                  : "bg-accent text-page"
                              )}
                            >
                              {ordinal}
                            </span>
                          )}
                          {card}
                        </div>
                      )
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <button
                        onClick={() => setPage(section.key, Math.max(0, page - 1))}
                        disabled={page === 0}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-ink-dim/30 bg-surface text-[11px] font-mono text-ink-dim transition-colors hover:text-ink hover:border-ink disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-ink-dim/30 disabled:hover:text-ink-dim"
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
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-ink-dim/30 bg-surface text-[11px] font-mono text-ink-dim transition-colors hover:text-ink hover:border-ink disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-ink-dim/30 disabled:hover:text-ink-dim"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </>
              </Section>
            )
          })}

          {visibleSections.length === 0 && typeFilter !== "all" && (
            <div className="p-10 text-center text-sm text-ink-dim">
              No {CONTENT_TYPE_LABELS[typeFilter]} found in the tracker.
            </div>
          )}

          {/* About */}
          <Section icon={Info} title="About the Series" isOpen={expandedType === "__about"} onToggle={() => setExpandedType(expandedType === "__about" ? null : "__about")}>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                <p className="text-sm text-ink-dim leading-relaxed">
                  High school detective Shinichi Kudo, known as the &quot;Savior of the Japanese Police Force,&quot;
                  is poisoned by the Black Organization and shrinks into a child. Taking the alias Conan Edogawa,
                  he secretly solves cases while searching for clues about the mysterious organization and an antidote
                  to return to his true form.
                </p>
                <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                  <Detail term="Creator" value="Gosho Aoyama" />
                  <Detail term="Studio" value="TMS Entertainment" />
                  <Detail term="First Aired" value="January 8, 1996" />
                  <Detail term="Status" value="Ongoing" />
                </dl>
              </div>
              <div className="bg-surface-muted border border-ink-dim/20 rounded-lg p-5 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-3 text-ink">
                  <Users className="h-4 w-4" />
                  <span className="font-display text-sm text-ink">Progress</span>
                </div>
                <div className="font-display text-3xl text-ink">{overallPercent}%</div>
                <div className="font-mono text-[10px] text-ink-faint mt-1">
                  {overallWatched} of {entries.length} watched
                </div>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

/* ──────────────────────── Accordion Section ──────────────────────── */

function Section({
  icon: Icon,
  title,
  count,
  watched,
  progressColor,
  progressPercent,
  isOpen,
  onToggle,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  watched?: number
  progressColor?: string
  progressPercent?: number
  isOpen: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const showProgress =
    typeof progressPercent === "number" &&
    typeof watched === "number" &&
    typeof count === "number"

  return (
    <section className="border-b border-ink-dim/10 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-4 px-4 sm:px-6 py-4 hover:bg-surface-muted transition-colors text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-page shrink-0">
          <Icon className="h-4 w-4" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base sm:text-lg tracking-tight text-ink truncate">
              {title}
            </h2>
            {typeof count === "number" && (
              <span className="font-mono text-xs text-ink-dim shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5">
                {count}
              </span>
            )}
          </div>
          {showProgress && (
            <div className="mt-2 flex items-center gap-3 max-w-xs">
              <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                <motion.div
                  className={cn("h-full rounded-full", progressColor)}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <span className="font-mono text-[10px] text-ink-dim shrink-0 tabular-nums">
                {watched}/{count}
              </span>
            </div>
          )}
        </div>

        {action && <div className="shrink-0">{action}</div>}

        <ChevronDown
          className={cn(
            "h-5 w-5 text-ink-faint shrink-0 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-6 pb-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/* ──────────────────────── Small helpers ──────────────────────── */

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] text-ink-faint">{term}</dt>
      <dd className="text-ink mt-0.5">{value}</dd>
    </div>
  )
}
