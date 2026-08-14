import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"
import { getDetectiveRank } from "@/lib/ranks"
import { PUBLIC_PROFILE_COLUMNS } from "@/lib/queries/profile"

type WatchStatusRow = {
  user_id: string
  status: string
  watch_count: number | null
  content_entries: { runtime_minutes: number | null } | null
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
  watched_count: number
  total_minutes: number
  rewatched_count: number
  total_views: number
  detectiveRank: { title: string; level: number }
  rank: number
}

/**
 * Computes the leaderboard live from base tables (no reliance on the
 * materialized view, which can go stale). Counts "watched" entries per
 * user and sums their runtimes, then ranks by episodes watched.
 */
export async function getRankings(limit = 100): Promise<RankingRow[]> {
  const supabase = await createClient()

  // PostgREST caps each request at 1,000 rows; paginate so the leaderboard
  // stays correct once the community has more than 1,000 watch rows.
  const PAGE_SIZE = 1000
  const watched: WatchStatusRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("watch_status")
      .select("user_id, status, watch_count, content_entries(runtime_minutes)")
      .in("status", ["watched", "rewatched"])
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    watched.push(...(chunk as WatchStatusRow[]))
    if (chunk.length < PAGE_SIZE) break
  }
  if (watched.length === 0) return []

  const agg = new Map<string, { count: number; minutes: number; rewatched: number; views: number }>()
  for (const row of watched) {
    const uid = row.user_id
    const rel = row.content_entries as { runtime_minutes: number | null } | null
    const mins = rel?.runtime_minutes ?? 0
    const cur = agg.get(uid) ?? { count: 0, minutes: 0, rewatched: 0, views: 0 }
    cur.count += 1
    cur.minutes += mins
    if (row.status === "rewatched") cur.rewatched += 1
    cur.views += row.watch_count ?? 0
    agg.set(uid, cur)
  }

  const userIds = [...agg.keys()]

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

  return (profiles ?? [])
    .map((p) => {
      const a = agg.get(p.user_id) ?? { count: 0, minutes: 0, rewatched: 0, views: 0 }
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
        detectiveRank: { title: detectiveRank.title, level: detectiveRank.level },
        rank: 0,
      }
    })
    .sort(
      (x, y) =>
        y.watched_count - x.watched_count || y.total_minutes - x.total_minutes
    )
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/**
 * Global rank (1-based) for a single user, counting everyone whose
 * (watched_count, total_minutes) sorts strictly above. Mirrors
 * getRankings' ordering: watched_count desc, then total_minutes desc.
 * Returns null when the user has no watch rows or the provided counts
 * no longer match the live data.
 */
export async function getUserGlobalRank(
  userId: string,
  watchedCount: number,
  minutes: number
): Promise<number | null> {
  const supabase = await createClient()

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
