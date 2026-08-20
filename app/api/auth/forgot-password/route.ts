import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { authRateLimitKey, identifierRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { validateEmail } from "@/lib/validation"

/**
 * Password-recovery email request.
 *
 * Exists so the recovery email can be rate limited SERVER-side. The page used
 * to call supabase.auth.resetPasswordForEmail() from the browser, which meant
 * the only limiter was Supabase's own — an attacker could mailbomb any address
 * they knew, or burn the project's email quota, straight from devtools.
 *
 * Two independent persistent counters, both fail-closed (denying a recovery
 * email during a DB outage is strictly safer than allowing an unbounded one):
 *   - per IP    — blunt flood control
 *   - per email — stops a distributed mailbomb of one victim address, which
 *                 an IP-only limit cannot see
 *
 * ENUMERATION: the response is an unconditional generic success. Any Supabase
 * error is logged and swallowed, so "email exists" and "email does not exist"
 * are byte-identical to the client.
 *
 * redirectTo is a module constant built from env — never from the request —
 * so a crafted body cannot turn the recovery link into an open redirect.
 * NEXT_PUBLIC_SITE_URL must be set in production and the resulting
 * `${SITE_URL}/callback` must be in Supabase's Auth > URL Configuration
 * redirect allowlist, or Supabase will reject the redirect.
 */

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000")
).replace(/\/+$/, "")

const REDIRECT_TO = `${SITE_URL}/callback?next=/reset-password`

/** Deliberately identical for every outcome. */
const GENERIC_OK = { success: true } as const

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    // 5 recovery requests / hour / IP.
    const ipRl = await rateLimitPersistent(`forgot:${authRateLimitKey(request)}`, {
      limit: 5,
      windowMs: 60 * 60 * 1000,
      failClosed: true,
    })
    if (!ipRl.allowed) {
      return tooManyRequests(ipRl.retryAfterSeconds)
    }

    const body = await request.json().catch(() => null)
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""

    // Format-only validation: reveals nothing about account existence.
    const emailError = validateEmail(email)
    if (emailError) {
      return fail(400, emailError)
    }

    // 3 recovery requests / hour / address, regardless of source IP.
    const emailRl = await rateLimitPersistent(
      `forgot:${identifierRateLimitKey(request, email)}`,
      { limit: 3, windowMs: 60 * 60 * 1000, failClosed: true }
    )
    if (!emailRl.allowed) {
      return tooManyRequests(emailRl.retryAfterSeconds)
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT_TO,
    })

    if (error) {
      // Logged, never surfaced: the message distinguishes real accounts from
      // unknown ones and would hand an attacker a user-enumeration oracle.
      console.error("[forgot-password] resetPasswordForEmail failed", error.message)
    }

    return NextResponse.json(GENERIC_OK)
  } catch (error) {
    return handleApiError(error, "forgot-password")
  }
}

export async function GET() {
  // Match app/api/auth/route.ts: auth endpoints don't confirm they exist.
  return fail(404, "Not found")
}