import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { authRateLimitKey, identifierRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { validateEmail } from "@/lib/validation"

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000")
).replace(/\/+$/, "")

const GENERIC_OK = { success: true } as const

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const isDev = process.env.NODE_ENV === "development"
    const ipLimit = isDev ? 50 : 10
    const emailLimit = isDev ? 30 : 10

    // OTP requests per hour per IP
    const ipRl = await rateLimitPersistent(`otp:${authRateLimitKey(request)}`, {
      limit: ipLimit,
      windowMs: 60 * 60 * 1000,
      failClosed: !isDev,
    })
    if (!ipRl.allowed) {
      return tooManyRequests(ipRl.retryAfterSeconds)
    }

    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    const mode = body?.mode === "signup" ? "signup" : "signin"
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : ""
    const birthday = typeof body?.birthday === "string" ? body.birthday.trim() : ""

    const emailError = validateEmail(email)
    if (emailError) {
      return fail(400, emailError)
    }

    // OTP requests per hour per address
    const emailRl = await rateLimitPersistent(
      `otp:${identifierRateLimitKey(request, email)}`,
      { limit: emailLimit, windowMs: 60 * 60 * 1000, failClosed: !isDev }
    )
    if (!emailRl.allowed) {
      return tooManyRequests(emailRl.retryAfterSeconds)
    }

    const supabase = await createClient()

    // For signup, we need to generate username and include display_name/birthday
    if (mode === "signup") {
      // Generate username behind the scenes
      const base =
        (displayName || email.split("@")[0]).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 15) ||
        "detective"
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
            return fail(400, retryError.message)
          }
          return NextResponse.json(GENERIC_OK)
        }
        return fail(400, error.message)
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
        return fail(400, error.message)
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
