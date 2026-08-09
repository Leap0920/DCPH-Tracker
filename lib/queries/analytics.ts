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

export interface TopRatedEntry {
  id: string
  title: string
  type: ContentType
  /** DB rating units (2..10). */
  rating: number
  views: number
}

export interface MostRewatchedEntry {
  id: string
  title: string
  type: ContentType
  watch_count: number
}

export interface RecentlyWatchedEntry {
  id: string
  title: string
  type: ContentType
  status: "watched" | "rewatched"
  updated_at: string
}

export interface PerYearEntry {
  year: string
  watched: number
  views: number
}

export interface ArcCompletionEntry {
  id: string
  slug: string
  title: string
  total: number
  watched: number
  progress: number
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
  /** Average rating in DB units (2..10), 0 if nothing rated. */
  avgRating: number
  ratedCount: number
  topRated: TopRatedEntry[]
  mostRewatched: MostRewatchedEntry[]
  recentlyWatched: RecentlyWatchedEntry[]
  perYear: PerYearEntry[]
  perArc: ArcCompletionEntry[]
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
      "status, watch_count, favorite, rating, updated_at, content_entries(id, title, type, episode_number, movie_number, release_order, runtime_minutes, air_date, arc_id)"
    )
    .eq("user_id", userId)

  if (error) throw error

  let watchedCount = 0
  let rewatchedCount = 0
  let totalViews = 0
  let minutesWatched = 0

  const favorites: FavoriteEntry[] = []
  const perTypeMap = new Map<ContentType, PerTypeAnalytics>()
  const topRated: TopRatedEntry[] = []
  const mostRewatched: MostRewatchedEntry[] = []
  const recentlyWatched: RecentlyWatchedEntry[] = []
  const perYearMap = new Map<string, PerYearEntry>()
  const perArcMap = new Map<string, { arcId: string; total: number; watched: number }>()

  let ratingSum = 0
  let ratedCount = 0

  for (const row of rows ?? []) {
    const entry = Array.isArray(row.content_entries)
      ? row.content_entries[0]
      : row.content_entries
    if (!entry) continue

    const status = row.status as "watched" | "rewatched" | null
    const isSeen = status === "watched" || status === "rewatched"
    if (status === "watched") watchedCount++
    else if (status === "rewatched") rewatchedCount++

    const views = row.watch_count ?? 0
    if (views > 0) {
      totalViews += views
      minutesWatched += (entry.runtime_minutes ?? 0) * views
    }

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
    if (views > 0) cur.totalViews += views
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
        watch_count: row.watch_count ?? 0,
      })
    }

    // Ratings
    const rating = row.rating as number | null
    if (rating != null) {
      ratingSum += rating
      ratedCount++
      topRated.push({
        id: entry.id,
        title: entry.title,
        type,
        rating,
        views,
      })
    }

    // Most rewatched (seen items only, by raw count)
    if (isSeen) {
      mostRewatched.push({
        id: entry.id,
        title: entry.title,
        type,
        watch_count: row.watch_count ?? 0,
      })
    }

    // Recently watched (any row with an updated_at timestamp)
    const updatedAt = row.updated_at as string | null
    if (updatedAt && isSeen) {
      recentlyWatched.push({
        id: entry.id,
        title: entry.title,
        type,
        status,
        updated_at: updatedAt,
      })
    }

    // Per release year (air_date is a YYYY-MM-DD string)
    const year = entry.air_date?.slice(0, 4)
    if (year) {
      const py = perYearMap.get(year) ?? { year, watched: 0, views: 0 }
      if (isSeen) py.watched++
      if (views > 0) py.views += views
      perYearMap.set(year, py)
    }

    // Per arc (episodes with arc_id)
    if (entry.arc_id) {
      const pa = perArcMap.get(entry.arc_id) ?? {
        arcId: entry.arc_id,
        total: 0,
        watched: 0,
      }
      pa.total++
      if (isSeen) pa.watched++
      perArcMap.set(entry.arc_id, pa)
    }
  }

  const perType = [...perTypeMap.values()].sort((a, b) => a.label.localeCompare(b.label))
  const avgRating = ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : 0

  topRated.sort(
    (a, b) => b.rating - a.rating || b.views - a.views
  )
  const topRatedTop = topRated.slice(0, 5)

  mostRewatched.sort((a, b) => b.watch_count - a.watch_count)
  const mostRewatchedTop = mostRewatched.slice(0, 10)

  recentlyWatched.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const recentlyWatchedTop = recentlyWatched.slice(0, 10)

  const perYear = [...perYearMap.values()].sort((a, b) => a.year.localeCompare(b.year))

  // Merge arc stats with the arcs table for slug/title.
  let perArc: ArcCompletionEntry[] = []
  if (perArcMap.size > 0) {
    const arcIds = [...perArcMap.keys()]
    const { data: arcsData } = await supabase
      .from("arcs")
      .select("id, slug, title")
      .in("id", arcIds)

    const arcLookup = new Map<string, { slug: string; title: string }>()
    for (const a of arcsData ?? []) arcLookup.set(a.id, { slug: a.slug, title: a.title })

    perArc = [...perArcMap.values()]
      .map((pa) => {
        const meta = arcLookup.get(pa.arcId)
        return {
          id: pa.arcId,
          slug: meta?.slug ?? "",
          title: meta?.title ?? "Unknown arc",
          total: pa.total,
          watched: pa.watched,
          progress: pa.total > 0 ? Math.round((pa.watched / pa.total) * 100) : 0,
        }
      })
      .sort((a, b) => b.progress - a.progress)
  }

  return {
    watchedCount,
    rewatchedCount,
    totalViews,
    minutesWatched,
    favoriteCount: favorites.length,
    favorites,
    perType,
    avgRating,
    ratedCount,
    topRated: topRatedTop,
    mostRewatched: mostRewatchedTop,
    recentlyWatched: recentlyWatchedTop,
    perYear,
    perArc,
  }
}
