"use client"

import { useState, useMemo, useRef } from "react"
import Link from "next/link"
import { Trophy, Medal, Crown, Search, Clock, Film, Tv, UserCheck, ChevronDown } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { avatarUrl } from "@/lib/constants"
import { getDetectiveRank } from "@/lib/ranks"
import type { RankingRow } from "@/lib/queries/leaderboard"

function formatHours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

type Timeframe = "all" | "month" | "week"
type Category = "episodes" | "movies" | "hours"

/**
 * Rolling windows, not calendar periods. "Last 30 Days" rather than "This Month"
 * because a calendar month leaves the board near-empty every 1st, and because a
 * rolling cutoff has no timezone boundary to get wrong. The labels say exactly
 * what lib/leaderboard-periods.ts computes.
 */
const TIMEFRAME_TABS: { value: Timeframe; label: string; short: string }[] = [
  { value: "all", label: "All-Time", short: "All-Time" },
  { value: "month", label: "Last 30 Days", short: "30 Days" },
  { value: "week", label: "Last 7 Days", short: "7 Days" },
]

/**
 * A ranking row with the three metrics for the SELECTED timeframe resolved onto
 * stat_* fields.
 *
 * The all-time fields are left intact rather than overwritten, because the
 * detective rank badge is a career title and must read watched_count on every
 * tab. This replaced the old approach of multiplying watched_count by 0.28/0.08.
 */
type DisplayRow = RankingRow & {
  stat_count: number
  stat_minutes: number
  stat_movies: number
}

function project(row: RankingRow, timeframe: Timeframe): DisplayRow {
  if (timeframe === "week") {
    return {
      ...row,
      stat_count: row.week_count,
      stat_minutes: row.week_minutes,
      stat_movies: row.week_movie_count,
    }
  }
  if (timeframe === "month") {
    return {
      ...row,
      stat_count: row.month_count,
      stat_minutes: row.month_minutes,
      stat_movies: row.month_movie_count,
    }
  }
  return {
    ...row,
    stat_count: row.watched_count,
    stat_minutes: row.total_minutes,
    stat_movies: row.movie_count,
  }
}

function statFor(row: DisplayRow, category: Category): number {
  if (category === "hours") return row.stat_minutes
  if (category === "movies") return row.stat_movies
  return row.stat_count
}

