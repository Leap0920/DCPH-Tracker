import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Creates a Supabase client authenticated with the service-role key.
 *
 * This BYPASSES Row Level Security and must ONLY be used in trusted
 * server-side code (e.g. the cron-triggered /api/sync route). Never
 * import this into a client component or expose the key to the browser.
 *
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is not configured, so callers
 * can fail gracefully instead of silently using an under-privileged client.
 */
export function createAdminClient() {
  if (!serviceRoleKey) return null;

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
