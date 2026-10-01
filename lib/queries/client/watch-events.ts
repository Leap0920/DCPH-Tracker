import type { SupabaseClient } from "@supabase/supabase-js"
import { broadcastActivityLogged } from "@/lib/queries/client/streaks"

/** Chunked so a mark-all across the whole library stays under payload limits. */
const INSERT_CHUNK = 500

export type WatchEventType = "watched" | "rewatched"
export type WatchEventSource = "single" | "bulk"

export interface WatchEventInput {
  content_id: string
  event_type: WatchEventType
}

/**
 * Appends watch events. Best-effort by design.
 *
 * FAILURES ARE SWALLOWED AND LOGGED, NEVER THROWN. watch_status is the source of
 * truth for what a user has watched; watch_events only feeds the rolling
 * leaderboards. A logging failure must not make a successful watch toggle look
 * broken to the user, or roll back the write that already landed.
 *
 * Callers pass user_id explicitly, but RLS ("Users can insert own watch events",
 * auth.uid() = user_id) is what actually enforces ownership.
 */
export async function recordWatchEvents(
  supabase: SupabaseClient,
  userId: string,
  events: readonly WatchEventInput[],
  source: WatchEventSource = "single",
): Promise<void> {
  if (!userId || events.length === 0) return

  const rows = events.map((event) => ({
    user_id: userId,
    content_id: event.content_id,
    event_type: event.event_type,
    source,
  }))

  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK)
    const { error } = await supabase.from("watch_events").insert(chunk)
    if (error) {
      console.error("[watch-events] insert failed", {
        source,
        rows: chunk.length,
        message: error.message,
      })
      return
    }
  }

  // Feed today's daily streak. Best-effort like the events themselves: this
  // runs only after a clean insert (the early return above), and a streak
  // hiccup — e.g. supabase/migration-streaks.sql not applied yet — must never
  // surface as a failed watch toggle. The card also re-syncs on load, so a
  // missed call here self-heals; the broadcast just makes an open card refresh.
  const { error: streakError } = await supabase.rpc("streak_sync")
  if (streakError) {
    console.warn("[streaks] sync after log failed", {
      message: streakError.message,
    })
  }
  // Listeners still refresh: the log itself is what the event announces.
  broadcastActivityLogged()
}
