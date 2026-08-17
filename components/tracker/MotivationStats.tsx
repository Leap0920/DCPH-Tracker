"use client"

import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  BookOpen,
  Film,
  Play,
  Video,
  Clapperboard,
  Sparkles,
  CircleDot,
  Coffee,
  Flame,
  CalendarClock,
  Target,
  Swords,
} from "lucide-react"
import type { Database } from "@/types/database.types"
import type { WatchStatus } from "@/lib/constants"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { formatHours } from "@/lib/utils"
import { isOtherMovie, MAINLINE_MOVIES } from "@/lib/movies-guide"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface MotivationStatsProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
  userName?: string | null
}

const DEFAULT_RATE_PER_DAY = 3

const TYPE_ICONS: Record<ContentType, React.ComponentType<{ className?: string }>> = {
  episode: BookOpen,
  movie: Film,
  special: Play,
  ova: Video,
  live_action: Clapperboard,
  magic_kaito: Sparkles,
  hanzawa: CircleDot,
  zero_tea_time: Coffee,
  yaiba: Swords,
}

export function getDefaultRuntime(type: string): number {
  return type === "movie" ? 100 : type === "special" || type === "ova" ? 45 : 25
}

export interface SeriesTotals {
  episodes: number
  movies: number
  total: number
  totalMinutes: number
  years: number
}

export function computeSeriesTotals(entries: ContentEntry[]): SeriesTotals {
  // Non-mainline movies (crossovers, TV specials, manner short) exist in the
  // catalog but don't count toward the 29 mainline films.
  const mainlineEntries = entries.filter((e) => !(e.type === "movie" && isOtherMovie(e.slug)))
  const episodes = mainlineEntries.filter((e) => e.type === "episode").length
  // 29 canonical mainline films: 27 rows in the DB + 2 upcoming films
  // (One-eyed Flashback 2025, Fallen Angel of the Highway 2026).
  const movies = MAINLINE_MOVIES.length
  const mainlineMovieCount = mainlineEntries.filter((e) => e.type === "movie").length
  const total = mainlineEntries.length - mainlineMovieCount + MAINLINE_MOVIES.length
  const totalMinutes = mainlineEntries.reduce(
    (acc, e) => acc + (e.runtime_minutes ?? getDefaultRuntime(e.type)),
    0
  )
  const years = new Set(
    mainlineEntries.map((e) => e.air_date?.slice(0, 4)).filter((y): y is string => Boolean(y))
  ).size
  return { episodes, movies, total, totalMinutes, years }
}

export interface PerTypeStat {
  type: ContentType
  label: string
  watched: number
  total: number
}

export interface PersonalStats {
  watched: number
  percent: number
  remaining: number
  minutesWatched: number
  perType: PerTypeStat[]
}

export function computePersonalStats(
  entries: ContentEntry[],
  userStatuses?: Map<string, WatchStatus>
): PersonalStats {
  const isWatched = (e: ContentEntry) => {
    const s = userStatuses?.get(e.id)
    return s === "watched" || s === "rewatched"
  }
  const mainlineEntries = entries.filter((e) => !(e.type === "movie" && isOtherMovie(e.slug)))
  const mainlineMovieCount = mainlineEntries.filter((e) => e.type === "movie").length
  // Canonical total: 1337 = 1209 episodes + 29 mainline films + 99 other entries.
  const adjustedTotal = mainlineEntries.length - mainlineMovieCount + MAINLINE_MOVIES.length
  const watched = entries.filter(isWatched).length
  const percent = adjustedTotal > 0 ? Math.round((watched / adjustedTotal) * 100) : 0
  const minutesWatched = entries
    .filter(isWatched)
    .reduce((acc, e) => acc + (e.runtime_minutes ?? getDefaultRuntime(e.type)), 0)
  const perType = (Object.keys(CONTENT_TYPE_LABELS) as ContentType[])
    .map((type) => {
      // Mainline movies are the canonical 29 (incl. 2 upcoming films with no
      // DB row); non-mainline movies (crossovers/specials) are excluded.
      const list =
        type === "movie"
          ? entries.filter((e) => e.type === "movie" && !isOtherMovie(e.slug))
          : entries.filter((e) => e.type === type)
      const total = type === "movie" ? MAINLINE_MOVIES.length : list.length
      return {
        type,
        label: CONTENT_TYPE_LABELS[type],
        watched: list.filter(isWatched).length,
        total,
      }
    })
    .filter((s) => s.total > 0)
  return { watched, percent, remaining: adjustedTotal - watched, minutesWatched, perType }
}

