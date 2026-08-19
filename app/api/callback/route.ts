import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, handleApiError } from "@/lib/api-utils"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import type { EmailOtpType } from "@supabase/supabase-js"

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "email",
  "invite",
  "recovery",
  "email_change",
]

function parseOtpType(value: unknown): EmailOtpType {
  return OTP_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : "signup"
}

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return fail(429, "Too many attempts. Please try again later.")
    }

    const body = await request.json()
    const token = typeof body?.token === "string" ? body.token.trim() : ""
    const tokenHash = typeof body?.token_hash === "string" ? body.token_hash.trim() : ""
    const email = typeof body?.email === "string" ? body.email.trim() : ""
    const type = parseOtpType(body?.type)

    if (!tokenHash && !token) {
      return fail(400, "Missing confirmation token")
    }
    if (!tokenHash && !email) {
      return fail(400, "Missing email")
    }

    const supabase = await createClient()

    // verifyOtp hits POST /auth/v1/verify AND persists the session via cookies.
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.verifyOtp({ type, token, email })

    if (error) {
      return fail(400, "Invalid or expired confirmation link.")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, "callback")
  }
}

export async function GET() {
  return fail(404, "Not found")
}
