import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import {
  OTP_EMAIL_DEV_FLOOR,
  OTP_EMAIL_HOURLY_LIMIT,
  OTP_IP_DEV_FLOOR,
  OTP_IP_HOURLY_LIMIT,
  UPSTREAM_RESEND_WINDOW_SECONDS,
  devFloor,
  waitHint,
} from "@/lib/otp-limits"
import { authRateLimitKey, identifierRateLimitKey, rateLimit } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { validateEmail, validateDisplayName, validateBirthday, usernameBaseFrom } from "@/lib/validation"

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000")
).replace(/\/+$/, "")

const GENERIC_OK = { success: true } as const

/*
  The hourly ceilings, the override guard and the wait hint live in
  lib/otp-limits.ts — the numbers are proved there (`bend PROOF.bend`), so they
  are not duplicated here.
*/

/**
 * GoTrue's own rate-limit refusals arrive as ordinary error messages:
 * "Email rate limit exceeded", "Request rate limit reached", and the
 * per-address window "For security purposes, you can only request this once
 * every 60 seconds". They used to be echoed as a 400 with the provider's raw
 * wording, which told the user nothing about what to do next.
 */
const UPSTREAM_RATE_LIMIT =
  /rate limit|too many|for security purposes|only request this/i

/** A provider refusal: a rate-limit wait, or the provider's own text. */
function upstreamRefusal(message: string): Response {
  if (UPSTREAM_RATE_LIMIT.test(message)) {
    return tooManyRequests(
      UPSTREAM_RESEND_WINDOW_SECONDS,
      "A code was requested for this email a moment ago. Please wait about a minute before asking for another one."
    )
  }
  return fail(400, message)
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const isDev = process.env.NODE_ENV === "development"
    // Dev keeps its own looser floor so a local test run is never blocked by
    // the production numbers; a configured override above it still wins.
    const ipLimit = isDev
      ? devFloor(OTP_IP_HOURLY_LIMIT, OTP_IP_DEV_FLOOR)
      : OTP_IP_HOURLY_LIMIT
    const emailLimit = isDev
      ? devFloor(OTP_EMAIL_HOURLY_LIMIT, OTP_EMAIL_DEV_FLOOR)
      : OTP_EMAIL_HOURLY_LIMIT

    /*
      Burst guard before the body is read: in-memory, per instance, and cheap.
      It bounds how often an anonymous caller can make the server parse a body,
      and it keeps a floor under rapid retries if the persistent limiter is
      unavailable (which otherwise denies everything on this route).
    */
    const burst = rateLimit(authRateLimitKey(request), {
      limit: 30,
      windowMs: 60_000,
    })
    if (!burst.allowed) {
      return tooManyRequests(
        burst.retryAfterSeconds,
        `Too many requests. Please try again in ${waitHint(burst.retryAfterSeconds)}.`
      )
    }

    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    const mode = body?.mode === "signup" ? "signup" : "signin"
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : ""
    const birthday = typeof body?.birthday === "string" ? body.birthday.trim() : ""

    /*
      Validate the address BEFORE the shared per-IP budget is spent. A malformed
      address can never send mail, so charging it against the network's hourly
      budget only takes attempts away from the legitimate users behind that
      address — which is the failure this route is fixing.
    */
    const emailError = validateEmail(email)
    if (emailError) {
      return fail(400, emailError)
    }

    // OTP requests per hour per IP — an abuse ceiling shared by everyone behind
    // that address, not a per-user quota (see OTP_IP_HOURLY_LIMIT).
    const ipRl = await rateLimitPersistent(`otp:${authRateLimitKey(request)}`, {
      limit: ipLimit,
      windowMs: 60 * 60 * 1000,
      failClosed: !isDev,
    })
    if (!ipRl.allowed) {
      return tooManyRequests(
        ipRl.retryAfterSeconds,
        `Too many verification codes were requested from this network. Please try again in ${waitHint(ipRl.retryAfterSeconds)}.`
      )
    }

    /*
      Signup only — a signin OTP needs nothing but the address. Both values are
      copied into the new profile row by handle_new_user(), so they are capped
      and type-checked here; before this they were only trimmed, which let a
      caller write an arbitrarily long display name and an unparseable birthday
      into profiles via the signup metadata. An absent display name is still
      fine: the signup path below derives one from the address.
    */
    if (mode === "signup") {
      if (displayName) {
        const displayNameError = validateDisplayName(displayName)
        if (displayNameError) return fail(400, displayNameError)
      }
      const birthdayError = validateBirthday(birthday)
      if (birthdayError) return fail(400, birthdayError)
    }

    // OTP requests per hour per address — the actual per-user quota.
    const emailRl = await rateLimitPersistent(
      `otp:${identifierRateLimitKey(request, email)}`,
      { limit: emailLimit, windowMs: 60 * 60 * 1000, failClosed: !isDev }
    )
    if (!emailRl.allowed) {
      return tooManyRequests(
        emailRl.retryAfterSeconds,
        `Too many codes were requested for ${email}. Please try again in ${waitHint(emailRl.retryAfterSeconds)}.`
      )
    }

    const supabase = await createClient()

    // For signup, we need to generate username and include display_name/birthday
    if (mode === "signup") {
      // Generate username behind the scenes
      const base = usernameBaseFrom(displayName || "", email)
      let username = base
      let attempts = 0
      while (attempts < 5) {
        const candidate = attempts === 0 ? username : `${username}${Math.floor(100 + Math.random() * 900)}`
        const { data } = await supabase.from("profiles").select("id").eq("username", candidate).maybeSingle()
        if (!data) {
          username = candidate
          break
        }
        attempts++
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: {
            username,
            display_name: displayName || username,
            birthday: birthday || null,
          },
          emailRedirectTo: `${SITE_URL}/callback?next=/tracker`,
        },
      })

      if (error) {
        console.error("[otp] signInWithOtp signup failed", error.message)
        // If account already exists, treat as sign-in instead of hard error — user likely
        // clicked Sign Up with an existing email. Send a sign-in code instead.
        if (
          error.message.toLowerCase().includes("already") ||
          error.message.toLowerCase().includes("registered") ||
          error.message.toLowerCase().includes("exists") ||
          error.message.toLowerCase().includes("already registered") ||
          error.message.toLowerCase().includes("already exists")
        ) {
          const { error: retryError } = await supabase.auth.signInWithOtp({
            email,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: `${SITE_URL}/callback?next=/tracker`,
            },
          })
          if (retryError) {
            console.error("[otp] retry signIn failed", retryError.message)
            return upstreamRefusal(retryError.message)
          }
          return NextResponse.json(GENERIC_OK)
        }
        return upstreamRefusal(error.message)
      }
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${SITE_URL}/callback?next=/tracker`,
        },
      })

      if (error) {
        console.error("[otp] signInWithOtp signin failed", error.message)
        // Generic message to avoid enumeration, but still inform if user not found
        if (error.message.toLowerCase().includes("not found")) {
          return fail(400, "No account found with this email. Please create an account first.")
        }
        return upstreamRefusal(error.message)
      }
    }

    return NextResponse.json(GENERIC_OK)
  } catch (error) {
    return handleApiError(error, "otp")
  }
}

export async function GET() {
  return fail(404, "Not found")
}
