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

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("username, display_name, avatar_url")
      .eq("user_id", user.id)
      .single()

    if (error) throw error

    return ok(sanitizeProfile(profile ?? {}))
  } catch (error) {
    return handleApiError(error, "analytics")
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return fail(403, "Forbidden")
    const rl = await rateLimitPersistent(`analytics:put:${authRateLimitKey(request)}`, {
      limit: 10,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) return fail(429, "Too many requests. Please slow down.")
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

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        username: username?.trim(),
        display_name: display_name?.trim(),
        birthday: birthday || null,
      })
      .eq("user_id", user.id)
      .select("username, display_name, avatar_url")

    if (profileError) {
      return handleApiError(profileError, "analytics.update")
    }

    return ok(sanitizeProfile(profile?.[0] ?? {}))
  } catch (error) {
    return handleApiError(error, "analytics")
  }
}