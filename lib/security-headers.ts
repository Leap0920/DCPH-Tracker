import type { NextRequest, NextResponse } from "next/server"
import { SUPABASE_HOST } from "./env"

/**
 * True when the request actually arrived over HTTPS — either directly, or
 * via a TLS terminator that sets x-forwarded-proto (tailscale serve does).
 *
 * Drives `upgrade-insecure-requests` and HSTS in security-headers.ts: both
 * promise the browser "this host is HTTPS". Emitting them from a plain-HTTP
 * host (e.g. http://<tailscale-ip>:3210) breaks ALL asset loading on that
 * host while http://localhost keeps working (localhost is exempt as a
 * potentially-trustworthy origin) — the exact "works on localhost, broken
 * via IP" bug this flag fixes.
 */
export function isHttpsRequest(request: NextRequest): boolean {
  // NOTE: do NOT use request.nextUrl.protocol here — under `next start` it
  // reports "https:" even for plain-HTTP requests (Next normalizes the
  // internal URL), which silently re-enables the very bug this flag fixes.
  // The only trustworthy signal is the TLS terminator's forwarded header:
  // `tailscale serve`, nginX, etc. all set x-forwarded-proto.
  const fwd = request.headers.get("x-forwarded-proto") ?? ""
  return fwd.split(",")[0].trim() === "https"
}

/**
 * Builds a nonce-based Content-Security-Policy.
 *
 * `strict-dynamic` lets Next.js's nonced bootstrap scripts load the rest of
 * the bundle without enumerating every chunk URL. `'self'` is kept purely as
 * a fallback for CSP2-only browsers (CSP3 browsers ignore it once
 * strict-dynamic is present).
 *
 * style-src keeps 'unsafe-inline': Next/React inject inline style attributes
 * and Tailwind's runtime-injected styles have no stable hash. Inline CSS is a
 * far weaker vector than inline JS, so this is a deliberate tradeoff.
 */
export function buildCsp(
  nonce: string,
  /**
   * True only when the page is actually served over HTTPS.
   *
   * `upgrade-insecure-requests` upgrades every http:// SUBRESOURCE of the
   * page to https://. On a real HTTPS deployment that is defense-in-depth;
   * on a plain-HTTP host (e.g. dev/test serving over a tailnet IP) it is
   * catastrophic: the HTML loads but every CSS/JS asset is silently
   * rewritten to https://, fails (no TLS listener), and the page renders
   * completely unstyled — while http://localhost keeps working because
   * localhost is a "potentially trustworthy origin" and is exempt. That
   * asymmetry made the breakage look like a phone/PC-only bug.
   */
  https = false
): string {
  const isDev = process.env.NODE_ENV !== "production"
  const httpOrigin = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : ""
  const wsOrigin = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : ""

  // Dev relaxes script-src: Next's dev runtime injects unnonced inline
  // scripts (React Refresh, HMR bootstrap) that a nonce policy blocks —
  // and a blocked inline runtime cascades into blocked lazy chunks.
  // 'unsafe-inline' is meaningless next to a nonce anyway (the spec ignores
  // it when a nonce is present), so dev drops the nonce entirely.
  // Production keeps the strict nonce + strict-dynamic policy unchanged.
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`

  const directives = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https: ${httpOrigin}`,
    `font-src 'self' data:`,
    `connect-src 'self' ${httpOrigin} ${wsOrigin}${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
    `media-src 'self' ${httpOrigin}`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ]

  // UIR only makes sense on an HTTPS-served page — see param doc above.
  if (!isDev && https) directives.push("upgrade-insecure-requests")

  return directives
    .map((d) => d.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("; ")
}

/**
 * Set to true for the first deploy: violations are reported to the console
 * but nothing is blocked. Flip to false once the browser console is clean.
 */
const CSP_REPORT_ONLY = process.env.CSP_REPORT_ONLY === "true"

export function applySecurityHeaders(
  response: NextResponse,
  csp: string,
  /**
   * True only when the request actually arrived over HTTPS. HSTS tells the
   * browser to refuse plain HTTP for this host for `max-age` — sending it
   * from an HTTP-only host poisons the browser's cache and, on some
   * browsers/versions, upgrades later navigations to https:// that nothing
   * answers (RFC 6797 exempts IP hosts, but not every client honors that
   * the same way). Only promise HTTPS when we ARE HTTPS.
   */
  https = false
): NextResponse {
  response.headers.set(
    CSP_REPORT_ONLY
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    csp
  )
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  )
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  if (process.env.NODE_ENV === "production" && https) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    )
  }
  return response
}

/**
 * Carries Set-Cookie headers from one response onto another.
 *
 * REQUIRED whenever middleware returns a redirect instead of the response
 * Supabase wrote its refreshed cookies to. Without this, a token rotation
 * that coincides with a redirect is silently discarded and the client
 * replays a consumed refresh token, producing random logouts.
 */
export function copyCookies(
  from: NextResponse,
  to: NextResponse
): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie)
  }
  return to
}