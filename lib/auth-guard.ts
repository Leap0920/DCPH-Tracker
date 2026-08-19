import type { SupabaseClient } from "@supabase/supabase-js"

export async function requireActiveUser(supabase: SupabaseClient) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, status: 401 as const, message: "Unauthorized" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("user_id", user.id)
    .single()

  if (profile?.status === "banned" || profile?.status === "suspended") {
    return { user, status: 403 as const, message: "Account is not active" }
  }
  return { user, status: null, message: null }
}
