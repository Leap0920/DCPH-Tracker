"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { Eye, EyeOff, Clock, BookOpen, Play, Film } from "lucide-react"
import type { Database } from "@/types/database.types"
import type { WatchStatus } from "@/lib/constants"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ProgressIndicatorProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
}

function getDefaultRuntime(type: string): number {
  return type === "movie" ? 100 : type === "special" || type === "ova" ? 45 : 25
}

export function ProgressIndicator({ entries, userStatuses }: ProgressIndicatorProps) {
  const { episodes, movies, specials, watchedEpisodes, watchedMovies, watchedSpecials, totalEntries, totalWatched, progressPercent, minutesWatched } = useMemo(() => {
    const episodes = entries.filter(e => e.type === "episode")
    const movies = entries.filter(e => e.type === "movie")
    const specials = entries.filter(e => e.type === "special" || e.type === "ova")

    const isWatched = (e: ContentEntry) => {
      const s = userStatuses?.get(e.id)
      return s === "watched" || s === "rewatched"
    }

    const watchedEpisodes = episodes.filter(isWatched).length
    const watchedMovies = movies.filter(isWatched).length
    const watchedSpecials = specials.filter(isWatched).length

    const totalWatched = watchedEpisodes + watchedMovies + watchedSpecials
    const totalEntries = entries.length
    const progressPercent = totalEntries > 0 ? Math.round((totalWatched / totalEntries) * 100) : 0

    const minutesWatched = entries
      .filter(isWatched)
      .reduce((acc, e) => acc + (e.runtime_minutes ?? getDefaultRuntime(e.type)), 0)

    return { episodes, movies, specials, watchedEpisodes, watchedMovies, watchedSpecials, totalEntries, totalWatched, progressPercent, minutesWatched }
  }, [entries, userStatuses])
  const hoursWatched = Math.floor(minutesWatched / 60)
  const remainingMinutes = minutesWatched % 60

  // Circular progress calculation
  const circumference = 2 * Math.PI * 54 // radius = 54
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference

  const stats = [
    { label: "Episodes", watched: watchedEpisodes, total: episodes.length, icon: BookOpen },
    { label: "Movies", watched: watchedMovies, total: movies.length, icon: Film },
    { label: "Specials", watched: watchedSpecials, total: specials.length, icon: Play },
  ]

  return (
    <div className="bg-surface border border-slate-200 rounded-lg p-6 shadow-card">
      <div className="flex flex-col sm:flex-row items-center gap-8">
        {/* Circular Progress Ring */}
        <div className="relative flex-shrink-0">
          <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
            {/* Background circle */}
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <motion.circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#111827"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className="font-display text-3xl text-ink font-bold"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              {progressPercent}%
            </motion.span>
            <span className="font-mono text-[10px] text-ink-faint">
              Complete
            </span>
          </div>
        </div>

        {/* Stats Section */}
        <div className="flex-1 w-full">
          <h3 className="font-display text-sm tracking-tight text-ink mb-4">
            Your Progress
          </h3>

          {/* Main stats row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-3 bg-surface-muted rounded-lg">
              <Eye className="h-4 w-4 text-ink mx-auto mb-1" />
              <div className="font-display text-xl text-ink">{totalWatched}</div>
              <div className="font-mono text-[10px] text-ink-faint">Watched</div>
            </div>
            <div className="text-center p-3 bg-surface-muted rounded-lg">
              <EyeOff className="h-4 w-4 text-ink-faint mx-auto mb-1" />
              <div className="font-display text-xl text-ink">{totalEntries - totalWatched}</div>
              <div className="font-mono text-[10px] text-ink-faint">Remaining</div>
            </div>
            <div className="text-center p-3 bg-surface-muted rounded-lg">
              <Clock className="h-4 w-4 text-ink mx-auto mb-1" />
              <div className="font-display text-base sm:text-xl text-ink whitespace-nowrap">
                {hoursWatched > 0
                  ? `${hoursWatched}h${remainingMinutes > 0 ? ` ${remainingMinutes}m` : ""}`
                  : `${remainingMinutes}m`}
              </div>
              <div className="font-mono text-[10px] text-ink-faint">Time Spent</div>
            </div>
          </div>

          {/* Breakdown by type */}
          <div className="space-y-3">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <stat.icon className="h-4 w-4 text-ink-faint flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ink-dim">{stat.label}</span>
                    <span className="font-mono text-[10px] text-ink-dim">
                      {stat.watched}/{stat.total}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gray-900 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${stat.total > 0 ? (stat.watched / stat.total) * 100 : 0}%` }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 + i * 0.1 }}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

