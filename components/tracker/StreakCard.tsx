"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Flame, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { queryKeys } from "@/lib/queries/keys"
import {
  ACTIVITY_LOGGED_EVENT,
  fetchStreakSnapshot,
  reviveStreak,
  type StreakSnapshot,
} from "@/lib/queries/client/streaks"

/** "yyyy-mm-dd" → "Sep 28", timezone-proof (the date is already Manila-local). */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function reviveErrorMessage(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : ""
  if (/no revives left/i.test(message)) {
    return "No revives left this month — they reset at the start of next month."
  }
  if (/nothing to revive/i.test(message)) {
    return "Nothing to revive right now."
  }
  return "Couldn't revive your streak — please try again."
}

/**
 * The daily-streak card for /tracker.
 *
 * One log day (a day with at least one watch event, Manila time) extends the
 * streak; a whole missed day breaks it. A broken streak can be revived — up
 * to 3 times per calendar month — which heals the gap: the lost count and
 * anything logged since the break become one streak again.
 *
 * All of that is computed server-side (public.streak_sync / streak_revive —
 * supabase/migration-streaks.sql); this card only renders the snapshot and
 * refreshes when: it mounts, the page logs a watch (ACTIVITY_LOGGED_EVENT),
 * the window regains focus, or the user taps Revive.
 */
export function StreakCard({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient()
  const streakKey = useMemo(
    () => queryKeys.streak.byUser(userId ?? ""),
    [userId]
  )
  const [reviveError, setReviveError] = useState<string | null>(null)

  const streakQuery = useQuery({
    queryKey: streakKey,
    queryFn: fetchStreakSnapshot,
    enabled: !!userId,
    staleTime: 60_000,
  })

  // A watch was just logged on this page — the streak number may have moved.
  useEffect(() => {
    if (!userId) return
    const onLogged = () =>
      queryClient.invalidateQueries({ queryKey: streakKey })
    window.addEventListener(ACTIVITY_LOGGED_EVENT, onLogged)
    return () => window.removeEventListener(ACTIVITY_LOGGED_EVENT, onLogged)
  }, [userId, queryClient, streakKey])

  const revive = useMutation({
    mutationFn: reviveStreak,
    onSuccess: (snapshot) => {
      setReviveError(null)
      queryClient.setQueryData<StreakSnapshot>(streakKey, snapshot)
    },
    onError: (error) => setReviveError(reviveErrorMessage(error)),
  })

  const snapshot = streakQuery.data

  return (
    <section
      aria-label="Daily streak"
      className="rounded-lg border border-ink-dim/20 bg-surface p-4 shadow-card sm:p-6"
    >
      {!userId ? (
        <div className="flex items-center gap-3">
          <Flame className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden="true" />
          <div>
            <p className="font-display text-sm tracking-tight text-ink">Daily streak</p>
            <p className="text-xs text-ink-dim">
              Sign in and log an episode a day to start a streak.
            </p>
          </div>
        </div>
      ) : streakQuery.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <Flame className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden="true" />
          <p className="flex-1 text-xs text-ink-dim">Couldn&apos;t load your streak.</p>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg"
            onClick={() => streakQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : !snapshot ? (
        <div className="flex items-center gap-3">
          <Flame className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden="true" />
          <p className="animate-pulse font-mono text-xs text-ink-faint">
            Checking your streak&hellip;
          </p>
        </div>
      ) : snapshot.brokenStreak !== null ? (
        // ── Broken — one revive away (3 per calendar month) ──
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-muted">
            <Flame className="h-5 w-5 text-ink-faint" aria-hidden="true" />
          </div>
          <div className="min-w-[180px] flex-1">
            <p className="font-display text-sm tracking-tight text-ink">
              Your {snapshot.brokenStreak}-day streak broke
              {snapshot.brokenSince ? ` on ${formatDay(snapshot.brokenSince)}` : ""}.
            </p>
            <p className="mt-1 text-xs text-ink-dim">
              {snapshot.revivesLeft > 0
                ? `Revive it to pick up where you left off — ${snapshot.revivesLeft} of ${snapshot.revivesPerMonth} revives left this month.`
                : "No revives left this month — they reset at the start of next month."}
            </p>
            {reviveError && <p className="mt-1 text-xs text-danger">{reviveError}</p>}
          </div>
          <Button
            className="shrink-0 rounded-lg"
            onClick={() => revive.mutate()}
            disabled={revive.isPending || snapshot.revivesLeft === 0}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {revive.isPending ? "Reviving…" : "Revive streak"}
          </Button>
        </div>
      ) : snapshot.current > 0 ? (
        // ── Alive ──
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
            <Flame className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none tracking-tight text-ink">
              <span>{snapshot.current}</span>{" "}
              <span className="text-sm text-ink-dim">day streak</span>
            </p>
            <p className="mt-1.5 text-xs text-ink-dim">
              {snapshot.loggedToday
                ? "Today's log is in — log again tomorrow to keep it going."
                : "Log an episode today to keep it going."}
            </p>
            <p className="mt-1 font-mono text-[10px] text-ink-faint">
              Longest: {snapshot.longest} {snapshot.longest === 1 ? "day" : "days"} ·{" "}
              {snapshot.revivesLeft} of {snapshot.revivesPerMonth} revives left this month
            </p>
          </div>
        </div>
      ) : (
        // ── Never started ──
        <div className="flex items-center gap-3">
          <Flame className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden="true" />
          <div>
            <p className="font-display text-sm tracking-tight text-ink">Daily streak</p>
            <p className="text-xs text-ink-dim">
              Mark an episode watched to start your streak — one log a day keeps it alive.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
