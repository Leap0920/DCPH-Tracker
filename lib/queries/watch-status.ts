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
    .select("content_id, status")
    .eq("user_id", userId)

  if (error) throw error

  return data ?? []
}

export async function upsertWatchStatus(
  userId: string,
  contentId: string,
  status: WatchStatus["status"]
) {
  const supabase = await createClient()

  const insert: WatchStatusInsert = {
    user_id: userId,
    content_id: contentId,
    status,
  }

  const { data, error } = await supabase
    .from("watch_status")
    .upsert(insert, { onConflict: "user_id,content_id" })
    .select()
    .single()

  if (error) throw error

  return data
}

export async function toggleWatchStatus(
  userId: string,
  contentId: string,
  currentStatus: WatchStatus["status"] | null
) {
  const nextStatus =
    currentStatus === "watched"
      ? "unwatched"
      : currentStatus === "watching"
        ? "watched"
        : "watching"

  return upsertWatchStatus(userId, contentId, nextStatus)
}
