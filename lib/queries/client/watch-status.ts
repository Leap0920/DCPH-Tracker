import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type WatchStatusRow = Database["public"]["Tables"]["watch_status"]["Row"]
type WatchStatus = WatchStatusRow["status"]

export interface UserWatchStatuses {
  /** content_id -> watch status (unwatched/watched/rewatched). */
  statuses: Map<string, WatchStatus>
  /** content_id -> watch_count (total times watched). */
  counts: Map<string, number>
  /** content_id -> favorite flag. */
  favorites: Map<string, boolean>
  /** content_id -> rating in DB units (2..10). */
  ratings: Map<string, number>
}

/**
 * Fetches all watch-status rows for a user and folds them into the four Maps
 * the tracker renders. Behavior-parity with the original loadData().
 */
export async function fetchUserWatchStatuses(userId: string): Promise<UserWatchStatuses> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("watch_status")
    .select("content_id, status, watch_count, favorite, rating")
    .eq("user_id", userId)

  if (error) throw error

  const statuses = new Map<string, WatchStatus>()
  const counts = new Map<string, number>()
  const favorites = new Map<string, boolean>()
  const ratings = new Map<string, number>()

  for (const s of data ?? []) {
    statuses.set(s.content_id, s.status as WatchStatus)
    counts.set(s.content_id, s.watch_count ?? 0)
    favorites.set(s.content_id, s.favorite ?? false)
    ratings.set(s.content_id, s.rating ?? 0)
  }

  return { statuses, counts, favorites, ratings }
}

/**
 * Pure status-cycle logic shared by the mutation fn and the optimistic
 * updater so the UI preview and the server write can never diverge.
 *
 * unwatched → watched → rewatched → unwatched.
 * Count semantics (watch_count = total times watched):
 * - entering "watched"   → at least 1
 * - entering "rewatched" → previous count + 1
 * - entering "unwatched" → count preserved (does NOT reset)
 */
export function nextWatchState(
  currentStatus: WatchStatus | null,
  existingCount = 0
): { nextStatus: WatchStatus; nextCount: number } {
  const nextStatus: WatchStatus =
    currentStatus === "rewatched"
      ? "unwatched"
      : currentStatus === "watched"
        ? "rewatched"
        : "watched"

  const nextCount =
    nextStatus === "unwatched"
      ? existingCount
      : nextStatus === "rewatched"
        ? existingCount + 1
        : Math.max(existingCount, 1)

  return { nextStatus, nextCount }
}

/**
 * Cycles the watch status: unwatched → watched → rewatched → unwatched.
 * Mirrors the server toggleWatchStatus semantics (incl. count rules).
 */
export async function toggleWatchStatus(
  userId: string,
  contentId: string,
  currentStatus: WatchStatus | null,
  existingCount = 0
) {
  const supabase = createClient()

  const { nextStatus, nextCount } = nextWatchState(currentStatus, existingCount)

  const { error } = await supabase
    .from("watch_status")
    .upsert(
      {
        user_id: userId,
        content_id: contentId,
        status: nextStatus,
        watch_count: nextCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" }
    )

  if (error) throw error
  return { nextStatus, nextCount }
}

export async function toggleFavorite(userId: string, contentId: string, current: boolean) {
  const supabase = createClient()
  const nextFavorite = !current

  const { error } = await supabase
    .from("watch_status")
    .upsert(
      {
        user_id: userId,
        content_id: contentId,
        favorite: nextFavorite,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" }
    )

  if (error) throw error
  return { nextFavorite }
}

/**
 * Sets a rating from star UI value (1..5) — stored as star × 2 (DB 2..10).
 * starValue === 0 clears the rating (null).
 */
export async function setRating(userId: string, contentId: string, starValue: number) {
  const supabase = createClient()
  const dbRating = starValue === 0 ? null : starValue * 2

  const { error } = await supabase
    .from("watch_status")
    .upsert(
      {
        user_id: userId,
        content_id: contentId,
        rating: dbRating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" }
    )

  if (error) throw error
  return { dbRating }
}

export async function markAll(
  userId: string,
  ids: string[],
  status: WatchStatus,
  countByContent: Map<string, number>
) {
  const supabase = createClient()

  const rows = ids.map((id) => ({
    user_id: userId,
    content_id: id,
    status,
    watch_count: Math.max(countByContent.get(id) ?? 0, 1),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from("watch_status").upsert(rows, {
    onConflict: "user_id,content_id",
  })

  if (error) throw error
  return { ids, status }
}
