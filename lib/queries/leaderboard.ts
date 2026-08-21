import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"
import { getDetectiveRank } from "@/lib/ranks"
import { PUBLIC_PROFILE_COLUMNS } from "@/lib/queries/profile"
import { fetchPeriodTotals } from "@/lib/queries/leaderboard-events"
import { MOVIE_TYPE, zeroPeriodTotals } from "@/lib/leaderboard-periods"

type ContentRef = { runtime_minutes: number | null; type: string | null }

type WatchStatusRow = {
  user_id: string
  status: string
  watch_count: number | null
  content_entries: ContentRef | null
}

type WatchCountRow = {
  user_id: string
  content_entries: { runtime_minutes: number | null } | null
}

export interface RankingRow {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null

  /** All-time: distinct entries with status watched/rewatched. */
  watched_count: number
  /** All-time: summed runtime of those entries. */
  total_minutes: number
  rewatched_count: number
  total_views: number
  /** All-time: entries of type 'movie'. Real, computed from content_entries.type. */
  movie_count: number

  /**
   * Rolling-window totals from watch_events. These replaced the client-side
   * multipliers in RankingsBoard (watched_count * 0.28 for "month", * 0.08 for
   * "week"), which were invented fractions of the all-time number.
   *
   * Windows are ROLLING (last 30 / last 7 days), not calendar periods: a calendar
   * month leaves the board near-empty for the first days of every month, which
   * reads as the same bug returning.
   *
   * All zero until supabase/migration-watch-events.sql is applied — the fetch
   * soft-fails so the page still renders. They also stay zero for activity that
   * predates the migration unless its optional backfill step was run.
   */
  month_count: number
  month_minutes: number
  month_movie_count: number
  week_count: number
  week_minutes: number
  week_movie_count: number

  /** Career title. Always all-time, on every tab. */
  detectiveRank: { title: string; level: number }
  /** All-time rank. The client recomputes rank per tab from the period fields. */
  rank: number
}

/**
 * Computes the leaderboard live from base tables (no reliance on the
 * materialized view, which can go stale). All-time figures come from
 * watch_status; rolling-window figures come from the watch_events log.
 */
