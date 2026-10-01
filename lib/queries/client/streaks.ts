import { createClient } from "@/utils/supabase/client"

/**
 * Daily streaks ("daily logs" streak) — the card's data layer.
 *
 * All state lives server-side in public.user_streaks and is maintained by the
 * streak_sync() / streak_revive() functions (supabase/migration-streaks.sql).
 * The client never writes the table directly: sync runs on every card load
 * and after every logged watch, so the same append-only watch_events log that
 * feeds the leaderboards is also the streak's source of truth.
 */

/** Mirror of the jsonb streak_sync()/streak_revive() return. */
export interface StreakSnapshot {
  /** The alive streak length, as of lastActive. */
  current: number
  /** Best streak so far (days). */
  longest: number
  /** Has anything been logged today (Manila day)? */
  loggedToday: boolean
  /** Last counted day, "yyyy-mm-dd" (Manila). Null until the first log. */
  lastActive: string | null
  /** A broken streak awaiting revive — its lost length. Null when none. */
  brokenStreak: number | null
  /** First missed day of the pending break, "yyyy-mm-dd". */
  brokenSince: string | null
  /** Revives spent within the current calendar month. */
  revivesUsed: number
  /** 3 - revivesUsed, floored at 0. */
  revivesLeft: number
  /** The monthly allowance (3). */
  revivesPerMonth: number
}

/**
 * Window event fired right after a watch was logged, so an open streak card
 * refreshes without a page reload. Same-tab only, which is all it needs to be.
 */
export const ACTIVITY_LOGGED_EVENT = "dcph:activity-logged"

export function broadcastActivityLogged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(ACTIVITY_LOGGED_EVENT))
}

/** Current streak snapshot; also performs lazy break detection server-side. */
export async function fetchStreakSnapshot(): Promise<StreakSnapshot> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("streak_sync")
  if (error) throw error
  return data as unknown as StreakSnapshot
}

/** Spends one of the 3 monthly revives to heal the most recent break. */
export async function reviveStreak(): Promise<StreakSnapshot> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("streak_revive")
  if (error) throw error
  return data as unknown as StreakSnapshot
}
