"use client"

import { useState, useMemo, useEffect, useRef } from "react"
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

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export type StatusFilter = "all" | WatchStatus

interface ContentGridProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
  /** watch_count per content id, for rewatch badges. */
  watchCounts?: Map<string, number>
  /** favorite flag per content id. */
  favorites?: Map<string, boolean>
  onToggleFavorite?: (contentId: string, current: boolean) => void
  onMarkAll?: (ids: string[], status: WatchStatus) => void
  /** Initial values for the view mode / filters. Used for URL persistence. */
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
]

const MAX_EPISODE = 1209

function getNumber(entry: ContentEntry): number {
  if (entry.type === "movie") return entry.movie_number ?? 0
  if (entry.type === "episode") return entry.episode_number ?? 0
  return entry.release_order ?? 0
}

export function ContentGrid({
  entries,
  userStatuses,
  onToggleStatus,
  watchCounts,
  favorites,
  onToggleFavorite,
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
}: ContentGridProps) {
  const [search, setSearch] = useState(initialSearch)
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">(initialType)
  const [mode, setMode] = useState<ViewMode>(initialMode)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [jumpInput, setJumpInput] = useState("")
  const [jumpError, setJumpError] = useState<string | null>(null)
  const [markInput, setMarkInput] = useState("")
  const [markError, setMarkError] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const didInit = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAGE_SIZE = 30

  function setPage(key: string, page: number) {
    setPages((prev) => ({ ...prev, [key]: page }))
    onPageChange?.(key, page)
  }

  // Sync external (URL) state changes back into the grid.
  useEffect(() => setSearch(initialSearch), [initialSearch])
  useEffect(() => setTypeFilter(initialType), [initialType])
  useEffect(() => setMode(initialMode), [initialMode])
  useEffect(() => setStatusFilter(initialStatusFilter), [initialStatusFilter])
  useEffect(() => {
    if (initialPage === undefined) return
    const key = typeFilter !== "all" ? sections.find((s) => s.type === typeFilter)?.key : null
    if (key) setPages((prev) => ({ ...prev, [key]: initialPage }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, typeFilter])

  function matchesStatus(entry: ContentEntry): boolean {
    if (statusFilter === "all") return true
    const s = userStatuses?.get(entry.id)
    if (statusFilter === "unwatched") return !s || s === "unwatched"
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
    const episodeFiltered = entries.filter((e) => e.type === "episode" && matchesStatus(e))
    const episodeSections: {
      key: string
      type: ContentType
      title: string
      icon: React.ComponentType<{ className?: string }>
      entries: ContentEntry[]
      watched: number
      total: number
    }[] = []

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
        const list = entries
          .filter((e) => e.type === s.type && matchesStatus(e))
          .sort((a, b) => getNumber(a) - getNumber(b))
        return {
          key: s.type,
          type: s.type,
          title: CONTENT_TYPE_LABELS[s.type],
          icon: s.icon,
          entries: list,
          watched: list.filter(isWatched).length,
          total: list.length,
        }
      })
      .filter((s) => s.total > 0)

    return [...episodeSections, ...otherSections].filter((s) => s.total > 0)
  }, [entries, userStatuses, mode, statusFilter])

  const visibleSections =
    typeFilter === "all" ? sections : sections.filter((s) => s.type === typeFilter)

  // Open the first section by default, only once on initial load
  useEffect(() => {
    if (!didInit.current && sections.length > 0) {
      didInit.current = true
      setExpandedType(sections[0].key)
    }
  }, [sections])

  // Selecting a single type filter opens that section
  useEffect(() => {
    if (typeFilter !== "all") {
      const first = sections.find((s) => s.type === typeFilter)
      setExpandedType(first?.key ?? typeFilter)
    }
  }, [typeFilter, sections])

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
    return entries
      .filter(
        (e) =>
          matchesStatus(e) &&
          (e.title.toLowerCase().includes(q) || (e.synopsis ?? "").toLowerCase().includes(q))
      )
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
    if (!Number.isInteger(n) || n < 1 || n > MAX_EPISODE) {
      setJumpError(`Enter an episode number between 1 and ${MAX_EPISODE}.`)
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
    if (mode === "year") {
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
    if (jumpTarget && Number.isInteger(jumpTarget) && jumpTarget >= 1 && jumpTarget <= MAX_EPISODE) {
      handleJump(String(jumpTarget))
      onJumped?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget])

  function handleMarkUpTo(value: string) {
    const n = parseInt(value, 10)
    if (!Number.isInteger(n) || n < 1 || n > MAX_EPISODE) {
      setMarkError(`Enter a valid episode number (1–${MAX_EPISODE}).`)
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
      setMarkError(`Nothing to mark — all episodes up to ${n} are already watched.`)
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
      <div className="relative w-full h-48 sm:h-64 bg-gradient-to-b from-gray-100 to-white overflow-hidden rounded-t-lg">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(165,32,45,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(165,32,45,0.05)_1px,transparent_1px)] bg-[size:3rem_3rem]" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
          <h1 className="font-display text-3xl sm:text-5xl uppercase tracking-wider text-gray-900 mb-1">
            Detective Conan
          </h1>
          <div className="flex items-center gap-3 text-sm text-gray-500 mb-3">
            <span className="font-mono text-xs">{totalYears} years</span>
            <span>·</span>
            <span className="font-mono text-xs">{totalEpisodes} episodes</span>
            <span>·</span>
            <span className="font-mono text-xs">{totalMovies} movies</span>
          </div>
          <div className="flex items-center gap-3 max-w-md">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gray-900 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${overallPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <span className="font-mono text-xs text-gray-900 font-bold">{overallPercent}%</span>
          </div>
        </div>
      </div>

      {/* ── Toolbar: search + view mode + status + type filters ── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-4 sm:px-6 py-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search episodes, movies, specials..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              onSearchChange?.(e.target.value)
            }}
            className="w-full h-9 rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent -mx-1 px-1">
          {/* View mode toggle */}
          <div className="flex shrink-0 rounded-sm border border-gray-200 overflow-hidden">
            {VIEW_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setMode(opt.value)
                  onModeChange?.(opt.value)
                }}
                className={cn(
                  "px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors",
                  mode === opt.value
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-500 hover:text-gray-900"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="h-4 w-px bg-gray-200 mx-1 shrink-0" />

          {/* Status filter pills */}
          <FilterPill
            label="All"
            active={statusFilter === "all"}
            onClick={() => {
              setStatusFilter("all")
              onStatusFilterChange?.("all")
            }}
          />
          {(Object.keys(WATCH_STATUS_LABELS) as WatchStatus[]).map((s) => (
            <FilterPill
              key={s}
              label={WATCH_STATUS_LABELS[s]}
              active={statusFilter === s}
              onClick={() => {
                setStatusFilter(s)
                onStatusFilterChange?.(s)
              }}
            />
          ))}
        </div>

        {/* Jump-to-episode + mark-up-to-N */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="number"
              min={1}
              max={MAX_EPISODE}
              placeholder="EP no."
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJump(jumpInput)
              }}
              className="w-20 h-7 rounded-sm border border-gray-200 bg-gray-50 px-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
            />
            <button
              onClick={() => handleJump(jumpInput)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-sm border border-gray-300 text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:border-gray-900 transition-colors"
              title="Jump to episode"
            >
              Jump
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 shrink-0">
              Mark up to
            </span>
            <input
              type="number"
              min={1}
              max={MAX_EPISODE}
              placeholder="EP no."
              value={markInput}
              onChange={(e) => setMarkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleMarkUpTo(markInput)
              }}
              className="w-20 h-7 rounded-sm border border-gray-200 bg-gray-50 px-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
            />
            <button
              onClick={() => handleMarkUpTo(markInput)}
              disabled={!onMarkAll}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-sm border border-gray-300 text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:border-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={onMarkAll ? "Mark episodes up to N as watched" : "Sign in to mark episodes"}
            >
              <Check className="h-3.5 w-3.5" />
              Mark
            </button>
          </div>

          {jumpError && <span className="text-[11px] text-red-600">{jumpError}</span>}
          {markError && <span className="text-[11px] text-red-600">{markError}</span>}
        </div>

        {/* Type filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent -mx-1 px-1">
          <FilterPill
            label="All"
            active={typeFilter === "all"}
            onClick={() => {
              setTypeFilter("all")
              onTypeChange?.("all")
            }}
          />
          {pillTypes.map((t) => (
            <FilterPill
              key={t}
              label={CONTENT_TYPE_LABELS[t]}
              active={typeFilter === t}
              onClick={() => {
                setTypeFilter(typeFilter === t ? "all" : t)
                onTypeChange?.(typeFilter === t ? "all" : t)
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Search Results ── */}
      {searchResults && (
        <div className="p-6">
          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-4">
            {searchResults.length} results for &quot;{search}&quot;
          </p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-gray-500">No matches found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {searchResults.map((entry) => (
                <ContentCard
                  key={entry.id}
                  entry={entry}
                  watchStatus={getStatusForEntry(entry.id)}
                  onToggleStatus={onToggleStatus}
                  flash={flashId === entry.id}
                  arc={getArcForEntry(entry)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sectioned Browse (accordion) ── */}
      {!searchResults && (
        <div>
          {/* Continue Tracking — always-visible quick strip */}
          {continueTracking.length > 0 && typeFilter === "all" && (
            <div className="px-4 sm:px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-white shrink-0">
                  <Play className="h-3.5 w-3.5" />
                </span>
                <h2 className="font-display text-sm uppercase tracking-wider text-gray-900">
                  Continue Tracking
                </h2>
                <span className="font-mono text-xs text-gray-500">{continueTracking.length}</span>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent snap-x">
                {continueTracking.map((entry) => (
                  <div key={entry.id} className="snap-start w-36 sm:w-40 shrink-0">
                    <ContentCard
                      entry={entry}
                      watchStatus={getStatusForEntry(entry.id)}
                      onToggleStatus={onToggleStatus}
                      watchCount={watchCounts?.get(entry.id) ?? 0}
                      favorite={favorites?.get(entry.id) ?? false}
                      onToggleFavorite={onToggleFavorite}
                      arc={getArcForEntry(entry)}
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
                ? "bg-gray-900"
                : "bg-gray-200"
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
                  onMarkAll && !complete && section.type === "episode" ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onMarkAll(section.entries.map((en) => en.id), "watched")
                      }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm border border-gray-300 text-[10px] font-mono uppercase tracking-wider text-gray-500 hover:text-gray-900 hover:border-gray-900 transition-colors"
                      title="Mark all as watched"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Mark all
                    </button>
                  ) : null
                }
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-1">
                  {pageItems.map((entry) => (
                    <ContentCard
                      key={entry.id}
                      entry={entry}
                      watchStatus={getStatusForEntry(entry.id)}
                      onToggleStatus={onToggleStatus}
                      watchCount={watchCounts?.get(entry.id) ?? 0}
                      favorite={favorites?.get(entry.id) ?? false}
                      onToggleFavorite={onToggleFavorite}
                      flash={flashId === entry.id}
                      arc={getArcForEntry(entry)}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-5">
                    <button
                      onClick={() => setPage(section.key, Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-sm border border-gray-300 text-[11px] font-mono uppercase tracking-wider text-gray-600 transition-colors hover:text-gray-900 hover:border-gray-900 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </button>
                    <span className="font-mono text-xs text-gray-500">
                      Page {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(section.key, Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-sm border border-gray-300 text-[11px] font-mono uppercase tracking-wider text-gray-600 transition-colors hover:text-gray-900 hover:border-gray-900 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </Section>
            )
          })}

          {visibleSections.length === 0 && typeFilter !== "all" && (
            <div className="p-10 text-center text-sm text-gray-500">
              No {CONTENT_TYPE_LABELS[typeFilter]} found in the tracker.
            </div>
          )}

          {/* About */}
          <Section icon={Info} title="About the Series" isOpen={expandedType === "__about"} onToggle={() => setExpandedType(expandedType === "__about" ? null : "__about")}>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                <p className="text-sm text-gray-600 leading-relaxed">
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
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-3 text-gray-900">
                  <Users className="h-4 w-4" />
                  <span className="font-display uppercase tracking-wider text-sm">Progress</span>
                </div>
                <div className="font-display text-3xl text-gray-900">{overallPercent}%</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">
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
    <section className="border-b border-gray-100 last:border-b-0">
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
        className="w-full flex items-center gap-4 px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-gray-900/30"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-900 text-white shrink-0">
          <Icon className="h-4 w-4" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base sm:text-lg uppercase tracking-wider text-gray-900 truncate">
              {title}
            </h2>
            {typeof count === "number" && (
              <span className="font-mono text-xs text-gray-500 shrink-0">{count}</span>
            )}
          </div>
          {showProgress && (
            <div className="mt-2 flex items-center gap-3 max-w-xs">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  className={cn("h-full rounded-full", progressColor)}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <span className="font-mono text-[10px] text-gray-500 shrink-0">
                {watched}/{count}
              </span>
            </div>
          )}
        </div>

        {action && <div className="shrink-0">{action}</div>}

        <ChevronDown
          className={cn(
            "h-5 w-5 text-gray-400 shrink-0 transition-transform duration-200",
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

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider transition-colors border",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-500 border-gray-200 hover:text-gray-900 hover:border-gray-300"
      )}
    >
      {label}
    </button>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{term}</dt>
      <dd className="text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}
