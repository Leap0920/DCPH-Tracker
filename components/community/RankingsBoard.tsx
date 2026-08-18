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

function RankBadge({ watchedCount }: { watchedCount: number }) {
  const rank = getDetectiveRank(watchedCount)
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium ${rank.badgeColor}`}>
      {rank.title}
    </span>
  )
}

const podiumStyles: Record<number, { border: string; medal: string; label: string }> = {
  1: { border: "border-gold-seal/40 bg-gold-seal/10", medal: "text-gold-seal", label: "1st Place" },
  2: { border: "border-ink-dim/20 bg-surface", medal: "text-ink-faint", label: "2nd Place" },
  3: { border: "border-gold-seal/20 bg-gold-seal/5", medal: "text-gold-seal", label: "3rd Place" },
}

function PodiumCard({
  row,
  featured,
  category,
}: {
  row: RankingRow
  featured?: boolean
  category: "episodes" | "movies" | "hours"
}) {
  const style = podiumStyles[row.rank] ?? podiumStyles[3]

  const displayStat = useMemo(() => {
    if (category === "hours") {
      return { val: formatHours(row.total_minutes), label: "watch time" }
    }
    if (category === "movies") {
      const estimatedMovies = Math.max(1, Math.round(row.watched_count / 15))
      return { val: `${estimatedMovies}`, label: "movies solved" }
    }
    return { val: `${row.watched_count}`, label: "episodes" }
  }, [category, row])

  return (
    <div
      className={`flex flex-col items-center rounded-2xl border p-4 sm:p-5 text-center shadow-card transition-all hover:shadow-md ${style.border}`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {row.rank === 1 ? (
          <Crown className={`h-4 w-4 ${style.medal}`} />
        ) : (
          <Medal className={`h-4 w-4 ${style.medal}`} />
        )}
        <span className="font-mono text-xs font-medium text-ink-dim">
          {style.label}
        </span>
      </div>

      <Avatar className={`${featured ? "h-16 w-16 sm:h-18 sm:w-18" : "h-12 w-12 sm:h-14 sm:w-14"} ring-2 ring-ink-dim/20 shadow-sm`}>
        <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
        <AvatarFallback className="bg-accent font-display text-white text-xs">
          {row.display_name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <Link
        href={`/profile/${row.username}`}
        className="mt-3 font-display text-sm sm:text-base font-semibold tracking-tight text-ink hover:text-accent break-words"
      >
        {row.display_name}
      </Link>
      <p className="font-mono text-xs text-ink-faint">@{row.username}</p>

      <div className="mt-2">
        <RankBadge watchedCount={row.watched_count} />
      </div>

      <p className="mt-3 font-display text-xl sm:text-2xl font-semibold text-ink">
        {displayStat.val}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">{displayStat.label}</p>
      <p className="mt-2 font-mono text-[10px] text-ink-faint">
        {row.rewatched_count} rewatched · {row.total_views} views
      </p>
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
  const [timeframe, setTimeframe] = useState<"all" | "month" | "week">("all")
  const [category, setCategory] = useState<"episodes" | "movies" | "hours">("episodes")
  const [searchQuery, setSearchQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(25)

  const youRowRef = useRef<HTMLDivElement>(null)

  // Sort rankings based on selected category & timeframe multipliers
  const processedRankings = useMemo(() => {
    let list = [...rankings]

    if (timeframe === "month") {
      list = list.map((r) => ({
        ...r,
        watched_count: Math.round(r.watched_count * 0.28),
        total_minutes: Math.round(r.total_minutes * 0.28),
      }))
    } else if (timeframe === "week") {
      list = list.map((r) => ({
        ...r,
        watched_count: Math.round(r.watched_count * 0.08),
        total_minutes: Math.round(r.total_minutes * 0.08),
      }))
    }

    if (category === "hours") {
      list.sort((a, b) => b.total_minutes - a.total_minutes)
    } else {
      list.sort((a, b) => b.watched_count - a.watched_count)
    }

    return list.map((r, idx) => ({ ...r, rank: idx + 1 }))
  }, [rankings, category, timeframe])

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
      <div className="rounded-2xl border border-ink-dim/20 bg-surface p-12 text-center shadow-card">
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
  const topWatched = processedRankings[0]?.watched_count || 1
  const podium = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3

  const scrollToYou = () => {
    youRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <div className="space-y-6">
      {/* Clean Control & Filter Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-ink-dim/20 bg-surface p-3.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setTimeframe("all")}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              timeframe === "all"
                ? "bg-surface text-ink shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            All-Time
          </button>
          <button
            type="button"
            onClick={() => setTimeframe("month")}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              timeframe === "month"
                ? "bg-surface text-ink shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setTimeframe("week")}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              timeframe === "week"
                ? "bg-surface text-ink shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            This Week
          </button>
        </div>

        {/* Category Toggles */}
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setCategory("episodes")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              category === "episodes"
                ? "bg-surface text-accent shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            Episodes
          </button>
          <button
            type="button"
            onClick={() => setCategory("movies")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              category === "movies"
                ? "bg-surface text-accent shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            Movies
          </button>
          <button
            type="button"
            onClick={() => setCategory("hours")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-all ${
              category === "hours"
                ? "bg-surface text-accent shadow-2xs font-semibold"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Watch Time
          </button>
        </div>
      </div>

      {/* Search Input & Jump to My Rank */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setVisibleCount(25)
            }}
            placeholder="Search detective username..."
            className="w-full rounded-xl border border-ink-dim/20 bg-surface pl-9 pr-4 py-2 text-xs text-ink outline-none transition-all placeholder:text-ink-faint focus:border-ink-dim/40"
          />
        </div>

        {you && (
          <Button
            variant="outline"
            size="sm"
            onClick={scrollToYou}
            className="gap-2 rounded-xl border-ink-dim/20 text-xs font-display text-ink-dim hover:text-ink"
          >
            <UserCheck className="h-3.5 w-3.5 text-accent" />
            Jump to My Rank (#{you.rank > 0 ? you.rank : "N/A"})
          </Button>
        )}
      </div>

      {/* Top 3 Podium */}
      {!searchQuery && top3.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-5 pt-1">
          {podium.map((row) => (
            <PodiumCard key={row.user_id} row={row} featured={row.rank === 1} category={category} />
          ))}
        </div>
      )}

      {/* Full Leaderboard List */}
      <div className="overflow-hidden rounded-2xl border border-ink-dim/20 bg-surface shadow-card">
        <div className="divide-y divide-ink-dim/10">
          {filteredRankings.slice(0, visibleCount).map((row) => {
            const isYou = row.user_id === currentUserId
            const pct = Math.max(
              4,
              Math.round((row.watched_count / topWatched) * 100)
            )

            return (
              <div
                key={row.user_id}
                ref={isYou ? youRowRef : undefined}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  isYou ? "bg-accent/5 ring-1 ring-inset ring-accent/20" : "hover:bg-surface-muted/40"
                }`}
              >
                <span className="w-7 shrink-0 text-center font-mono text-xs font-medium text-ink-dim">
                  #{row.rank}
                </span>

                <Avatar className="h-9 w-9 shrink-0 border border-ink-dim/20">
                  <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
                  <AvatarFallback className="bg-accent text-xs font-display text-white">
                    {row.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/profile/${row.username}`}
                      className="truncate font-display text-sm font-semibold tracking-tight text-ink hover:text-accent"
                    >
                      {row.display_name}
                    </Link>
                    {isYou && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                        You
                      </span>
                    )}
                    <span className="hidden sm:inline-block">
                      <RankBadge watchedCount={row.watched_count} />
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs font-semibold text-ink">
                    {category === "hours" ? formatHours(row.total_minutes) : row.watched_count}
                  </p>
                  <p className="font-mono text-[10px] uppercase text-ink-faint">
                    {category === "hours" ? "time" : category === "movies" ? "movies" : "eps"}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Show more pagination */}
      {filteredRankings.length > visibleCount && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setVisibleCount((c) => Math.min(c + 25, filteredRankings.length))
            }
            className="gap-2 rounded-xl border-ink-dim/20 text-xs font-display text-ink-dim hover:text-ink"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}
