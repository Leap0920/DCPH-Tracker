import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"

/**
 * Returns the current user's profile if they are an admin, otherwise null.
 * Safe to call from Server Components / Server Actions.
 */
export async function getAdminProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (!profile || profile.role !== "admin") return null
  return profile
}

/**
 * Guard for admin-only Server Components / Server Actions. Redirects
 * non-admins away. Middleware already blocks the /admin route, but this
 * is defense-in-depth for direct action invocations.
 */
export async function requireAdmin() {
  const profile = await getAdminProfile()
  if (!profile) {
    redirect("/tracker?error=admin_only")
  }
  return profile
}
