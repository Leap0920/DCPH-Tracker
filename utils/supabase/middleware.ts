import "server-only"
import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import type { Database } from "@/types/database.types"
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env"
import { applySecurityHeaders, copyCookies } from "@/lib/security-headers"

const PROTECTED_PATHS = [
  "/tracker",
  "/settings",
  "/community/chat",
  "/admin",
  "/analytics",
  "/favorites",
] as const

/** Routes a suspended account loses access to. */
const SUSPENDED_BLOCKED_PATHS = ["/community/chat", "/admin"] as const

/** Where suspended / non-admin users are sent. Must NOT be blocked for them. */
const FALLBACK_PATH = "/tracker"

const isProd = process.env.NODE_ENV === "production"

/**
 * Refreshes the auth session on every matched request, applies security
 * headers (CSP nonce), and gates protected routes.
 *
 * Gating here is UX only — a valid token still works directly against
 * Supabase from the browser. Ban/suspend must ALSO be enforced by RLS.
 */
export async function updateSession(
  request: NextRequest,
  security: { nonce: string; csp: string }
) {
  /**
   * Built fresh on each call so it picks up cookies written by
   * `request.cookies.set()` inside setAll (NextRequest.cookies mutations
   * write through to the underlying `cookie` header).
   */
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers)
    headers.set("x-nonce", security.nonce)
    // Next.js reads the CSP from the *request* header and automatically
    // attaches the nonce to its own inline scripts and preload links.
    headers.set("Content-Security-Policy", security.csp)
    return headers
  }

  const nextResponse = () =>
    NextResponse.next({ request: { headers: forwardedHeaders() } })

  let supabaseResponse = nextResponse()

  const supabase = createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // httpOnly is intentionally NOT set: createBrowserClient reads the
          // session from document.cookie, so an httpOnly token would log the
          // client out on every navigation and break Realtime auth.
          // The compensating control is the nonce-based CSP set above —
          // if that CSP is ever removed, this cookie becomes XSS-readable
          // with no mitigation.
          const hardened = {
            secure: isProd,
            sameSite: "lax" as const, // 'strict' breaks OAuth/magic-link callbacks
            path: "/",
          }
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = nextResponse()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              ...hardened,
            })
          )
        },
      },
    }
  )

  /**
   * Builds a redirect that PRESERVES cookies Supabase wrote during this
   * request. Returning a bare NextResponse.redirect() drops them.
   */
  const redirectTo = (
    pathname: string,
    params: Record<string, string> = {}
  ) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ""
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    // Guard against redirecting a request to itself (infinite loop).
    if (
      url.pathname === request.nextUrl.pathname &&
      url.search === request.nextUrl.search
    ) {
      return finalize(supabaseResponse)
    }

    const response = NextResponse.redirect(url)
    copyCookies(supabaseResponse, response)
    response.headers.set("Cache-Control", "private, no-store")
    return applySecurityHeaders(response, security.csp)
  }

  const finalize = (response: NextResponse) =>
    applySecurityHeaders(response, security.csp)

  // IMPORTANT: no logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // API routes authenticate themselves; skip the profile round trips but
  // still return the refreshed-session response above.
  if (pathname.startsWith("/api/")) {
    return finalize(supabaseResponse)
  }

  const isProtected = PROTECTED_PATHS.some((path) => pathname.startsWith(path))

  if (isProtected && !user) {
    return redirectTo("/", { auth: "signin" })
  }

  if (isProtected && user) {
    // Single query: status AND role. Previously /admin queried profiles twice.
    // maybeSingle() so a missing row is `null` rather than an error.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("status, role")
      .eq("user_id", user.id)
      .maybeSingle()

    // Fail-open if the status column hasn't been migrated yet. Once the
    // migration has shipped, consider treating an error as a hard failure —
    // as written, a transient DB error grants access.
    if (!profileError && profile) {
      const status = profile.status ?? "active"

      if (status === "banned") {
        const response = redirectTo("/", {
          auth: "signin",
          error: "banned",
        })
        // Revoke server-side and clear local cookies. Without this the user
        // keeps a live token and can query Supabase directly from the browser.
        try {
          await supabase.auth.signOut()
        } catch {
          // Best effort: cookie clearing below still logs them out locally.
        }
        for (const cookie of request.cookies.getAll()) {
          if (cookie.name.startsWith("sb-")) {
            response.cookies.set(cookie.name, "", {
              path: "/",
              maxAge: 0,
              secure: isProd,
              sameSite: "lax",
            })
          }
        }
        return response
      }

      if (
        status === "suspended" &&
        SUSPENDED_BLOCKED_PATHS.some((p) => pathname.startsWith(p))
      ) {
        return redirectTo(FALLBACK_PATH, { error: "suspended" })
      }

      // Admin area additionally requires the 'admin' role. Fails closed:
      // a null profile or missing role redirects away.
      if (pathname.startsWith("/admin") && profile.role !== "admin") {
        return redirectTo(FALLBACK_PATH, { error: "admin_only" })
      }
    } else if (pathname.startsWith("/admin")) {
      // Never fail open on the admin area, even during a migration window.
      return redirectTo(FALLBACK_PATH, { error: "admin_only" })
    }

    // Personalized HTML must never be cached by a CDN or shared proxy.
    supabaseResponse.headers.set("Cache-Control", "private, no-store")
  }

  return finalize(supabaseResponse)
}