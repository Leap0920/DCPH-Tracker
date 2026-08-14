import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]

/**
 * Safe public columns only. Never select("*") — the base table holds PII
 * (birthday, bio, status, ban_reason, ...) that must stay private.
 */
export const PUBLIC_PROFILE_COLUMNS = "user_id, username, display_name, avatar_url"

/**
 * Reads a profile through the `public_profiles` security-definer view
 * (safe columns only). Falls back to the base table with safe columns when
 * the view has not been created yet (migration not applied). This function
 * is safe to call for anonymous visitors — the view grants anon read.
 */
async function selectPublicProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: "username" | "user_id",
  value: string,
  mode: "maybeSingle" | "single"
) {
  const viewQuery = supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq(column, value)

  const view = await (mode === "maybeSingle" ? viewQuery.maybeSingle() : viewQuery.single())

  if (!view.error) return view

  // Fallback: view missing (migration not applied) → safe columns on base table.
  const base = supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq(column, value)

  const fb = await (mode === "maybeSingle" ? base.maybeSingle() : base.single())
  if (fb.error) throw fb.error
  return fb
}

export async function getProfileByUsername(username: string) {
  const supabase = await createClient()
  const result = await selectPublicProfile(supabase, "username", username, "maybeSingle")
  return result.data
}

export async function getProfileByUserId(userId: string) {
  const supabase = await createClient()
  const result = await selectPublicProfile(supabase, "user_id", userId, "single")
  return result.data
}

export async function updateProfile(userId: string, updates: ProfileUpdate) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(PUBLIC_PROFILE_COLUMNS)
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
  const rewatched = watchStatuses?.filter((ws) => ws.status === "rewatched") ?? []
  const totalMinutes = [...watched, ...rewatched].reduce((acc, ws) => {
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
    rewatchedCount: rewatched.length,
    totalMinutes,
    badgeCount: badgeCount ?? 0,
  }
}