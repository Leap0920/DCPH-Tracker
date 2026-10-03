import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"
import { getDetectiveRank } from "@/lib/ranks"
import { defaultRuntimeMinutes } from "@/lib/runtime-defaults"
import { PUBLIC_PROFILE_COLUMNS } from "@/lib/queries/profile"
import { fetchPeriodTotals } from "@/lib/queries/leaderboard-events"
import { EPISODE_TYPE, MOVIE_TYPE, zeroPeriodTotals } from "@/lib/leaderboard-periods"

type ContentRef = { runtime_minutes: number | null; type: string | null }

type WatchStatusRow = {
  user_id: string
  status: string
  watch_count: number | null
  content_entries: ContentRef | null
}

type WatchCountRow = {
  user_id: string
  watch_count: number | null
  content_entries: ContentRef | null
}

/**
 * Minutes to credit a watched entry. Falls back to the entry's type default when
 * the row has no runtime, so this board and the period tabs (which use the same
 * fallback via lib/leaderboard-periods.ts) can never report two different watch
 * times for the same user.
 */
function entryMinutes(rel: ContentRef | null): number {
  const stored = rel?.runtime_minutes
  if (typeof stored === "number" && stored > 0) return stored
  return defaultRuntimeMinutes(rel?.type ?? "")
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
  /** All-time: entries of type 'episode'. The Episodes category ranks on this. */
  episode_count: number

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
  month_episode_count: number
  week_count: number
  week_minutes: number
  week_movie_count: number
  week_episode_count: number

  /** Career title. Always all-time, on every tab. */
  detectiveRank: { title: string; level: number }
  /** All-time rank. The client recomputes rank per tab from the period fields. */
  rank: number
}

/** One row of the get_leaderboard RPC (supabase/migration-leaderboard-rpc.sql). */
type LeaderboardRpcRow = {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  watched_count: number
  total_minutes: number | string
  rewatched_count: number
  total_views: number | string
  movie_count: number
  episode_count: number
  month_count: number
  month_minutes: number | string
  month_movie_count: number
  month_episode_count: number
  week_count: number
  week_minutes: number | string
  week_movie_count: number
  week_episode_count: number
  rank: number
}

// The leaderboard RPC is added by supabase/migration-leaderboard-rpc.sql and is
// not in database.types.ts (generated), so the name is cast to `never` to get
// past the typed-rpc generic — the same trick lib/queries/client/stats.ts uses
// for the site-stats RPCs. PostgREST still maps the string name.
const LEADERBOARD_RPC = "get_leaderboard"
/** PostgREST's "function not found" — the migration has not been applied. */
const MISSING_FUNCTION = "PGRST202"

/** bigint columns can arrive as strings through PostgREST, so coerce them all. */
function toRankingRow(row: LeaderboardRpcRow): RankingRow {
  const detectiveRank = getDetectiveRank(row.watched_count)
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    watched_count: Number(row.watched_count),
    total_minutes: Number(row.total_minutes),
    rewatched_count: Number(row.rewatched_count),
    total_views: Number(row.total_views),
    movie_count: Number(row.movie_count),
    episode_count: Number(row.episode_count),
    month_count: Number(row.month_count),
    month_minutes: Number(row.month_minutes),
    month_movie_count: Number(row.month_movie_count),
    month_episode_count: Number(row.month_episode_count),
    week_count: Number(row.week_count),
    week_minutes: Number(row.week_minutes),
    week_movie_count: Number(row.week_movie_count),
    week_episode_count: Number(row.week_episode_count),
    detectiveRank: { title: detectiveRank.title, level: detectiveRank.level },
    rank: Number(row.rank),
  }
}

