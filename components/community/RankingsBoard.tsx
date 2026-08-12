import Link from "next/link"
import { Trophy, Medal, Crown } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl } from "@/lib/constants"
import type { RankingRow } from "@/lib/queries/leaderboard"

function formatHours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function RankBadge({ title }: { title: string }) {
  return (
    <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
      {title}
    </span>
  )
}

const podiumStyles: Record<number, { ring: string; medal: string; label: string }> = {
  1: { ring: "ring-[#9C7A2E]", medal: "text-[#9C7A2E]", label: "1st" },
  2: { ring: "ring-slate-300", medal: "text-ink-faint", label: "2nd" },
  3: { ring: "ring-[#b08d57]", medal: "text-[#b08d57]", label: "3rd" },
}

function PodiumCard({
  row,
  featured,
}: {
  row: RankingRow
  featured?: boolean
}) {
  const style = podiumStyles[row.rank] ?? podiumStyles[3]
  return (
    <div
      className={`flex flex-col items-center rounded-lg border border-slate-200 bg-surface p-3 sm:p-5 text-center shadow-card ${
        featured ? `ring-2 ${style.ring}` : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {row.rank === 1 ? (
          <Crown className={`h-5 w-5 ${style.medal}`} />
        ) : (
          <Medal className={`h-5 w-5 ${style.medal}`} />
        )}
        <span className="font-mono text-xs text-ink-faint">
          {style.label}
        </span>
      </div>

      <Avatar className={`${featured ? "h-16 w-16 sm:h-20 sm:w-20" : "h-14 w-14 sm:h-16 sm:w-16"} ring-2 ${style.ring}`}>
        <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
        <AvatarFallback className="bg-accent font-display text-white">
          {row.display_name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <Link
        href={`/profile/${row.username}`}
        className="mt-3 font-display text-sm sm:text-base tracking-tight text-ink hover:text-accent break-words"
      >
        {row.display_name}
      </Link>
      <p className="font-mono text-xs text-ink-faint">@{row.username}</p>
      <div className="mt-2">
        <RankBadge title={row.detectiveRank.title} />
      </div>

      <p className="mt-3 font-display text-2xl text-ink">
        {row.watched_count}
      </p>
      <p className="case-number">episodes</p>
      <p className="mt-1 text-xs text-ink-faint">{formatHours(row.total_minutes)}</p>
      <p className="mt-1 font-mono text-[10px] text-ink-faint">
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
  if (rankings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-surface p-12 text-center shadow-card">
        <Trophy className="mx-auto h-8 w-8 text-ink-faint" />
        <p className="mt-4 font-display text-sm text-ink-dim">
          No rankings yet
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Start watching episodes to appear on the leaderboard.
        </p>
      </div>
    )
  }

  const top3 = rankings.slice(0, 3)
  const rest = rankings.slice(3)
  const topWatched = rankings[0].watched_count || 1
  const podium = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3

  return (
    <div className="space-y-8">
      {/* Podium */}
      {top3.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {podium.map((row) => (
            <PodiumCard key={row.user_id} row={row} featured={row.rank === 1} />
          ))}
        </div>
      )}

      {/* Full list */}
      {rest.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-card">
          <div className="divide-y divide-slate-100">
            {rest.map((row) => {
              const isYou = row.user_id === currentUserId
              const pct = Math.max(
                4,
                Math.round((row.watched_count / topWatched) * 100)
              )
              return (
                <div
                  key={row.user_id}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    isYou ? "bg-accent/5 ring-1 ring-inset ring-accent/30" : ""
                  }`}
                >
                  <span className="w-7 shrink-0 text-center font-mono text-sm text-ink-faint">
                    {row.rank}
                  </span>

                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
                    <AvatarFallback className="bg-accent text-xs font-display text-white">
                      {row.display_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/profile/${row.username}`}
                        className="truncate font-display text-sm tracking-tight text-ink hover:text-accent"
                      >
                        {row.display_name}
                      </Link>
                      {isYou && (
                        <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white">
                          You
                        </span>
                      )}
                      <span className="hidden sm:inline-block">
                        <RankBadge title={row.detectiveRank.title} />
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm text-ink">
                      {row.watched_count}
                    </p>
                    <p className="font-mono text-[10px] text-ink-faint">
                      eps
                    </p>
                    <p className="mt-0.5 hidden font-mono text-[10px] text-ink-faint sm:block">
                      {row.rewatched_count}r · {row.total_views}v
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pinned "You" row when ranked beyond the leaderboard cap */}
      {you && you.watched_count > 0 && you.rank > rankings.length && (
        <div className="mt-2">
          <div className="border-t border-dashed border-slate-200" />
          <div className="mt-2 flex items-center gap-3 rounded-lg bg-accent/5 px-4 py-3 ring-1 ring-inset ring-accent/30">
            <span className="w-7 shrink-0 text-center font-mono text-sm text-ink">
              {you.rank}
            </span>

            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={you.avatar_url ?? avatarUrl(you.display_name)} />
              <AvatarFallback className="bg-accent text-xs font-display text-white">
                {you.display_name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/profile/${you.username}`}
                  className="truncate font-display text-sm tracking-tight text-ink hover:text-accent"
                >
                  {you.display_name}
                </Link>
                <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white">
                  You
                </span>
                <span className="hidden sm:inline-block">
                  <RankBadge title={you.detectiveRank.title} />
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.max(4, Math.round((you.watched_count / topWatched) * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="font-mono text-sm text-ink">{you.watched_count}</p>
              <p className="font-mono text-[10px] text-ink-faint">eps</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
