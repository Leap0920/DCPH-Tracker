"use client"

import Link from "next/link"
import { Trophy, Medal } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { padNumber } from "@/lib/utils"
import { avatarUrl } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type LeaderboardRow = Database["public"]["Views"]["leaderboard"]["Row"]

function getRankStyle(rank: number) {
  if (rank === 1) return "text-gold-seal"
  if (rank === 2) return "text-silver-steel"
  if (rank === 3) return "text-poison-red-bright"
  return "text-dossier-cream-dim"
}

export function RankingsTable({ rankings }: { rankings: LeaderboardRow[] }) {
  if (rankings.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="font-display text-lg uppercase text-silver-steel">
          No rankings yet
        </p>
        <p className="text-sm text-dossier-cream-dim mt-2">
          Start watching episodes to appear on the leaderboard.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rankings.map((entry) => (
        <Link
          key={entry.user_id}
          href={`/profile/${entry.username}`}
          className="dossier-card flex items-center gap-4 p-4 transition-colors hover:bg-case-file-raised"
        >
          {/* Rank */}
          <div className={`w-10 text-center font-display text-xl ${getRankStyle(entry.rank)}`}>
            {entry.rank <= 3 ? (
              <Trophy className="h-5 w-5 mx-auto" />
            ) : (
              <span>{entry.rank}</span>
            )}
          </div>

          {/* Avatar */}
          <Avatar className="h-10 w-10">
            <AvatarImage src={entry.avatar_url ?? avatarUrl(entry.display_name)} />
            <AvatarFallback className="bg-poison-red text-dossier-cream text-xs">
              {entry.display_name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm uppercase tracking-wide text-dossier-cream truncate">
              {entry.display_name}
            </p>
            <p className="case-number">@{entry.username}</p>
          </div>

          {/* Stats */}
          <div className="text-right">
            <p className="font-mono text-sm text-dossier-cream">
              {entry.watched_count} <span className="text-dossier-cream-dim">cases</span>
            </p>
            <p className="case-number">
              {Math.floor(entry.total_minutes / 60)}h {entry.total_minutes % 60}m
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}
