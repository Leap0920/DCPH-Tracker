import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import type { EmailOtpType } from "@supabase/supabase-js"

/**
 * GET /auth/callback
 *
 * Landing route for Supabase email links (signup confirmation, magic link,
 * password recovery). Supports both the PKCE `code` flow and the
 * `token_hash` + `type` OTP flow, then redirects the user onward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

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
      `${origin}/login?error=${encodeURIComponent(error.message)}`
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
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  // Nothing to process — bounce to login with a generic message.
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Invalid or expired link")}`
  )
}
