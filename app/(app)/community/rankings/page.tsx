import Link from "next/link"
import { Trophy, LogIn, ArrowRight } from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { getRankings, getUserGlobalRank } from "@/lib/queries/leaderboard"
import { getDetectiveRank } from "@/lib/ranks"
import { RankingsBoard } from "@/components/community/RankingsBoard"
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
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  let rankings = await getRankings(100)
  let you = null
  if (currentUserId) {
    you = rankings.find((r) => r.user_id === currentUserId) ?? null
  }
  // Keep the "You" row in the list even if it ranks beyond the limit
  if (currentUserId && !you) {
    const { data: watched } = await supabase
      .from("watch_status")
      .select("user_id, status, watch_count, content_entries(runtime_minutes)")
      .in("status", ["watched", "rewatched"])
      .eq("user_id", currentUserId)
    if (watched && watched.length > 0) {
      const count = watched.length
      const rewatched = watched.filter((w) => w.status === "rewatched").length
      const views = watched.reduce((acc, w) => acc + (w.watch_count ?? 0), 0)
      const minutes = watched.reduce(
        (acc, w) => acc + ((w.content_entries as { runtime_minutes: number | null } | null)?.runtime_minutes ?? 0),
        0
      )
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("user_id", currentUserId)
        .single()
      if (profile) {
        const globalRank = await getUserGlobalRank(currentUserId, count, minutes)
        const detectiveRank = getDetectiveRank(count)
        you = {
          user_id: currentUserId,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          watched_count: count,
          total_minutes: minutes,
          rewatched_count: rewatched,
          total_views: views,
          detectiveRank: { title: detectiveRank.title, level: detectiveRank.level },
          rank: globalRank ?? 0,
        }
      }
    }
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 005 · RANKINGS</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Detective Rankings
        </h1>
        <p className="mt-2 max-w-xl text-ink-dim">
          See how many episodes fellow detectives have cracked. Climb the ranks by
          logging every case you watch.
        </p>

        {/* Your standing */}
        <div className="mt-8">
          {currentUserId && you ? (
            (() => {
              const rankInfo = getDetectiveRank(you.watched_count)
              return (
                <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-surface p-5 sm:p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <Trophy className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-ink-dim">
                          Your Standing
                        </span>
                        {you.rank > 0 && (
                          <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                            Rank #{you.rank}
                          </span>
                        )}
                      </div>
                      <p className="font-display text-lg font-semibold tracking-tight text-ink mt-0.5">
                        {you.watched_count} episodes watched
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`inline-block rounded-md border px-2 py-0.5 font-mono text-xs font-medium ${rankInfo.badgeColor}`}>
                          Level {rankInfo.level} · {rankInfo.title}
                        </span>
                      </div>

                      {/* Progress bar to next rank threshold */}
                      {rankInfo.nextRankTitle && (
                        <div className="mt-3 w-full max-w-md">
                          <div className="flex items-center justify-between font-mono text-xs text-ink-dim mb-1">
                            <span>Next: {rankInfo.nextRankTitle}</span>
                            <span>{rankInfo.remainingToNext} cases left ({rankInfo.progressToNext}%)</span>
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

                  <Link href={`/profile/${you.username}`}>
                    <Button variant="outline" size="sm" className="h-9 rounded-xl border-slate-200 text-xs font-display text-ink-dim hover:text-ink">
                      View profile
                    </Button>
                  </Link>
                </div>
              )
            })()
          ) : currentUserId ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-card">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
                <Trophy className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-display text-lg tracking-tight text-ink">
                  You haven&apos;t watched any episodes yet
                </p>
                <p className="text-sm text-ink-dim">
                  Start tracking to claim your spot on the board.
                </p>
              </div>
              <Link href="/tracker">
                <Button size="sm" className="gap-1.5 rounded-lg">
                  Go to Tracker
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-card">
              <div className="flex-1">
                <p className="font-display text-lg tracking-tight text-ink">
                  Sign in to track your rank
                </p>
                <p className="text-sm text-ink-dim">
                  Log in to see how many episodes you&apos;ve watched.
                </p>
              </div>
              <AuthModalButton mode="signin" size="sm" className="gap-1.5 rounded-lg">
                <LogIn className="h-4 w-4" />
                Sign In
              </AuthModalButton>
            </div>
          )}
        </div>

        <div className="mt-8">
          <RankingsBoard rankings={rankings} currentUserId={currentUserId} you={you} />
        </div>
      </div>
    </div>
  )
}
