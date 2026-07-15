import Link from "next/link"
import { Trophy, Medal, Crown } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl } from "@/lib/constants"
import type { RankingRow } from "@/lib/queries/leaderboard"

function formatHours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const podiumStyles: Record<number, { ring: string; medal: string; label: string }> = {
  1: { ring: "ring-[#9C7A2E]", medal: "text-[#9C7A2E]", label: "1st" },
  2: { ring: "ring-gray-300", medal: "text-gray-400", label: "2nd" },
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
      className={`flex flex-col items-center rounded-lg border border-gray-200 bg-white p-5 text-center shadow-sm ${
        featured ? `ring-2 ${style.ring}` : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {row.rank === 1 ? (
          <Crown className={`h-5 w-5 ${style.medal}`} />
        ) : (
          <Medal className={`h-5 w-5 ${style.medal}`} />
        )}
        <span className="font-mono text-xs uppercase tracking-wide text-gray-400">
          {style.label}
        </span>
      </div>

      <Avatar className={`${featured ? "h-20 w-20" : "h-16 w-16"} ring-2 ${style.ring}`}>
        <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
        <AvatarFallback className="bg-[#7A1620] font-display text-white">
          {row.display_name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <Link
        href={`/profile/${row.username}`}
        className="mt-3 font-display text-base uppercase tracking-wide text-gray-900 hover:text-[#7A1620]"
      >
        {row.display_name}
      </Link>
      <p className="font-mono text-xs text-gray-400">@{row.username}</p>

      <p className="mt-3 font-display text-2xl text-gray-900">
        {row.watched_count}
      </p>
      <p className="case-number">episodes</p>
      <p className="mt-1 text-xs text-gray-400">{formatHours(row.total_minutes)}</p>
    </div>
  )
}

export function RankingsBoard({
  rankings,
  currentUserId,
}: {
  rankings: RankingRow[]
  currentUserId?: string | null
}) {
  if (rankings.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <Trophy className="mx-auto h-8 w-8 text-gray-300" />
        <p className="mt-4 font-display text-sm uppercase tracking-wide text-gray-500">
          No rankings yet
        </p>
        <p className="mt-1 text-xs text-gray-400">
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
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="divide-y divide-gray-100">
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
                    isYou ? "bg-[#7A1620]/5 ring-1 ring-inset ring-[#7A1620]/30" : ""
                  }`}
                >
                  <span className="w-7 shrink-0 text-center font-mono text-sm text-gray-400">
                    {row.rank}
                  </span>

                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={row.avatar_url ?? avatarUrl(row.display_name)} />
                    <AvatarFallback className="bg-[#7A1620] text-xs font-display text-white">
                      {row.display_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/profile/${row.username}`}
                        className="truncate font-display text-sm uppercase tracking-wide text-gray-900 hover:text-[#7A1620]"
                      >
                        {row.display_name}
                      </Link>
                      {isYou && (
                        <span className="rounded-sm bg-[#7A1620] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                          You
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-[#7A1620]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm text-gray-900">
                      {row.watched_count}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-gray-400">
                      eps
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
