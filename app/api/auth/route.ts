import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { rateLimit, authRateLimitKey, identifierRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { isSameOriginRequest } from "@/lib/csrf"
import {
  validateEmail,
  validatePassword,
  validateUsername,
  validateDisplayName,
} from "@/lib/validation"

/** Window for the persistent login/signup limits below. */
const AUTH_WINDOW_MS = 15 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    // CSRF guard: reject cross-origin POSTs before consuming a rate-limit slot.
    if (!isSameOriginRequest(request)) return fail(403, "Forbidden")

    // Burst guard: 10 attempts / 5 min per IP, in-memory. Cheap, but per
    // lambda instance — the authoritative limits are the persistent ones below.
    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return fail(429, "Too many attempts. Please try again later.")
    }

    const body = await request.json()
    const mode = body?.mode === "signup" ? "signup" : "signin"
    const email = typeof body?.email === "string" ? body.email.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""

    /*
      Cross-instance limits, counted in Postgres so they hold across the whole
      fleet and survive cold starts. Two keys on purpose: the IP key caps one
      source, the address key caps one target — an IP-only limit misses
      credential stuffing spread over many addresses, and an address-only limit
      lets one host spray every account. failClosed: an auth surface must deny
      during a limiter outage rather than fall open.
    */
    const ipLimit = await rateLimitPersistent(
      `auth:${mode}:${authRateLimitKey(request)}`,
      {
        limit: mode === "signin" ? 30 : 10,
        windowMs: AUTH_WINDOW_MS,
        failClosed: true,
      }
    )
    if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfterSeconds)

    if (email) {
      const emailLimit = await rateLimitPersistent(
        `auth:${mode}:${identifierRateLimitKey(request, email)}`,
        {
          limit: mode === "signin" ? 10 : 5,
          windowMs: AUTH_WINDOW_MS,
          failClosed: true,
        }
      )
      if (!emailLimit.allowed) return tooManyRequests(emailLimit.retryAfterSeconds)
    }

    if (mode === "signin") {
      if (!email || !password) return fail(400, "Email and password are required")
      const supabase = await createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return fail(401, "Invalid email or password")
      return NextResponse.json({ success: true })
    }

    // signup
    const emailError = validateEmail(email)
    if (emailError) return fail(400, emailError)
    const passwordError = validatePassword(password)
    if (passwordError) return fail(400, passwordError)

    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : ""

    const usernameError = validateUsername(username)
    if (usernameError) return fail(400, usernameError)
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) return fail(400, displayNameError)

    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: displayName } },
    })

    if (error) {
      // Generic message — never echo Supabase's "already registered" etc.
      return fail(400, "Registration failed. Please try again.")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, "auth")
  }
}

export async function GET() {
  // Remove endpoint-existence disclosure: auth endpoints answer 404.
  return fail(404, "Not found")
}