/** Finish date assuming `ratePerDay` episodes per day. Null when nothing left to watch. */
export function computeProjection(remainingEpisodes: number, ratePerDay = DEFAULT_RATE_PER_DAY): Date | null {
  if (remainingEpisodes <= 0 || ratePerDay <= 0) return null
  const days = Math.ceil(remainingEpisodes / ratePerDay)
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function MotivationStats({ entries, userStatuses, userName }: MotivationStatsProps) {
  const series = useMemo(() => computeSeriesTotals(entries), [entries])
  const personal = useMemo(() => computePersonalStats(entries, userStatuses), [entries, userStatuses])
  const hasUser = typeof userName === "string" && userName.length > 0

  // User-adjustable eps-per-day rate for the finish projection, persisted client-side.
  const [ratePerDay, setRatePerDay] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_RATE_PER_DAY
    const saved = Number(window.localStorage.getItem("dcph-eps-per-day"))
    return Number.isFinite(saved) && saved >= 1 && saved <= 50 ? saved : DEFAULT_RATE_PER_DAY
  })

  const handleRateChange = (raw: string) => {
    const value = Number(raw)
    if (raw === "") {
      setRatePerDay(DEFAULT_RATE_PER_DAY)
      return
    }
    if (!Number.isFinite(value)) return
    const clamped = Math.min(50, Math.max(1, value))
    setRatePerDay(clamped)
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dcph-eps-per-day", String(clamped))
    }
  }

  // "At N eps/day you'll finish by {date}"
  const finishDate = useMemo(() => {
    const isWatched = (e: ContentEntry) => {
      const s = userStatuses?.get(e.id)
      return s === "watched" || s === "rewatched"
    }
    const remainingEpisodes = Math.max(
      0,
      series.episodes - entries.filter((e) => isWatched(e) && e.type === "episode").length
    )
    return computeProjection(remainingEpisodes, ratePerDay)
  }, [series.episodes, entries, userStatuses, ratePerDay])

  // Next milestone callout: first of 25/50/75/100 above the current %
  const nextMilestone = [25, 50, 75, 100].find((m) => personal.percent < m) ?? null
  const toMilestone = nextMilestone !== null ? nextMilestone - personal.percent : 0

  const seriesTiles = [
    { label: "Episodes", value: series.episodes.toLocaleString(), icon: BookOpen },
    { label: "Movies", value: series.movies.toLocaleString(), icon: Film },
    { label: "Total", value: series.total.toLocaleString(), icon: Target },
    { label: "Runtime", value: formatHours(series.totalMinutes), icon: Flame },
    { label: "Years", value: String(series.years), icon: CalendarClock },
  ]

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* ── Series Totals (static) ── */}
      <div className="bg-surface border border-slate-200 rounded-lg p-6 shadow-card md:col-span-1">
        <h3 className="font-display text-sm tracking-tight text-ink mb-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Series Totals
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {seriesTiles.map((tile, i) => (
            <motion.div
              key={tile.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1 + i * 0.08 }}
              className="text-center p-3 bg-surface-muted rounded-lg"
            >
              <tile.icon className="h-4 w-4 text-accent mx-auto mb-1" />
              <div className="font-display text-lg text-ink leading-tight">{tile.value}</div>
              <div className="font-mono text-[9px] text-ink-faint">
                {tile.label}
              </div>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-ink-dim leading-relaxed">
          Every case file in the tracker. The truth is out there, one episode at a time.
        </p>
      </div>

      {/* ── Personal Progress ── */}
      <div className="bg-surface border border-slate-200 rounded-lg p-6 shadow-card md:col-span-1">
        <h3 className="font-display text-sm tracking-tight text-ink mb-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Your Progress
        </h3>
        {!hasUser ? (
          <div className="py-8 text-center">
            <p className="font-display text-sm text-ink-faint mb-1">
              Sign in to track
            </p>
            <p className="text-xs text-ink-dim">
              Your watched list, minutes, and finish date will show up here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-4">
              <div className="font-display text-4xl text-ink">{personal.percent}%</div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-ink-dim">
                  <span>{personal.watched} watched</span>
                  <span>{personal.remaining} remaining</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-accent rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${personal.percent}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <div className="font-mono text-[10px] text-ink-dim">
                  {formatHours(personal.minutesWatched)} spent
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {personal.perType.map((stat, i) => {
                const Icon = TYPE_ICONS[stat.type]
                return (
                  <div key={stat.type} className="flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5 text-ink-faint flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] text-ink-dim">{stat.label}</span>
                        <span className="font-mono text-[10px] text-ink-dim">
                          {stat.watched}/{stat.total}
                        </span>
                      </div>
                      <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gray-900 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${stat.total > 0 ? (stat.watched / stat.total) * 100 : 0}%` }}
                          transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 + i * 0.06 }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Finish Projection ── */}
      <div className="bg-surface border border-slate-200 rounded-lg p-6 shadow-card md:col-span-1">
        <h3 className="font-display text-sm tracking-tight text-ink mb-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Finish Line
        </h3>
        {!hasUser ? (
          <div className="py-8 text-center">
            <CalendarClock className="h-8 w-8 text-ink-faint mx-auto mb-2" />
            <p className="font-display text-sm text-ink-faint mb-1">
              No projection yet
            </p>
            <p className="text-xs text-ink-dim">
              Sign in and start watching to see your estimated completion date.
            </p>
          </div>
        ) : finishDate ? (
          <>
            <div className="text-center py-3">
              <div className="flex items-center justify-center gap-1.5 mb-1.5">
                <label
                  htmlFor="finish-rate"
                  className="font-mono text-[10px] text-ink-faint"
                >
                  At
                </label>
                <input
                  id="finish-rate"
                  type="number"
                  min={1}
                  max={50}
                  value={ratePerDay}
                  onChange={(e) => handleRateChange(e.target.value)}
                  className="w-14 h-7 rounded-md border border-slate-200 bg-surface-muted px-2 text-center text-xs text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
                <label
                  htmlFor="finish-rate"
                  className="font-mono text-[10px] text-ink-faint"
                >
                  eps/day you&apos;ll finish by
                </label>
              </div>
              <p className="font-display text-2xl text-ink">{formatDate(finishDate)}</p>
            </div>
            {nextMilestone !== null && (
              <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3 flex items-center gap-3">
                <Target className="h-4 w-4 text-accent flex-shrink-0" />
                <p className="text-xs text-ink-dim">
                  {toMilestone > 0
                    ? `${toMilestone}% to your next milestone. ${nextMilestone}% complete. Keep going!`
                    : `You hit the ${nextMilestone}% milestone. Nice work!`}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="font-display text-sm text-ink mb-1">
              All caught up!
            </p>
            <p className="text-xs text-ink-dim">
              You&apos;ve watched every episode in the tracker. Now wait for the next case...
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
