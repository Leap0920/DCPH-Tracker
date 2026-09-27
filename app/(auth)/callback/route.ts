import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"

/**
 * GET /auth/callback
 *
 * Landing route for Supabase email links (signup confirmation, magic link,
 * password recovery). Supports both the PKCE `code` flow and the
 * `token_hash` + `type` OTP flow, then redirects the user onward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  // This route consumes one-time tokens, so it is a guessing surface like any
  // other verification endpoint: cap attempts per IP before touching Supabase.
  const rl = rateLimit(authRateLimitKey(request), {
    limit: 10,
    windowMs: 5 * 60 * 1000,
  })
  if (!rl.allowed) {
    return NextResponse.redirect(
      `${origin}/?auth=signin&error=${encodeURIComponent("Too many attempts. Please try again later.")}`
    )
  }

  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  // Where to send the user after a successful exchange.
  const rawNext = searchParams.get("next") ?? "/tracker"
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/tracker"

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/?auth=signin&error=${encodeURIComponent(error.message)}`
    )
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      // Password recovery should land on the reset screen.
      const dest = type === "recovery" ? "/reset-password" : next
      return NextResponse.redirect(`${origin}${dest}`)
    }
    return NextResponse.redirect(
      `${origin}/?auth=signin&error=${encodeURIComponent(error.message)}`
    )
  }

  // Nothing to process — bounce to sign in with a generic message.
  return NextResponse.redirect(
    `${origin}/?auth=signin&error=${encodeURIComponent("Invalid or expired link")}`
  )
}