export async function getRankings(limit = 100): Promise<RankingRow[]> {
  const supabase = createAdminClient() ?? (await createClient())

  // PostgREST caps each request at 1,000 rows; paginate so the leaderboard
  // stays correct once the community has more than 1,000 watch rows.
  const PAGE_SIZE = 1000
  const watched: WatchStatusRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("watch_status")
      // `type` is new here: it makes the Movies category real. It was previously
      // estimated client-side as watched_count / 15.
      .select("user_id, status, watch_count, content_entries(runtime_minutes, type)")
      .in("status", ["watched", "rewatched"])
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    watched.push(...(chunk as WatchStatusRow[]))
    if (chunk.length < PAGE_SIZE) break
  }

  const agg = new Map<
    string,
    { count: number; minutes: number; rewatched: number; views: number; movies: number }
  >()
  for (const row of watched) {
    const uid = row.user_id
    const rel = row.content_entries as ContentRef | null
    const mins = rel?.runtime_minutes ?? 0
    const cur =
      agg.get(uid) ?? { count: 0, minutes: 0, rewatched: 0, views: 0, movies: 0 }
    cur.count += 1
    cur.minutes += mins
    if (row.status === "rewatched") cur.rewatched += 1
    cur.views += row.watch_count ?? 0
    if (rel?.type === MOVIE_TYPE) cur.movies += 1
    agg.set(uid, cur)
  }

  // Rolling-window totals. SOFT-FAILS BY DESIGN: if watch_events does not exist
  // yet (migration not applied) or its read errors, the period tabs show zeros
  // rather than taking down the whole rankings page. The all-time board is the
  // primary view and must never depend on the event log.
  let periods = new Map<string, ReturnType<typeof zeroPeriodTotals>>()
  try {
    periods = await fetchPeriodTotals(supabase as unknown as SupabaseClient)
  } catch (error) {
    console.error("[leaderboard] period totals unavailable, falling back to zeros", error)
  }

  // Union, not just agg.keys(): a user who watched something recently and has
  // since set it back to unwatched has events in the window but no qualifying
  // watch_status row. They belong on the period boards.
  const userIds = [...new Set([...agg.keys(), ...periods.keys()])]
  if (userIds.length === 0) return []

  // Prefer the public_profiles security-definer view (anon-safe, safe columns
  // only); fall back to the base table with safe columns if the migration has
  // not been applied yet. Never select("*") — the base table holds PII.
  type ProfileRef = Database["public"]["Views"]["public_profiles"]["Row"]

  const viewQuery = await supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .in("user_id", userIds)

  let profiles: ProfileRef[] | null = null

  if (viewQuery.error) {
    const baseQuery = await supabase
      .from("profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .in("user_id", userIds)
    if (baseQuery.error) throw baseQuery.error
    profiles = baseQuery.data
  } else {
    profiles = viewQuery.data
  }

  const rows: RankingRow[] = (profiles ?? [])
    .map((p) => {
      const a =
        agg.get(p.user_id) ?? { count: 0, minutes: 0, rewatched: 0, views: 0, movies: 0 }
      const period = periods.get(p.user_id) ?? zeroPeriodTotals()
      const detectiveRank = getDetectiveRank(a.count)
      return {
        user_id: p.user_id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        watched_count: a.count,
        total_minutes: a.minutes,
        rewatched_count: a.rewatched,
        total_views: a.views,
        movie_count: a.movies,
        month_count: period.month.count,
        month_minutes: period.month.minutes,
        month_movie_count: period.month.movieCount,
        week_count: period.week.count,
        week_minutes: period.week.minutes,
        week_movie_count: period.week.movieCount,
        detectiveRank: { title: detectiveRank.title, level: detectiveRank.level },
        rank: 0,
      }
    })
    // Drop profiles that contribute nothing to any tab (the unwatched-everything
    // case above, once its events age out of the 30-day window).
    .filter((r) => r.watched_count > 0 || r.month_count > 0)

  const ranked = rows
    .sort(
      (x, y) =>
        y.watched_count - x.watched_count || y.total_minutes - x.total_minutes
    )
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const kept = ranked.slice(0, limit)

  // A newcomer can top the 7-day board while sitting far below `limit` all-time.
  // Slicing on all-time order alone would hide them from the period tabs, so pull
  // in the top period performers who missed the cut. Their `rank` stays their
  // all-time rank; the client renumbers per tab.
  if (ranked.length > kept.length) {
    const keptIds = new Set(kept.map((r) => r.user_id))
    const periodExtras = ranked
      .filter((r) => !keptIds.has(r.user_id) && r.month_count > 0)
      .sort(
        (x, y) =>
          y.month_count - x.month_count || y.month_minutes - x.month_minutes
      )
      .slice(0, limit)
    kept.push(...periodExtras)
  }

  return kept
}

/**
 * Global rank (1-based) for a single user, counting everyone whose
 * (watched_count, total_minutes) sorts strictly above. Mirrors
 * getRankings' ALL-TIME ordering: watched_count desc, then total_minutes desc.
 * Returns null when the user has no watch rows or the provided counts
 * no longer match the live data.
 *
 * Deliberately all-time only. The "Your Standing" card that consumes this must
 * be labelled "All-time" so it does not appear to contradict a period tab.
 */
export async function getUserGlobalRank(
  userId: string,
  watchedCount: number,
  minutes: number
): Promise<number | null> {
  const supabase = createAdminClient() ?? (await createClient())

  // PostgREST caps each request at 1,000 rows; paginate so the global rank
  // stays correct once the community has more than 1,000 watch rows.
  const PAGE_SIZE = 1000
  const watched: WatchCountRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("watch_status")
      .select("user_id, content_entries(runtime_minutes)")
      .in("status", ["watched", "rewatched"])
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    watched.push(...(chunk as WatchCountRow[]))
    if (chunk.length < PAGE_SIZE) break
  }
  if (watched.length === 0) return null

  const counts = new Map<string, number>()
  const minutesByUser = new Map<string, number>()
  for (const row of watched) {
    const uid = row.user_id
    const rel = row.content_entries as { runtime_minutes: number | null } | null
    const mins = rel?.runtime_minutes ?? 0
    counts.set(uid, (counts.get(uid) ?? 0) + 1)
    minutesByUser.set(uid, (minutesByUser.get(uid) ?? 0) + mins)
  }

  if ((counts.get(userId) ?? 0) !== watchedCount) return null

  let above = 0
  for (const [uid, c] of counts) {
    if (c > watchedCount) above++
    else if (c === watchedCount && (minutesByUser.get(uid) ?? 0) > minutes) above++
  }
  return above + 1
}
