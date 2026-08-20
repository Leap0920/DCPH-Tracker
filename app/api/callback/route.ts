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

/**
 * Post-verification destinations we are willing to redirect to.
 * Allowlist (not a heuristic) so `next` can never become an open redirect.
 * Add an entry here when a new email flow needs a new landing page.
 */
const ALLOWED_NEXT_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/tracker",
  "/reset-password",
])

/**
 * Sanitize the `next` query param into a same-site relative path.
 * Rejects absolute URLs, protocol-relative (`//host`), backslash tricks (`/\host`),
 * and anything containing a scheme separator. Falls back to "/".
 */
function safeNextPath(value: string | null): string {
  if (!value) return "/"
  const candidate = value.trim()
  if (!candidate.startsWith("/")) return "/"
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/"
  if (candidate.includes(":")) return "/"
  const pathname = candidate.split("?")[0].split("#")[0]
  return ALLOWED_NEXT_PATHS.has(pathname) ? candidate : "/"
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

/**
 * Browser landing point for Supabase email links (signup confirmation,
 * password recovery, email change). Supabase redirects the BROWSER here as a
 * GET with `token_hash` + `type` (+ our own `next`), or with `error*` params
 * when it already rejected the token upstream.
 *
 * Contract: 307 to the sanitized `next` on success (session cookie set by
 * verifyOtp), 307 to "/" on every failure. Never returns JSON.
 */
export async function GET(request: NextRequest) {
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url))

  try {
    const params = request.nextUrl.searchParams
    const next = safeNextPath(params.get("next"))

    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return redirectTo("/")
    }

    // Supabase already failed the verification and appended its error context.
    // Do not attempt verifyOtp with a token it has invalidated.
    if (params.get("error") || params.get("error_code") || params.get("error_description")) {
      return redirectTo("/")
    }

    const tokenHash = params.get("token_hash")?.trim() ?? ""
    const token = params.get("token")?.trim() ?? ""
    const email = params.get("email")?.trim() ?? ""
    const type = parseOtpType(params.get("type"))

    // Malformed / bare visit to /callback: bounce home instead of throwing.
    if (!tokenHash && !token) {
      return redirectTo("/")
    }
    if (!tokenHash && !email) {
      return redirectTo("/")
    }

    const supabase = await createClient()

    // verifyOtp hits POST /auth/v1/verify AND persists the session via cookies,
    // which Next attaches to the redirect response below.
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.verifyOtp({ type, token, email })

    if (error) {
      return redirectTo("/")
    }

    return redirectTo(next)
  } catch {
    return redirectTo("/")
  }
}