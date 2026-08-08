import { createClient } from "@/utils/supabase/server"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"

export interface PerTypeAnalytics {
  type: ContentType
  label: string
  watched: number
  rewatched: number
  totalViews: number
}

export interface FavoriteEntry {
  id: string
  title: string
  type: ContentType
  episode_number: number | null
  movie_number: number | null
  release_order: number | null
  runtime_minutes: number | null
  air_date: string | null
  status: "watched" | "rewatched" | null
  watch_count: number
}

export interface SelfAnalytics {
  watchedCount: number
  rewatchedCount: number
  /** Sum of every watch_count — a rewatch counts as an extra view. */
  totalViews: number
  minutesWatched: number
  favoriteCount: number
  favorites: FavoriteEntry[]
  perType: PerTypeAnalytics[]
}

/**
 * All self-analytics for a user, computed from their watch_status rows.
 * `minutesWatched` multiplies each entry's runtime by its watch_count so
 * rewatches count toward time spent.
 */
export async function getSelfAnalytics(userId: string): Promise<SelfAnalytics> {
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from("watch_status")
    .select(
      "status, watch_count, favorite, content_entries(id, title, type, episode_number, movie_number, release_order, runtime_minutes, air_date)"
    )
    .eq("user_id", userId)

  if (error) throw error

  let watchedCount = 0
  let rewatchedCount = 0
  let totalViews = 0
  let minutesWatched = 0

  const favorites: FavoriteEntry[] = []
  const perTypeMap = new Map<ContentType, PerTypeAnalytics>()

  for (const row of rows ?? []) {
    const entry = Array.isArray(row.content_entries)
      ? row.content_entries[0]
      : row.content_entries
    if (!entry) continue

    const status = row.status as "watched" | "rewatched" | null
    if (status === "watched") watchedCount++
    else if (status === "rewatched") rewatchedCount++

    const views = Math.max(1, row.watch_count ?? 1)
    totalViews += views
    minutesWatched += (entry.runtime_minutes ?? 0) * views

    const type = entry.type as ContentType
    const cur = perTypeMap.get(type) ?? {
      type,
      label: CONTENT_TYPE_LABELS[type],
      watched: 0,
      rewatched: 0,
      totalViews: 0,
    }
    if (status === "watched") cur.watched++
    else if (status === "rewatched") cur.rewatched++
    cur.totalViews += views
    perTypeMap.set(type, cur)

    if (row.favorite) {
      favorites.push({
        id: entry.id,
        title: entry.title,
        type,
        episode_number: entry.episode_number,
        movie_number: entry.movie_number,
        release_order: entry.release_order,
        runtime_minutes: entry.runtime_minutes,
        air_date: entry.air_date,
        status,
        watch_count: views,
      })
    }
  }

  const perType = [...perTypeMap.values()].sort((a, b) => a.label.localeCompare(b.label))

  return {
    watchedCount,
    rewatchedCount,
    totalViews,
    minutesWatched,
    favoriteCount: favorites.length,
    favorites,
    perType,
  }
}
