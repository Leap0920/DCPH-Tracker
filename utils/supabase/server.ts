import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/types/database.types"
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env"

const isProd = process.env.NODE_ENV === "production"

/**
 * Call inside Server Components / Server Actions / Route Handlers.
 * Each call reads the current cookie store, so session state stays in sync
 * with middleware-refreshed tokens.
 */
export const createClient = async () => {
  const cookieStore = await cookies()

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          // httpOnly intentionally unset — see utils/supabase/middleware.ts
          // for the full rationale and the compensating CSP control.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              secure: isProd,
              sameSite: "lax",
              path: "/",
            })
          )
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. Safe to ignore: middleware refreshes every request.
        }
      },
    },
  })
}