/**
 * The leaderboard: the get_leaderboard RPC when it exists, the old paging path
 * otherwise.
 *
 * Why the RPC: the paging path reads the whole watch_status table (145,810 rows
 * ÷ PostgREST's 1,000-row cap = 146 serial requests) and the whole 30-day
 * watch_events window (another ~149 requests), then aggregates ~50 MB of JSON
 * in the serverless function — /community/rankings measured 187 seconds to
 * finish loading. The RPC returns a few hundred rows in one request.
 *
 * The paging path is kept as a pre-migration fallback (PGRST202) so this file
 * can ship before — or without — the migration. Once
 * supabase/migration-leaderboard-rpc.sql is applied everywhere, the fallback can
 * be deleted along with lib/queries/leaderboard-events.ts.
 */
export async function getRankings(limit = 100): Promise<RankingRow[]> {
  const supabase = createAdminClient() ?? (await createClient())

  const { data, error } = await supabase.rpc(LEADERBOARD_RPC as never, {
    p_limit: limit,
  } as never)

  if (!error) {
    return ((data ?? []) as unknown as LeaderboardRpcRow[]).map(toRankingRow)
  }
  if (error.code !== MISSING_FUNCTION) throw error

  return getRankingsByPaging(limit)
}

/**
 * One user's board row, for the "Your Standing" card when they are not on the
 * returned page. p_limit 0 makes the RPC return only the caller's row, so this
 * is one cheap request rather than a second full read of watch_status — which
 * is what the page used to do, doubling the cost for anyone outside the top 100.
 */
export async function getUserRankRow(userId: string): Promise<RankingRow | null> {
  const supabase = createAdminClient() ?? (await createClient())

  const { data, error } = await supabase.rpc(LEADERBOARD_RPC as never, {
    p_limit: 0,
    p_user_id: userId,
  } as never)

  if (!error) {
    const rows = (data ?? []) as unknown as LeaderboardRpcRow[]
    return rows.length > 0 ? toRankingRow(rows[0]) : null
  }
  if (error.code !== MISSING_FUNCTION) throw error

  return getUserRankRowByPaging(userId)
}

/**
 * PRE-MIGRATION FALLBACK — delete with getRankingsByPaging.
 *
 * Behaviour is identical to the block this replaced in
 * app/(app)/community/rankings/page.tsx: the period figures are not fetched on
 * this path, so the standing card is all-time only.
 */
