import { createClient } from "@/utils/supabase/client"

export interface SiteStats {
  totalVisits: number | null
  activeNow: number | null
  trackedEpisodes: number | null
}

// The site-stats RPCs (`record_visit`, `heartbeat`, `get_site_stats`) are
// added by supabase/migration-site-stats.sql; the combined single-call
// variants (`record_visit_and_get_stats`, `heartbeat_and_get_stats`) by
// supabase/migration-site-stats-single-call.sql. None of them are in
// database.types.ts (generated), so fn names are cast to `never` to get
// past the typed-rpc generic. Safe: PostgREST still maps the string name.
//
// Why the combined calls: every RPC is a logged PostgREST request against
// the Supabase log-ingestion quota, and these run on the homepage for every
// visitor plus once a minute per open tab. One request beats two; until the
// migration is applied the code falls back to the original pair.

const NULL_STATS: SiteStats = {
  totalVisits: null,
  activeNow: null,
  trackedEpisodes: null,
}

/** Unwrap a `returns table` RPC payload (PostgREST embeds the row in an array). */
function rowToStats(data: unknown): SiteStats {
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return NULL_STATS
  const r = row as {
    total_visits?: number
    active_now?: number
    tracked_episodes?: number
  }
  const tv = Number(r.total_visits)
  const an = Number(r.active_now)
  const te = Number(r.tracked_episodes)
  return {
    totalVisits: Number.isFinite(tv) ? tv : null,
    activeNow: Number.isFinite(an) ? an : null,
    trackedEpisodes: Number.isFinite(te) ? te : null,
  }
}

/**
 * record_visit() + get_site_stats() in one request when the combined RPC
 * exists; the original two calls otherwise. Null-safe pre-migration
 * (PGRST202): returns nulls on any failure so the hero renders nothing.
 */
export async function recordVisitAndGetStats(): Promise<SiteStats> {
  const supabase = createClient()

  try {
    const single = await supabase.rpc("record_visit_and_get_stats" as never)
    if (!single.error) return rowToStats(single.data)

    const { data: totalData, error: totalError } = await supabase.rpc(
      "record_visit" as never
    )
    const { data: statsData, error: statsError } = await supabase.rpc(
      "get_site_stats" as never
    )
    // PostgREST surfaces RPC failures in the response `error` field, not as
    // a throw — a missing function pre-migration is PGRST202, so bail to
    // nulls there too (prevents rendering a bogus "0 all-time visits").
    if (totalError || statsError) return NULL_STATS
    // PostgREST `returns table` RPCs come back as an array even for a single
    // row — unwrap it so callers can read total_visits/active_now directly.
    const tv = Number(totalData)
    const row = Array.isArray(statsData) ? statsData[0] : statsData
    const an = row ? Number((row as { active_now?: number }).active_now) : null
    const te = row
      ? Number((row as { tracked_episodes?: number }).tracked_episodes)
      : null
    return {
      totalVisits: typeof tv === "number" && Number.isFinite(tv) ? tv : null,
      activeNow: an != null && Number.isFinite(an) ? an : null,
      trackedEpisodes: te != null && Number.isFinite(te) ? te : null,
    }
  } catch {
    return NULL_STATS
  }
}

/**
 * heartbeat() keeps the current session alive, then refreshes the counters —
 * one request total when the combined RPC exists. Null-safe either way.
 */
export async function heartbeatAndGetStats(
  sessionId: string,
  userId: string | null
): Promise<SiteStats> {
  const supabase = createClient()

  try {
    const single = await supabase.rpc("heartbeat_and_get_stats" as never, {
      p_session_id: sessionId,
      p_user_id: userId,
    } as never)
    if (!single.error) return rowToStats(single.data)

    const { error: heartbeatError } = await supabase.rpc("heartbeat" as never, {
      p_session_id: sessionId,
      p_user_id: userId,
    } as never)
    const { data: statsData, error: statsError } = await supabase.rpc(
      "get_site_stats" as never
    )
    if (heartbeatError || statsError) return NULL_STATS
    const row = Array.isArray(statsData) ? statsData[0] : statsData
    const tv = row ? Number((row as { total_visits?: number }).total_visits) : null
    const an = row ? Number((row as { active_now?: number }).active_now) : null
    const te = row
      ? Number((row as { tracked_episodes?: number }).tracked_episodes)
      : null
    return {
      totalVisits: tv != null && Number.isFinite(tv) ? tv : null,
      activeNow: an != null && Number.isFinite(an) ? an : null,
      trackedEpisodes: te != null && Number.isFinite(te) ? te : null,
    }
  } catch {
    return NULL_STATS
  }
}