function RankBadge({ watchedCount }: { watchedCount: number }) {
  const rank = getDetectiveRank(watchedCount)
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium ${rank.badgeColor}`}>
      {rank.title}
    </span>
  )
}

const podiumStyles: Record<
  number,
  { border: string; medal: string; label: string; short: string }
> = {
  1: {
    border: "border-gold-seal/50 bg-gradient-to-b from-gold-seal/15 via-gold-seal/5 to-surface shadow-md",
    medal: "text-gold-seal",
    label: "1st Place",
    short: "1st",
  },
  2: {
    border: "border-ink-dim/25 bg-surface shadow-card",
    medal: "text-ink-dim",
    label: "2nd Place",
    short: "2nd",
  },
  3: {
    border: "border-amber-700/30 bg-surface shadow-card",
    medal: "text-amber-600",
    label: "3rd Place",
    short: "3rd",
  },
}

function PodiumCard({
  row,
  featured,
  category,
}: {
  row: DisplayRow
  featured?: boolean
  category: Category
}) {
  const style = podiumStyles[row.rank] ?? podiumStyles[3]

  const displayStat = useMemo(() => {
    if (category === "hours") {
      return { val: formatHours(row.stat_minutes), label: "watch time" }
    }
    if (category === "movies") {
      // Real count of type='movie' entries. Was previously estimated as
      // watched_count / 15, which had no relationship to what anyone watched.
      return {
        val: `${row.stat_movies}`,
        label: row.stat_movies === 1 ? "movie solved" : "movies solved",
      }
    }
    return { val: `${row.stat_count}`, label: "episodes" }
  }, [category, row])

  return (
    <div
      className={`flex h-full flex-col items-center rounded-2xl border text-center transition-all hover:shadow-lg ${
        featured ? "p-2.5 sm:p-5 -mt-1 sm:-mt-2" : "p-2 sm:p-4"
      } ${style.border}`}
    >
      <div className="mb-1.5 flex max-w-full items-center gap-1 sm:gap-1.5">
        {row.rank === 1 ? (
          <Crown className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${style.medal}`} />
        ) : (
          <Medal className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${style.medal}`} />
        )}
        <span className="font-mono text-[10px] font-bold text-ink-dim sm:text-xs">
          <span className="sm:hidden">{style.short}</span>
          <span className="hidden sm:inline">{style.label}</span>
        </span>
      </div>

      <Avatar
        className={`${
          featured
            ? "h-12 w-12 sm:h-16 sm:w-16 ring-2 ring-gold-seal/60 shadow-md"
            : "h-10 w-10 sm:h-14 sm:w-14 ring-1 ring-ink-dim/30 shadow-xs"
        } shrink-0`}
      >
        <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
        <AvatarFallback className="bg-accent font-display text-xs text-white font-bold">
          {row.display_name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <Link
        href={`/profile/${row.username}`}
        title={row.display_name}
        className="mt-1.5 block w-full truncate font-display text-[11px] sm:text-base font-bold tracking-tight text-ink hover:text-accent"
      >
        {row.display_name}
      </Link>
      <p className="hidden w-full truncate font-mono text-xs text-ink-faint sm:block">
        @{row.username}
      </p>

      <div className="mt-1.5 hidden sm:block">
        <RankBadge watchedCount={row.watched_count} />
      </div>

      <div className="mt-auto w-full pt-1.5 sm:pt-3">
        <p
          className={`w-full truncate font-display font-bold tabular-nums text-ink ${
            category === "hours"
              ? "text-xs sm:text-xl"
              : featured
              ? "text-base sm:text-2xl text-accent-bright"
              : "text-sm sm:text-xl"
          }`}
        >
          {displayStat.val}
        </p>
        <p className="w-full truncate font-mono text-[8px] sm:text-[11px] uppercase tracking-wide text-ink-dim">
          {displayStat.label}
        </p>
        <p className="mt-1.5 hidden font-mono text-[10px] text-ink-faint sm:block">
          {row.rewatched_count} rewatched · {row.total_views} views
        </p>
      </div>
    </div>
  )
}

export function RankingsBoard({
  rankings,
  currentUserId,
  you,
}: {
  rankings: RankingRow[]
  currentUserId?: string | null
  you?: RankingRow | null
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("all")
  const [category, setCategory] = useState<Category>("episodes")
  const [searchQuery, setSearchQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(25)

  const youRowRef = useRef<HTMLDivElement>(null)

  // Resolves the selected timeframe's real figures onto stat_* and sorts by the
  // selected category. The previous version multiplied all-time numbers by
  // invented fractions (0.28 / 0.08) — that block is gone.
  const processedRankings = useMemo(() => {
    const list = rankings.map((row) => project(row, timeframe))

    list.sort((a, b) => {
      if (category === "hours") {
        return b.stat_minutes - a.stat_minutes || b.stat_count - a.stat_count
      }
      if (category === "movies") {
        return b.stat_movies - a.stat_movies || b.stat_minutes - a.stat_minutes
      }
      return b.stat_count - a.stat_count || b.stat_minutes - a.stat_minutes
    })

    return list.map((r, idx) => ({ ...r, rank: idx + 1 }))
  }, [rankings, category, timeframe])

  // A period with no logged activity must say so rather than show a board of
  // zeros. watch_events only accrues from the migration onward.
  const hasPeriodActivity = useMemo(
    () =>
      timeframe === "all" ||
      processedRankings.some((r) => r.stat_count > 0 || r.stat_minutes > 0),
    [timeframe, processedRankings]
  )

  // Filter by search query
  const filteredRankings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return processedRankings
    return processedRankings.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q)
    )
  }, [processedRankings, searchQuery])

  if (rankings.length === 0) {
    return (
      <div className="rounded-2xl border border-ink-dim/20 bg-surface p-8 sm:p-12 text-center shadow-card">
        <Trophy className="mx-auto h-7 w-7 text-ink-faint" />
        <p className="mt-3 font-display text-sm font-semibold text-ink-dim">
          No rankings yet
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Start watching episodes to appear on the leaderboard.
        </p>
      </div>
    )
  }

  const top3 = processedRankings.slice(0, 3)
  // Scale the bars to the leader in the CURRENT category and timeframe, not to
  // all-time episodes — otherwise every bar collapses to 4% on the Movies tab.
  const topStat = Math.max(1, statFor(processedRankings[0], category) || 0)
  const podium = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3

  const scrollToYou = () => {
    youRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Clean Control & Filter Bar */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-ink-dim/20 bg-surface p-2.5 sm:p-3.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        {/* Timeframe Selector */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 w-full sm:w-auto">
          {TIMEFRAME_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setTimeframe(tab.value)
                setVisibleCount(25)
              }}
              className={`rounded-lg px-2 sm:px-3 py-1.5 font-mono text-[11px] sm:text-xs font-medium text-center transition-all ${
                timeframe === tab.value
                  ? "bg-surface text-ink shadow-2xs font-bold"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Category Toggles */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setCategory("episodes")}
            className={`flex items-center justify-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 font-mono text-[11px] sm:text-xs font-medium transition-all ${
              category === "episodes"
                ? "bg-surface text-accent shadow-2xs font-bold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Tv className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
            <span className="truncate">Episodes</span>
          </button>
          <button
            type="button"
            onClick={() => setCategory("movies")}
            className={`flex items-center justify-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 font-mono text-[11px] sm:text-xs font-medium transition-all ${
              category === "movies"
                ? "bg-surface text-accent shadow-2xs font-bold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Film className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
            <span className="truncate">Movies</span>
          </button>
          <button
            type="button"
            onClick={() => setCategory("hours")}
            className={`flex items-center justify-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 font-mono text-[11px] sm:text-xs font-medium transition-all ${
              category === "hours"
                ? "bg-surface text-accent shadow-2xs font-bold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
            <span className="truncate">Watch Time</span>
          </button>
        </div>
      </div>

      {/* Search Input & Jump to My Rank */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setVisibleCount(25)
            }}
            placeholder="Search detective username..."
            className="w-full rounded-xl border border-ink-dim/20 bg-surface pl-9 pr-4 py-2 text-xs text-ink outline-none transition-all placeholder:text-ink-faint focus:border-ink-dim/40 h-9"
          />
        </div>

        {you && (
          <Button
            variant="outline"
            size="sm"
            onClick={scrollToYou}
            className="w-full sm:w-auto justify-center gap-2 rounded-xl border-ink-dim/20 text-xs font-display text-ink-dim hover:text-ink h-9"
          >
            <UserCheck className="h-3.5 w-3.5 text-accent" />
            Jump to My Rank (#{you.rank > 0 ? you.rank : "N/A"})
          </Button>
        )}
      </div>

      {/* Top Podium — adaptively grids 1, 2, or 3 top ranks */}
      {!searchQuery && hasPeriodActivity && top3.length > 0 && (
        <div
          className={`grid items-end gap-2 pt-1 sm:gap-5 ${
            top3.length === 3
              ? "grid-cols-3"
              : top3.length === 2
              ? "grid-cols-2 max-w-sm mx-auto"
              : "grid-cols-1 max-w-xs mx-auto"
          }`}
        >
          {podium.map((row) => (
            <PodiumCard key={row.user_id} row={row} featured={row.rank === 1} category={category} />
          ))}
        </div>
      )}

      {/* Full Leaderboard List */}
      <div className="overflow-hidden rounded-2xl border border-ink-dim/20 bg-surface shadow-card">
        <div className="divide-y divide-ink-dim/10">
          {!hasPeriodActivity ? (
            <div className="p-8 sm:p-12 text-center">
              <Clock className="mx-auto h-7 w-7 text-ink-faint" />
              <p className="mt-3 font-display text-sm font-semibold text-ink-dim">
                No activity in the {timeframe === "week" ? "last 7 days" : "last 30 days"}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Period rankings are built from watch activity as it happens. Mark something
                watched and it will show up here.
              </p>
            </div>
          ) : (
            filteredRankings.slice(0, visibleCount).map((row) => {
            const isYou = row.user_id === currentUserId
            const pct = Math.max(4, Math.round((statFor(row, category) / topStat) * 100))

            return (
              <div
                key={row.user_id}
                ref={isYou ? youRowRef : undefined}
                className={`flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 transition-colors ${
                  isYou ? "bg-accent/5 ring-1 ring-inset ring-accent/20" : "hover:bg-surface-muted/40"
                }`}
              >
                <span
                  className={`w-6 sm:w-7 shrink-0 text-center font-mono text-xs font-bold ${
                    row.rank === 1
                      ? "text-gold-seal"
                      : row.rank === 2
                      ? "text-ink-dim"
                      : row.rank === 3
                      ? "text-amber-600"
                      : "text-ink-faint font-medium"
                  }`}
                >
                  #{row.rank}
                </span>

                <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 border border-ink-dim/20">
                  <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
                  <AvatarFallback className="bg-accent text-xs font-display text-white font-bold">
                    {row.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`/profile/${row.username}`}
                      className="truncate font-display text-xs sm:text-sm font-semibold tracking-tight text-ink hover:text-accent"
                    >
                      {row.display_name}
                    </Link>
                    {isYou && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent">
                        You
                      </span>
                    )}
                    <span className="hidden sm:inline-block">
                      <RankBadge watchedCount={row.watched_count} />
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="shrink-0 text-right pl-1">
                  <p className="font-mono text-xs sm:text-sm font-bold text-ink tabular-nums">
                    {category === "hours"
                      ? formatHours(row.stat_minutes)
                      : category === "movies"
                        ? row.stat_movies
                        : row.stat_count}
                  </p>
                  <p className="font-mono text-[9px] sm:text-[10px] uppercase text-ink-faint">
                    {category === "hours" ? "time" : category === "movies" ? "movies" : "eps"}
                  </p>
                </div>
              </div>
            )
          })
          )}
        </div>
      </div>

      {/* Show more pagination */}
      {hasPeriodActivity && filteredRankings.length > visibleCount && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setVisibleCount((c) => Math.min(c + 25, filteredRankings.length))
            }
            className="w-full sm:w-auto justify-center gap-2 rounded-xl border-ink-dim/20 text-xs font-display text-ink-dim hover:text-ink h-9"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}
