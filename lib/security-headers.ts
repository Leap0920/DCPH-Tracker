import type { NextResponse } from "next/server"
import { SUPABASE_HOST } from "./env"

/**
 * Builds a nonce-based Content-Security-Policy.
 *
 * script-src is `'self' 'nonce-…'` and deliberately does NOT carry
 * `'strict-dynamic'`. Under strict-dynamic a CSP3 browser ignores `'self'`
 * entirely, and every script must then be vouched for by a nonce — which Next
 * cannot do for the chunks it loads at runtime: its webpack runtime ships
 * `__webpack_require__.nc = undefined`, so the `<script>` that
 * `__webpack_require__.l` appends to `document.head` carries no nonce. Measured
 * on this app against a production build on both next 15.1.11 (the version in
 * the installed tree) and 15.5.26 (the version the lockfile pins): with
 * strict-dynamic present the on-demand chunks were blocked — `script-src-elem`
 * violations for `_app-pages-browser_components_auth_AuthModal_tsx.js` in dev
 * and for the hashed chunk files in production, all `blockedReason=csp`, 2
 * chunks per page load never arriving. Dropping the directive lets `'self'`
 * cover same-origin script elements again and the chunks load. Inline scripts
 * still require the per-request nonce, which is the part that matters:
 * `nosniff` is set on every response, so a same-origin URL cannot be replayed
 * as script.
 *
 * style-src keeps 'unsafe-inline': Next/React inject inline style attributes
 * and Tailwind's runtime-injected styles have no stable hash. Inline CSS is a
 * far weaker vector than inline JS, so this is a deliberate tradeoff.
 */
export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production"
  const httpOrigin = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : ""
  const wsOrigin = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : ""

  const directives = [
    `default-src 'self'`,
    // 'unsafe-eval' is required by React Fast Refresh in dev only.
    `script-src 'self' 'nonce-${nonce}' ${isDev ? "'unsafe-eval'" : ""}`,
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

  if (!isDev) directives.push("upgrade-insecure-requests")

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

/**
 * Sets the security headers that must be per-request (the CSP) or that the
 * middleware is the single source of truth for. Anything set in both
 * next.config.ts and here would be duplicated, and the config's copy wins in
 * the Node runtime — so the config carries only the headers that must also
 * reach static assets (see the comment there).
 */
export function applySecurityHeaders(
  response: NextResponse,
  csp: string
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
  if (process.env.NODE_ENV === "production") {
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