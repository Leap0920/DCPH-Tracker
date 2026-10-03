import Link from "next/link"
import { Trophy, LogIn, ArrowRight } from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { getRankings, getUserRankRow } from "@/lib/queries/leaderboard"
import { getDetectiveRank } from "@/lib/ranks"
import { RankingsBoardLoader } from "@/components/community/RankingsBoardLoader"
import { Button } from "@/components/ui/button"
import { AuthModalButton } from "@/components/auth/AuthModalButton"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Detective Rankings · Detective Conan PH",
  description:
    "See how many episodes fellow detectives have watched and climb the community leaderboard.",
}

export default async function RankingsPage() {
  const supabase = await createClient()

  // Auth and the leaderboard read are independent — run them concurrently so
  // the page costs max(read) of round-trips, not the serial sum.
  const [authResult, rankings] = await Promise.all([
    supabase.auth.getUser(),
    getRankings(100),
  ])
  const user = authResult.data.user
  const currentUserId = user?.id ?? null

  // The board carries the caller's row when they are on it. When they are not —
  // ranked beyond the returned page, or no qualifying rows at all — fetch just
  // that one row. This used to re-read every watch_status row to rebuild the
  // caller's totals and scan the table a second time for their rank, which
  // doubled an already-minutes-long load for anyone outside the top 100.
  const you = currentUserId
    ? (rankings.find((r) => r.user_id === currentUserId) ??
      (await getUserRankRow(currentUserId)))
    : null

  return (
    <div className="px-3.5 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
          <span className="case-number text-[11px] sm:text-xs">FILE NO. 005 · RANKINGS</span>
          <span className="redacted-bar w-12 sm:w-16" />
        </div>

        <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-ink">
          Detective Rankings
        </h1>
        <p className="mt-1.5 max-w-xl text-xs sm:text-base text-ink-dim leading-relaxed">
          Log cases. Climb the ranks.
        </p>

        {/* Your standing */}
        <div className="mt-6 sm:mt-8">
          {currentUserId && you ? (
            (() => {
              const rankInfo = getDetectiveRank(you.watched_count)
              return (
                <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-bright sm:h-11 sm:w-11">
                      <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-xs text-ink-dim">
                          Your Standing · All-Time
                        </span>
                        {you.rank > 0 && (
                          <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-accent-bright">
                            Rank #{you.rank}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-display text-lg font-semibold tracking-tight text-ink">
                        <span className="tabular-nums">{you.watched_count}</span>{" "}
                        episodes watched
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-block max-w-full rounded-md border px-2 py-0.5 font-mono text-xs font-medium ${rankInfo.badgeColor}`}
                        >
                          Level {rankInfo.level} · {rankInfo.title}
                        </span>
                      </div>

                      {/* Progress bar to next rank threshold */}
                      {rankInfo.nextRankTitle && (
                        <div className="mt-3 w-full max-w-md">
                          <div className="mb-1 flex flex-col gap-0.5 font-mono text-xs text-ink-dim sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                            <span className="truncate">
                              Next: {rankInfo.nextRankTitle}
                            </span>
                            <span className="tabular-nums sm:shrink-0">
                              {rankInfo.remainingToNext} cases left (
                              {rankInfo.progressToNext}%)
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-500"
                              style={{ width: `${rankInfo.progressToNext}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <Link
                    href={`/profile/${you.username}`}
                    className="block w-full sm:w-auto sm:shrink-0"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full rounded-xl border-line font-display text-xs text-ink-dim hover:text-ink sm:w-auto"
                    >
                      View profile
                    </Button>
                  </Link>
                </div>
              )
            })()
          ) : currentUserId ? (
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-card">
              <div className="flex items-start sm:items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:h-11 sm:w-11">
                  <Trophy className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold tracking-tight text-ink sm:text-lg">
                    You haven&apos;t watched any episodes yet
                  </p>
                  <p className="text-xs sm:text-sm text-ink-dim">
                    Start tracking to claim your spot on the board.
                  </p>
                </div>
              </div>
              <Link href="/tracker" className="w-full sm:w-auto">
                <Button size="sm" className="w-full sm:w-auto gap-1.5 rounded-xl bg-accent hover:bg-accent-bright text-white text-xs sm:text-sm font-medium h-9 shadow-xs">
                  Go to Tracker
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-card">
              <div className="flex items-start sm:items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:h-11 sm:w-11">
                  <LogIn className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold tracking-tight text-ink sm:text-lg">
                    Sign in to track your rank
                  </p>
                  <p className="text-xs sm:text-sm text-ink-dim">
                    See your watched count and rank.
                  </p>
                </div>
              </div>
              <AuthModalButton mode="signin" size="sm" className="w-full sm:w-auto gap-1.5 rounded-xl bg-accent hover:bg-accent-bright text-white text-xs sm:text-sm font-medium h-9 shadow-xs">
                <LogIn className="h-4 w-4" />
                Sign In
              </AuthModalButton>
            </div>
          )}
        </div>

        <div className="mt-6 sm:mt-8">
          <RankingsBoardLoader rankings={rankings} currentUserId={currentUserId} you={you} />
        </div>
      </div>
    </div>
  )
}