async function getUserRankRowByPaging(userId: string): Promise<RankingRow | null> {
  const supabase = createAdminClient() ?? (await createClient())

  const [watchResult, profileResult] = await Promise.all([
    supabase
      .from("watch_status")
      .select("user_id, status, watch_count, content_entries(runtime_minutes, type)")
      .in("status", ["watched", "rewatched"])
      .eq("user_id", userId),
    supabase
      .from("profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .eq("user_id", userId)
      .single(),
  ])

  const watched = watchResult.data as WatchStatusRow[] | null
  const profile = profileResult.data
  if (!watched || watched.length === 0 || !profile) return null

  const count = watched.length
  const rewatched = watched.filter((w) => w.status === "rewatched").length
  const views = watched.reduce((acc, w) => acc + (w.watch_count ?? 0), 0)
  // Same fallback and the same floor-of-one view rule getRankings uses, so the
  // rank this compares against is the rank the board would give the same
  // numbers — including the rewatch multiplier.
  const minutes = watched.reduce(
    (acc, w) =>
      acc + entryMinutes(w.content_entries as ContentRef | null) * Math.max(w.watch_count ?? 0, 1),
    0
  )
  const entries = watched.map((w) => w.content_entries as ContentRef | null)
  const globalRank = await getUserGlobalRank(userId, count, minutes)
  const detectiveRank = getDetectiveRank(count)

  return {
    user_id: userId,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    watched_count: count,
    total_minutes: minutes,
    rewatched_count: rewatched,
    total_views: views,
    // Real per-type counts — mirrors getRankings' aggregation.
    movie_count: entries.filter((entry) => entry?.type === MOVIE_TYPE).length,
    episode_count: entries.filter((entry) => entry?.type === EPISODE_TYPE).length,
    month_count: 0,
    month_minutes: 0,
    month_movie_count: 0,
    month_episode_count: 0,
    week_count: 0,
    week_minutes: 0,
    week_movie_count: 0,
    week_episode_count: 0,
    detectiveRank: { title: detectiveRank.title, level: detectiveRank.level },
    rank: globalRank ?? 0,
  }
}

/**
 * PRE-MIGRATION FALLBACK — delete once migration-leaderboard-rpc.sql is applied.
 *
 * Computes the leaderboard live from base tables (no reliance on the
 * materialized view, which can go stale). All-time figures come from
 * watch_status; rolling-window figures come from the watch_events log.
 */
async function getRankingsByPaging(limit = 100): Promise<RankingRow[]> {
  const supabase = createAdminClient() ?? (await createClient())

  // PostgREST caps each request at 1,000 rows; paginate so the leaderboard
  // stays correct once the community has more than 1,000 watch rows. The ORDER BY
  // is not decoration: without a total order, LIMIT/OFFSET pages can repeat or
  // skip rows, which silently mis-counts everyone's totals.
  const PAGE_SIZE = 1000
  const watched: WatchStatusRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("watch_status")
      // `type` is new here: it makes the Movies category real. It was previously
      // estimated client-side as watched_count / 15.
      .select("user_id, status, watch_count, content_entries(runtime_minutes, type)")
      .in("status", ["watched", "rewatched"])
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    watched.push(...(chunk as WatchStatusRow[]))
    if (chunk.length < PAGE_SIZE) break
  }

  const agg = new Map<
    string,
    {
      count: number
      minutes: number
      rewatched: number
      views: number
      movies: number
      episodes: number
    }
  >()
  for (const row of watched) {
    const uid = row.user_id
    const rel = row.content_entries as ContentRef | null
    const mins = entryMinutes(rel)
    const cur =
      agg.get(uid) ?? {
        count: 0,
        minutes: 0,
        rewatched: 0,
        views: 0,
        movies: 0,
        episodes: 0,
      }
    cur.count += 1
    // Rewatches are time spent twice: the same floor-of-one view rule the
    // tracker, /analytics and /profile use, so one user's watch time reads the
    // same on every surface.
    cur.minutes += mins * Math.max(row.watch_count ?? 0, 1)
    if (row.status === "rewatched") cur.rewatched += 1
    cur.views += row.watch_count ?? 0
    if (rel?.type === MOVIE_TYPE) cur.movies += 1
    if (rel?.type === EPISODE_TYPE) cur.episodes += 1
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
        agg.get(p.user_id) ?? {
          count: 0,
          minutes: 0,
          rewatched: 0,
          views: 0,
          movies: 0,
          episodes: 0,
        }
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
        episode_count: a.episodes,
        month_count: period.month.count,
        month_minutes: period.month.minutes,
        month_movie_count: period.month.movieCount,
        month_episode_count: period.month.episodeCount,
        week_count: period.week.count,
        week_minutes: period.week.minutes,
        week_movie_count: period.week.movieCount,
        week_episode_count: period.week.episodeCount,
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
 *
 * PRE-MIGRATION ONLY — the RPC computes rank in the same query.
 */
export async function getUserGlobalRank(
  userId: string,
  watchedCount: number,
  minutes: number
): Promise<number | null> {
  const supabase = createAdminClient() ?? (await createClient())

  // PostgREST caps each request at 1,000 rows; paginate so the global rank
  // stays correct once the community has more than 1,000 watch rows. Ordered by
  // the primary key for the same reason as getRankings above.
  const PAGE_SIZE = 1000
  const watched: WatchCountRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("watch_status")
      .select("user_id, watch_count, content_entries(runtime_minutes, type)")
      .in("status", ["watched", "rewatched"])
      .order("id")
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
    // Rewatch multiplier, so the tie-break sums match the board's totals.
    const mins = entryMinutes(row.content_entries) * Math.max(row.watch_count ?? 0, 1)
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
