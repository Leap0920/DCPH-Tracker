import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]

export async function getProfileByUsername(username: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single()

  if (error) throw error

  return data
}

export async function getProfileByUserId(userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single()

  if (error) throw error

  return data
}

export async function updateProfile(userId: string, updates: ProfileUpdate) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select()
    .single()

  if (error) throw error

  return data
}

export async function getProfileStats(userId: string) {
  const supabase = await createClient()

  const { data: watchStatuses, error: watchError } = await supabase
    .from("watch_status")
    .select("status, content_entries(runtime_minutes)")
    .eq("user_id", userId)

  if (watchError) throw watchError

  const watched = watchStatuses?.filter((ws) => ws.status === "watched") ?? []
  const watching = watchStatuses?.filter((ws) => ws.status === "watching") ?? []
  const totalMinutes = watched.reduce((acc, ws) => {
    const entry = Array.isArray(ws.content_entries) ? ws.content_entries[0] : ws.content_entries
    return acc + (entry?.runtime_minutes ?? 0)
  }, 0)

  const { count: badgeCount, error: badgeError } = await supabase
    .from("user_badges")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)

  if (badgeError) throw badgeError

  return {
    watchedCount: watched.length,
    watchingCount: watching.length,
    totalMinutes,
    badgeCount: badgeCount ?? 0,
  }
}
