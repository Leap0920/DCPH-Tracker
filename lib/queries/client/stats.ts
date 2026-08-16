import { createClient } from "@/utils/supabase/client"

export interface SiteStats {
  totalVisits: number | null
  activeNow: number | null
}

// The site-stats RPCs (`record_visit`, `heartbeat`, `get_site_stats`) are
// added by supabase/migration-site-stats.sql and are not yet in
// database.types.ts (generated), so the fn name is cast to `never` to get
// past the typed-rpc generic. Safe: PostgREST still maps the string name.

/**
 * record_visit() + get_site_stats(); null-safe pre-migration (PGRST202).
 * Returns nulls on ANY failure so the hero renders nothing until the
 * migration is applied (fetchContentRating precedent).
 */
export async function recordVisitAndGetStats(): Promise<SiteStats> {
  const supabase = createClient()

  try {
    const { data: totalData, error: totalError } = await supabase.rpc(
      "record_visit" as never
    )
    const { data: statsData, error: statsError } = await supabase.rpc(
      "get_site_stats" as never
    )
    // PostgREST surfaces RPC failures in the response `error` field, not as
    // a throw — a missing function pre-migration is PGRST202, so bail to
    // nulls there too (prevents rendering a bogus "0 all-time visits").
    if (totalError || statsError) return { totalVisits: null, activeNow: null }
    // PostgREST `returns table` RPCs come back as an array even for a single
    // row — unwrap it so callers can read total_visits/active_now directly.
    const row = Array.isArray(statsData) ? statsData[0] : statsData
    return {
      totalVisits: Number(totalData) ?? null,
      activeNow: row ? Number((row as { active_now?: number }).active_now) : null,
    }
  } catch {
    return { totalVisits: null, activeNow: null }
  }
}

/**
 * heartbeat() keeps the current session alive, then get_site_stats() refreshes
 * both counters. Null-safe pre-migration, same as recordVisitAndGetStats.
 */
export async function heartbeatAndGetStats(
  sessionId: string,
  userId: string | null
): Promise<SiteStats> {
  const supabase = createClient()

  try {
    const { error: heartbeatError } = await supabase.rpc("heartbeat" as never, {
      p_session_id: sessionId,
      p_user_id: userId,
    } as never)
    const { data: statsData, error: statsError } = await supabase.rpc(
      "get_site_stats" as never
    )
    if (heartbeatError || statsError) return { totalVisits: null, activeNow: null }
    const row = Array.isArray(statsData) ? statsData[0] : statsData
    return {
      totalVisits: row ? Number((row as { total_visits?: number }).total_visits) : null,
      activeNow: row ? Number((row as { active_now?: number }).active_now) : null,
    }
  } catch {
    return { totalVisits: null, activeNow: null }
  }
}
