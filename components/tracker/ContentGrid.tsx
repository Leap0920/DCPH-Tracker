"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, ChevronDown, ChevronUp, Search, Play, Eye, EyeOff, ShieldAlert, BookOpen, Users, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ContentGridProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
}

const SEASON_SIZE = 25

function groupIntoSeasons(episodes: ContentEntry[]) {
  const sorted = [...episodes]
    .filter(e => e.type === "episode")
    .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))

  const seasons: { label: string; startEp: number; endEp: number; entries: ContentEntry[] }[] = []
  
  for (let i = 0; i < sorted.length; i += SEASON_SIZE) {
    const chunk = sorted.slice(i, i + SEASON_SIZE)
    const seasonNum = Math.floor(i / SEASON_SIZE) + 1
    const startEp = chunk[0]?.episode_number ?? i + 1
    const endEp = chunk[chunk.length - 1]?.episode_number ?? i + chunk.length
    seasons.push({
      label: `Season ${seasonNum}`,
      startEp,
      endEp,
      entries: chunk,
    })
  }

  return seasons
}

export function ContentGrid({ entries, userStatuses, onToggleStatus }: ContentGridProps) {
  const [activeTab, setActiveTab] = useState<"episodes" | "about">("episodes")
  const [expandedSeason, setExpandedSeason] = useState<number | null>(0)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "episode" | "movie" | "special" | "ova">("all")

  // Split by type
  const episodes = useMemo(() => entries.filter(e => e.type === "episode").sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0)), [entries])
  const movies = useMemo(() => entries.filter(e => e.type === "movie").sort((a, b) => (a.movie_number ?? 0) - (b.movie_number ?? 0)), [entries])
  const specials = useMemo(() => entries.filter(e => e.type === "special" || e.type === "ova").sort((a, b) => new Date(a.air_date).getTime() - new Date(b.air_date).getTime()), [entries])

  // Season grouping
  const seasons = useMemo(() => groupIntoSeasons(entries), [entries])

  // Stats
  const totalEpisodes = episodes.length
  const watchedEpisodes = episodes.filter(e => userStatuses?.get(e.id) === "watched").length
  const progressPercent = totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0

  // Continue tracking: first 6 unwatched episodes in order
  const continueTracking = useMemo(() => {
    return episodes
      .filter(e => {
        const s = userStatuses?.get(e.id)
        return s !== "watched"
      })
      .slice(0, 6)
  }, [episodes, userStatuses])

  // Filtered entries for search
  const filteredEntries = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    return entries.filter(e => e.title.toLowerCase().includes(q))
  }, [search, entries])

  function getStatusForEntry(id: string): WatchStatus | null {
    return userStatuses?.get(id) ?? null
  }

  function isSeasonComplete(season: { entries: ContentEntry[] }) {
    return season.entries.length > 0 && season.entries.every(e => userStatuses?.get(e.id) === "watched")
  }

  function seasonWatchedCount(season: { entries: ContentEntry[] }) {
    return season.entries.filter(e => userStatuses?.get(e.id) === "watched").length
  }

  function seasonProgress(season: { entries: ContentEntry[] }) {
    if (season.entries.length === 0) return 0
    return (seasonWatchedCount(season) / season.entries.length) * 100
  }

  function getStatusColor(season: { entries: ContentEntry[] }) {
    const pct = seasonProgress(season)
    if (pct === 100) return "bg-green-500"
    if (pct > 0) return "bg-poison-red-bright"
    return "bg-silver-steel/30"
  }

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
            <span className="font-mono text-xs">{seasons.length} seasons</span>
            <span>·</span>
            <span className="font-mono text-xs">{totalEpisodes} episodes</span>
            <span>·</span>
            <span className="font-mono text-xs">{movies.length} movies</span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-3 max-w-md">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gray-900 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <span className="font-mono text-xs text-gray-900 font-bold">{progressPercent}%</span>
          </div>
        </div>
      </div>

      {/* ── Tabs Bar ── */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab("about")}
          className={cn(
            "flex-1 py-3 text-center font-display uppercase tracking-widest text-xs transition-colors border-b-2",
            activeTab === "about"
              ? "text-gray-900 border-gray-900"
              : "text-gray-400 border-transparent hover:text-gray-600"
          )}
        >
          About
        </button>
        <button
          onClick={() => setActiveTab("episodes")}
          className={cn(
            "flex-1 py-3 text-center font-display uppercase tracking-widest text-xs transition-colors border-b-2",
            activeTab === "episodes"
              ? "text-gray-900 border-gray-900"
              : "text-gray-400 border-transparent hover:text-gray-600"
          )}
        >
          Episodes
        </button>
      </div>

      {/* ── About Tab ── */}
      {activeTab === "about" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 space-y-6"
        >
          <div className="bg-gray-50 border border-gray-200 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-gray-900" />
              <span className="font-display uppercase tracking-wider text-sm text-gray-900">Synopsis</span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              High school detective Shinichi Kudo, known as the &quot;Savior of the Japanese Police Force,&quot; 
              is poisoned by the Black Organization and shrinks into a child. Taking the alias Conan Edogawa, 
              he secretly solves cases while searching for clues about the mysterious organization and an antidote 
              to return to his true form.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Episodes", value: totalEpisodes.toString(), icon: BookOpen },
              { label: "Movies", value: movies.length.toString(), icon: Play },
              { label: "Watched", value: watchedEpisodes.toString(), icon: Eye },
              { label: "Remaining", value: (totalEpisodes - watchedEpisodes).toString(), icon: EyeOff },
            ].map(stat => (
              <div key={stat.label} className="bg-gray-50 border border-gray-200 p-4 text-center rounded-lg">
                <stat.icon className="h-5 w-5 text-gray-900 mx-auto mb-2" />
                <div className="font-display text-2xl text-gray-900">{stat.value}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 border border-gray-200 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-gray-900" />
              <span className="font-display uppercase tracking-wider text-sm text-gray-900">Details</span>
            </div>
            <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Creator</dt>
                <dd className="text-gray-900 mt-0.5">Gosho Aoyama</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Studio</dt>
                <dd className="text-gray-900 mt-0.5">TMS Entertainment</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">First Aired</dt>
                <dd className="text-gray-900 mt-0.5">January 8, 1996</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Status</dt>
                <dd className="text-gray-900 mt-0.5">Ongoing</dd>
              </div>
            </dl>
          </div>
        </motion.div>
      )}

      {/* ── Episodes Tab ── */}
      {activeTab === "episodes" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-0"
        >
          {/* Continue Tracking */}
          {continueTracking.length > 0 && !search && (
            <div className="p-6 pb-2">
              <h2 className="font-display text-sm uppercase tracking-widest text-gray-900 mb-4">
                Continue tracking
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-3 -mx-2 px-2 scrollbar-thin scrollbar-thumb-case-file-raised scrollbar-track-transparent">
                {continueTracking.map(entry => {
                  const status = getStatusForEntry(entry.id)
                  return (
                    <div
                      key={entry.id}
                      className="flex-shrink-0 w-64 bg-white rounded-lg overflow-hidden border border-gray-200 group hover:border-gray-300 transition-colors shadow-sm"
                    >
                      <div className="flex items-center gap-3 p-3">
                        {/* Thumbnail placeholder */}
                        <div className="w-16 h-12 bg-gray-100 rounded-md flex items-center justify-center shrink-0 overflow-hidden">
                          {entry.image_url ? (
                            <img src={entry.image_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="font-display text-xs text-gray-300">
                              EP {padNumber(entry.episode_number ?? 0)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-xs uppercase tracking-wide text-gray-900 truncate">
                            EP {padNumber(entry.episode_number ?? 0)}
                          </p>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">
                            {entry.title}
                          </p>
                        </div>
                        {/* Status toggle */}
                        {onToggleStatus && (
                          <button
                            onClick={() => onToggleStatus(entry.id, status)}
                            className={cn(
                              "shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-all border",
                              status === "watched"
                                ? "bg-green-500 border-green-400 text-white"
                                : status === "watching"
                                  ? "bg-gray-900/10 border-gray-900 text-gray-900"
                                  : "bg-transparent border-gray-300 text-gray-400 hover:border-gray-900 hover:text-gray-900"
                            )}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* All Episodes Header */}
          <div className="px-6 pt-4 pb-2 flex items-center justify-between">
            <h2 className="font-display text-sm uppercase tracking-widest text-gray-900">
              All episodes
            </h2>
            <div className="flex items-center gap-2">
              {/* Type filter pills */}
              <div className="hidden sm:flex items-center gap-1">
                {(["all", "episode", "movie", "special"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t === typeFilter ? "all" : t)}
                    className={cn(
                      "px-2.5 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wider transition-colors",
                      typeFilter === t
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-500 hover:text-gray-900"
                    )}
                  >
                    {t === "all" ? "All" : t === "episode" ? "Episodes" : t === "movie" ? "Movies" : "Specials"}
                  </button>
                ))}
              </div>

              {/* Mark all circle */}
              <button
                className="h-7 w-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-900 transition-colors"
                title="Toggle all"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-6 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search episodes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
              />
            </div>
          </div>

          {/* Search Results */}
          {search && filteredEntries && (
            <div className="px-6 pb-6 space-y-1">
              <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">
                {filteredEntries.length} results
              </p>
              {filteredEntries.map(entry => (
                <EpisodeRow
                  key={entry.id}
                  entry={entry}
                  status={getStatusForEntry(entry.id)}
                  onToggleStatus={onToggleStatus}
                />
              ))}
            </div>
          )}

          {/* Season Accordions */}
          {!search && (
            <div className="space-y-0">
              {/* Movies section if not filtering to episodes only */}
              {(typeFilter === "all" || typeFilter === "movie") && movies.length > 0 && (
                <SeasonAccordion
                  label="Movies"
                  subtitle={`${movies.length} films`}
                  isExpanded={expandedSeason === -1}
                  onToggle={() => setExpandedSeason(expandedSeason === -1 ? null : -1)}
                  watchedCount={movies.filter(m => userStatuses?.get(m.id) === "watched").length}
                  totalCount={movies.length}
                  progressColor={movies.every(m => userStatuses?.get(m.id) === "watched") ? "bg-green-500" : movies.some(m => userStatuses?.get(m.id) === "watched") ? "bg-poison-red-bright" : "bg-silver-steel/30"}
                >
                  {movies.map(entry => (
                    <EpisodeRow
                      key={entry.id}
                      entry={entry}
                      status={getStatusForEntry(entry.id)}
                      onToggleStatus={onToggleStatus}
                      displayLabel={`MOV ${padNumber(entry.movie_number ?? 0)}`}
                    />
                  ))}
                </SeasonAccordion>
              )}

              {/* Specials section */}
              {(typeFilter === "all" || typeFilter === "special") && specials.length > 0 && (
                <SeasonAccordion
                  label="Specials & OVAs"
                  subtitle={`${specials.length} entries`}
                  isExpanded={expandedSeason === -2}
                  onToggle={() => setExpandedSeason(expandedSeason === -2 ? null : -2)}
                  watchedCount={specials.filter(s => userStatuses?.get(s.id) === "watched").length}
                  totalCount={specials.length}
                  progressColor={specials.every(s => userStatuses?.get(s.id) === "watched") ? "bg-green-500" : specials.some(s => userStatuses?.get(s.id) === "watched") ? "bg-poison-red-bright" : "bg-silver-steel/30"}
                >
                  {specials.map(entry => (
                    <EpisodeRow
                      key={entry.id}
                      entry={entry}
                      status={getStatusForEntry(entry.id)}
                      onToggleStatus={onToggleStatus}
                      displayLabel={entry.type === "ova" ? "OVA" : "SP"}
                    />
                  ))}
                </SeasonAccordion>
              )}

              {/* Episode Seasons */}
              {(typeFilter === "all" || typeFilter === "episode") && seasons.map((season, i) => (
                <SeasonAccordion
                  key={i}
                  label={season.label}
                  subtitle={`Ep ${season.startEp}–${season.endEp}`}
                  isExpanded={expandedSeason === i}
                  onToggle={() => setExpandedSeason(expandedSeason === i ? null : i)}
                  watchedCount={seasonWatchedCount(season)}
                  totalCount={season.entries.length}
                  progressColor={getStatusColor(season)}
                >
                  {season.entries.map(entry => (
                    <EpisodeRow
                      key={entry.id}
                      entry={entry}
                      status={getStatusForEntry(entry.id)}
                      onToggleStatus={onToggleStatus}
                    />
                  ))}
                </SeasonAccordion>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}

/* ──────────────────────── Season Accordion ──────────────────────── */

function SeasonAccordion({
  label,
  subtitle,
  isExpanded,
  onToggle,
  watchedCount,
  totalCount,
  progressColor,
  children,
}: {
  label: string
  subtitle?: string
  isExpanded: boolean
  onToggle: () => void
  watchedCount: number
  totalCount: number
  progressColor: string
  children: React.ReactNode
}) {
  const progress = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0
  const isComplete = watchedCount === totalCount && totalCount > 0

  return (
    <div className="border-b border-gray-200">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors group"
      >
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-display text-base uppercase tracking-wide text-gray-900">
              {label}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1 w-full bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className={cn("h-full rounded-full", progressColor)}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-xs text-gray-500">
            {watchedCount}/{totalCount}
          </span>
          <div
            className={cn(
              "h-7 w-7 rounded-full flex items-center justify-center border transition-colors",
              isComplete
                ? "bg-green-500 border-green-400 text-white"
                : "border-gray-300 text-gray-400"
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </div>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ──────────────────────── Episode Row ──────────────────────── */

function EpisodeRow({
  entry,
  status,
  onToggleStatus,
  displayLabel,
}: {
  entry: ContentEntry
  status: WatchStatus | null
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
  displayLabel?: string
}) {
  const epLabel = displayLabel ?? `EP ${padNumber(entry.episode_number ?? 0)}`
  const isWatched = status === "watched"
  const isWatching = status === "watching"

  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-3 rounded-md transition-colors hover:bg-gray-50 group",
      isWatched && "opacity-60"
    )}>
      {/* Thumbnail */}
      <div className="w-20 h-14 bg-gray-100 rounded-md flex items-center justify-center shrink-0 overflow-hidden relative">
        {entry.image_url ? (
          <img src={entry.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-display text-sm text-gray-300 uppercase">
            {epLabel}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-display text-sm uppercase tracking-wide text-gray-900">
          {epLabel}{" "}
          <span className="text-gray-500">({entry.title})</span>
        </p>
        {entry.synopsis && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
            {entry.synopsis}
          </p>
        )}
      </div>

      {/* Status toggle */}
      {onToggleStatus && (
        <button
          onClick={() => onToggleStatus(entry.id, status)}
          className={cn(
            "shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-all border",
            isWatched
              ? "bg-green-500 border-green-400 text-white"
              : isWatching
                ? "bg-gray-900/10 border-gray-900 text-gray-900"
                : "bg-transparent border-gray-300 text-gray-400 hover:border-gray-900 hover:text-gray-900"
          )}
          title={isWatched ? "Watched" : isWatching ? "Watching" : "Mark as watching"}
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
