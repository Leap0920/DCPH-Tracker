import "server-only"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { SUPABASE_URL } from "@/lib/env"

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Creates a Supabase client authenticated with the service-role key.
 *
 * BYPASSES Row Level Security. Server-side trusted code only.
 *
 * The `server-only` import above turns an accidental client-component
 * import into a BUILD error rather than a leaked service-role key.
 * The runtime guard is a second line of defence for any code path that
 * bypasses the bundler boundary.
 *
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is unset so callers fail
 * gracefully instead of silently using an under-privileged client.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "[security] createAdminClient() was reached in a browser context. " +
        "This must never happen — audit the import chain immediately."
    )
  }

  if (!serviceRoleKey) return null

  return createSupabaseClient<Database>(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}