import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type WatchStatus = Database["public"]["Tables"]["watch_status"]["Row"]
type WatchStatusInsert = Database["public"]["Tables"]["watch_status"]["Insert"]

export async function getWatchStatus(userId: string, contentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("watch_status")
    .select("*")
    .eq("user_id", userId)
    .eq("content_id", contentId)
    .single()

  if (error && error.code !== "PGRST116") throw error

  return data
}

export async function getUserWatchStatuses(userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("watch_status")
    .select("content_id, status, watch_count, favorite")
    .eq("user_id", userId)

  if (error) throw error

  return data ?? []
}

export async function upsertWatchStatus(
  userId: string,
  contentId: string,
  status: WatchStatus["status"],
  watchCount?: number
) {
  const supabase = await createClient()

  const insert: WatchStatusInsert = {
    user_id: userId,
    content_id: contentId,
    status,
    ...(watchCount !== undefined ? { watch_count: watchCount } : {}),
  }

  const { data, error } = await supabase
    .from("watch_status")
    .upsert(insert, { onConflict: "user_id,content_id" })
    .select()
    .single()

  if (error) throw error

  return data
}

/**
 * Cycles the watch status: unwatched → watched → rewatched → unwatched.
 *
 * Count semantics (watch_count = total times watched):
 * - entering "watched"  → at least 1
 * - entering "rewatched" → previous count + 1
 * - entering "unwatched" → count preserved (does NOT reset)
 */
export async function toggleWatchStatus(
  userId: string,
  contentId: string,
  currentStatus: WatchStatus["status"] | null,
  existingCount = 0
) {
  const nextStatus =
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

  return upsertWatchStatus(userId, contentId, nextStatus, nextCount)
}
