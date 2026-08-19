import type { NextRequest } from "next/server"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Origin check for ROUTE HANDLERS.
 *
 * Server Actions get an Origin/Host check from Next.js automatically;
 * route handlers do not. sameSite=lax already blocks cross-site POST, but
 * lax DOES send cookies on top-level cross-site GET navigations — so any
 * GET handler that mutates state is CSRF-able. Audit for those; they should
 * become POST.
 *
 * Fails closed on a missing Origin, which also blocks non-browser callers
 * (e.g. Vercel Cron). Authenticate those with a shared secret instead of
 * exempting them from this check.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true

  const origin = request.headers.get("origin")
  if (!origin) return false

  const allowed = new Set<string>()
  const host = request.headers.get("host")
  if (host) {
    allowed.add(`https://${host}`)
    if (process.env.NODE_ENV !== "production") allowed.add(`http://${host}`)
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin)
    } catch {
      // Ignore a malformed configured URL.
    }
  }

  return allowed.has(origin)
}