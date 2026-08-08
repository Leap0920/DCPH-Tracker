import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

export interface RankingRow {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  watched_count: number
  total_minutes: number
  rank: number
}

/**
 * Computes the leaderboard live from base tables (no reliance on the
 * materialized view, which can go stale). Counts "watched" entries per
 * user and sums their runtimes, then ranks by episodes watched.
 */
export async function getRankings(limit = 100): Promise<RankingRow[]> {
  const supabase = await createClient()

  const { data: watched, error } = await supabase
    .from("watch_status")
    .select("user_id, content_entries(runtime_minutes)")
    .in("status", ["watched", "rewatched"])

  if (error) throw error
  if (!watched || watched.length === 0) return []

  const agg = new Map<string, { count: number; minutes: number }>()
  for (const row of watched) {
    const uid = row.user_id
    const rel = row.content_entries as { runtime_minutes: number | null } | null
    const mins = rel?.runtime_minutes ?? 0
    const cur = agg.get(uid) ?? { count: 0, minutes: 0 }
    cur.count += 1
    cur.minutes += mins
    agg.set(uid, cur)
  }

  const userIds = [...agg.keys()]
  const { data: profiles, error: pError } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url")
    .in("user_id", userIds)

  if (pError) throw pError

  return (profiles ?? [])
    .map((p) => {
      const a = agg.get(p.user_id) ?? { count: 0, minutes: 0 }
      return {
        user_id: p.user_id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        watched_count: a.count,
        total_minutes: a.minutes,
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
