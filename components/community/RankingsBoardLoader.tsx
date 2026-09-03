"use client"

import dynamic from "next/dynamic"
import type { RankingRow } from "@/lib/queries/leaderboard"

/**
 * Lazy host for the leaderboard. The page shell (standing card + sign-in CTA)
 * is server-rendered; the interactive board hydrates right after in its own
 * chunk, so /rankings' initial JS drops by the board's weight.
 */
const RankingsBoard = dynamic(
  () => import("@/components/community/RankingsBoard").then((m) => m.RankingsBoard),
  {
    ssr: false,
    loading: () => (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-busy="true">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <div className="h-4 w-32 rounded bg-surface-muted animate-pulse" />
          <div className="h-8 w-48 rounded-lg bg-surface-muted animate-pulse" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-line/60 px-4 py-3 sm:px-5"
          >
            <div className="h-6 w-6 shrink-0 rounded bg-surface-muted animate-pulse" />
            <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted animate-pulse" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-2/5 rounded bg-surface-muted animate-pulse" />
              <div className="h-3 w-1/4 rounded bg-surface-muted/70 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    ),
  }
)

export function RankingsBoardLoader({
  rankings,
  currentUserId,
  you,
}: {
  rankings: RankingRow[]
  currentUserId?: string | null
  you?: RankingRow | null
}) {
  return <RankingsBoard rankings={rankings} currentUserId={currentUserId} you={you} />
}
