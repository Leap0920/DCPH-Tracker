import { NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { ok, fail, handleApiError, sanitizeProfile } from "@/lib/api-utils"
import {
  validateUsername,
  validateDisplayName,
  validateBirthday,
} from "@/lib/validation"
import { authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { isSameOrigin } from "@/lib/origin-check"

export async function GET(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return fail(403, "Forbidden")
    const rl = await rateLimitPersistent(`admin:get:${authRateLimitKey(request)}`, {
      limit: 30,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) return fail(429, "Too many requests. Please slow down.")
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    // Real admin check — this route must never be reachable by regular users.
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (roleError) throw roleError

    if (profile?.role !== "admin") {
      return fail(403, "Admin access required")
    }

    const { data: adminProfile, error } = await supabase
      .from("profiles")
      .select("username, display_name, avatar_url")
      .eq("user_id", user.id)
      .single()

    if (error) throw error

    return ok(sanitizeProfile(adminProfile ?? {}))
  } catch (error) {
    return handleApiError(error, "admin")
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return fail(403, "Forbidden")
    const rl = await rateLimitPersistent(`admin:put:${authRateLimitKey(request)}`, {
      limit: 10,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) return fail(429, "Too many requests. Please slow down.")
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    // Real admin check before any mutation.
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (roleError) throw roleError

    if (profile?.role !== "admin") {
      return fail(403, "Admin access required")
    }

    const body = await request.json()
    const { username, display_name, birthday } = body

    // role / status are NEVER accepted from the client — role changes and
    // moderation go through admin server actions (service-role client).
    const usernameError = validateUsername(username)
    if (usernameError) return fail(400, usernameError)

    const displayNameError = validateDisplayName(display_name)
    if (displayNameError) return fail(400, displayNameError)

    const birthdayError = validateBirthday(birthday)
    if (birthdayError) return fail(400, birthdayError)

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({
        username: username?.trim(),
        display_name: display_name?.trim(),
        birthday: birthday || null,
      })
      .eq("user_id", user.id)
      .select("username, display_name, avatar_url")

    if (updateError) {
      return handleApiError(updateError, "admin.update")
    }

    return ok(sanitizeProfile(updated?.[0] ?? {}))
  } catch (error) {
    return handleApiError(error, "admin")
  }
}