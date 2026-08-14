import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]

/**
 * The OWN-profile editor shape (settings page, authenticated + owner-scoped
 * RLS). Includes `bio` for editing; role/status/ban fields are never fetched
 * client-side.
 */
type OwnProfile = Pick<
  Profile,
  "user_id" | "username" | "display_name" | "avatar_url" | "bio"
>

/**
 * Explicit safe columns — never select("*"). This is the OWN profile editor
 * path (settings page, authenticated + owner-scoped RLS), so `bio` is included
 * for editing; role/status/ban fields are never fetched client-side.
 */
const OWN_PROFILE_COLUMNS = "user_id, username, display_name, avatar_url, bio"

export async function fetchProfileByUserId(
  userId: string
): Promise<OwnProfile | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("profiles")
    .select(OWN_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .single()

  if (error) throw error
  return data
}

export async function updateProfile(
  userId: string,
  updates: ProfileUpdate
): Promise<OwnProfile> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(OWN_PROFILE_COLUMNS)
    .single()

  if (error) throw error
  return data
}