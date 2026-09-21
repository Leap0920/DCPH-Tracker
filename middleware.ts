import { type NextRequest } from "next/server"
import { updateSession } from "@/utils/supabase/middleware"
import { buildCsp, isHttpsRequest } from "@/lib/security-headers"

export async function middleware(request: NextRequest) {
  // Per-request nonce. crypto.randomUUID is available in the Edge runtime.
  const nonce = crypto.randomUUID().replace(/-/g, "")
  const https = isHttpsRequest(request)
  return await updateSession(request, { nonce, csp: buildCsp(nonce, https) })
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets, and well-known files.
    // NOTE: /api/* IS matched, so API requests still get their session
    // refreshed — but updateSession skips the profile lookups for them.
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$).*)",
  ],
}