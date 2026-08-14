import { createClient } from "@/utils/supabase/server"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { getDefaultRuntime } from "@/lib/utils"
import { isOtherMovie, MAINLINE_MOVIES } from "@/lib/movies-guide"
import { getDetectiveRank, type DetectiveRank } from "@/lib/ranks"

export interface PerTypeAnalytics {
  type: ContentType
  label: string
  watched: number
  rewatched: number
  totalViews: number
  totalInCatalog: number
  completionProgress: number
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
  image_url: string | null
}

export interface TopRatedEntry {
  id: string
  title: string
  type: ContentType
  /** DB rating units (2..10). */
  rating: number
  views: number
  image_url: string | null
}

export interface MostRewatchedEntry {
  id: string
  title: string
  type: ContentType
  watch_count: number
  image_url: string | null
}

export interface RecentlyWatchedEntry {
  id: string
  title: string
  type: ContentType
  status: "watched" | "rewatched"
  updated_at: string
  image_url: string | null
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
  description?: string | null
  start_episode: number
  end_episode: number
  total: number
  watched: number
  progress: number
}

export interface RatingDistribution {
  stars: number
  count: number
  percentage: number
}

export interface SelfAnalytics {
  watchedCount: number
  rewatchedCount: number
  /** Sum of every watch_count — a rewatch counts as an extra view. */
  totalViews: number
  minutesWatched: number
  timeFormatted: {
    days: number
    hours: number
    mins: number
    formatted: string
  }
  totalCatalogCount: number
  catalogCompletionProgress: number
  detectiveRank: DetectiveRank
  favoriteCount: number
  favorites: FavoriteEntry[]
  perType: PerTypeAnalytics[]
  /** Average rating in DB units (2..10), 0 if nothing rated. */
  avgRating: number
  ratedCount: number
  ratingDistribution: RatingDistribution[]
  topRated: TopRatedEntry[]
  mostRewatched: MostRewatchedEntry[]
  recentlyWatched: RecentlyWatchedEntry[]
  perYear: PerYearEntry[]
  perArc: ArcCompletionEntry[]
}

/**
 * All self-analytics for a user, computed from their watch_status rows.
 */
export async function getSelfAnalytics(userId: string): Promise<SelfAnalytics> {
  const supabase = await createClient()

  // 1. User's watch status rows
  const { data: rows, error } = await supabase
    .from("watch_status")
    .select(
      "status, watch_count, favorite, rating, updated_at, content_entries(id, title, type, episode_number, movie_number, release_order, runtime_minutes, air_date, arc_id, image_url)"
    )
    .eq("user_id", userId)

  if (error) throw error

  // 2. Total catalog count & content type breakdown in DB
  // PostgREST caps a single request at 1000 rows �?" paginate to count the full catalog.
  const catalogEntries: { id: string; type: string; slug: string | null; arc_id: string | null }[] = []
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from("content_entries")
      .select("id, type, slug, arc_id")
      .range(offset, offset + PAGE_SIZE - 1)
    if (pageError) throw pageError
    if (!page || page.length === 0) break
    catalogEntries.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Non-mainline movies (Lupin III crossover, TV specials, manner short) live in
  // the catalog but do not count toward the mainline movie totals (29 films).
  const catalogEntriesExcludingOtherMovies = catalogEntries.filter(
    (e) => !(e.type === "movie" && isOtherMovie(e.slug))
  )

  // 29 canonical mainline films: 27 rows in the DB + 2 upcoming films
  // (One-eyed Flashback 2025, Fallen Angel of the Highway 2026).
  const mainlineMovieCount = catalogEntriesExcludingOtherMovies.filter(
    (e) => e.type === "movie"
  ).length
  const totalCatalogCount =
    catalogEntriesExcludingOtherMovies.length - mainlineMovieCount + MAINLINE_MOVIES.length

  const catalogTypeCounts = new Map<ContentType, number>()
  const catalogArcCounts = new Map<string, number>()

  for (const entry of catalogEntriesExcludingOtherMovies ?? []) {
    const t = entry.type as ContentType
    const add = t === "movie" ? MAINLINE_MOVIES.length : 1
    catalogTypeCounts.set(t, (catalogTypeCounts.get(t) ?? 0) + add)
    if (entry.arc_id) {
      catalogArcCounts.set(entry.arc_id, (catalogArcCounts.get(entry.arc_id) ?? 0) + 1)
    }
  }

  // 3. Story Arcs list
  const { data: arcsList } = await supabase
    .from("arcs")
    .select("id, slug, title, description, start_episode, end_episode")
    .order("start_episode", { ascending: true })

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
  const watchedArcCounts = new Map<string, number>()

  let ratingSum = 0
  let ratedCount = 0
  const ratingStarCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

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
    // Only watched/rewatched rows count as views; an "unwatched" row keeps its
    // historical watch_count but must not inflate stats (matches leaderboard).
    if (isSeen && views > 0) {
      totalViews += views
      minutesWatched += (entry.runtime_minutes ?? getDefaultRuntime(entry.type)) * views
    }

    const type = entry.type as ContentType
    const totalInCat = catalogTypeCounts.get(type) ?? 0
    const cur = perTypeMap.get(type) ?? {
      type,
      label: CONTENT_TYPE_LABELS[type] ?? type,
      watched: 0,
      rewatched: 0,
      totalViews: 0,
      totalInCatalog: totalInCat,
      completionProgress: 0,
    }
    if (status === "watched") cur.watched++
    else if (status === "rewatched") cur.rewatched++
    if (isSeen && views > 0) cur.totalViews += views
    cur.completionProgress = cur.totalInCatalog > 0
      ? Math.min(100, Math.round(((cur.watched + cur.rewatched) / cur.totalInCatalog) * 100))
      : 0
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
        image_url: entry.image_url ?? null,
      })
    }

    // Ratings (2..10 DB scale -> 1..5 stars)
    const rating = row.rating as number | null
    if (rating != null && rating > 0) {
      ratingSum += rating
      ratedCount++
      const stars = Math.min(5, Math.max(1, Math.round(rating / 2)))
      ratingStarCounts[stars] = (ratingStarCounts[stars] ?? 0) + 1

      topRated.push({
        id: entry.id,
        title: entry.title,
        type,
        rating,
        views,
        image_url: entry.image_url ?? null,
      })
    }

    // Most rewatched
    if (isSeen) {
      mostRewatched.push({
        id: entry.id,
        title: entry.title,
        type,
        watch_count: row.watch_count ?? 0,
        image_url: entry.image_url ?? null,
      })
    }

    // Recently watched
    const updatedAt = row.updated_at as string | null
    if (updatedAt && isSeen) {
      recentlyWatched.push({
        id: entry.id,
        title: entry.title,
        type,
        status,
        updated_at: updatedAt,
        image_url: entry.image_url ?? null,
      })
    }

    // Per release year
    const year = entry.air_date?.slice(0, 4)
    if (year) {
      const py = perYearMap.get(year) ?? { year, watched: 0, views: 0 }
      if (isSeen) py.watched++
      if (isSeen && views > 0) py.views += views
      perYearMap.set(year, py)
    }

    // Per arc
    if (entry.arc_id && isSeen) {
      watchedArcCounts.set(entry.arc_id, (watchedArcCounts.get(entry.arc_id) ?? 0) + 1)
    }
  }

  const perType = [...perTypeMap.values()].sort((a, b) => b.totalViews - a.totalViews)
  const avgRating = ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : 0

  const ratingDistribution: RatingDistribution[] = [5, 4, 3, 2, 1].map((stars) => {
    const count = ratingStarCounts[stars] ?? 0
    return {
      stars,
      count,
      percentage: ratedCount > 0 ? Math.round((count / ratedCount) * 100) : 0,
    }
  })

  topRated.sort((a, b) => b.rating - a.rating || b.views - a.views)
  const topRatedTop = topRated.slice(0, 6)

  mostRewatched.sort((a, b) => b.watch_count - a.watch_count)
  const mostRewatchedTop = mostRewatched.slice(0, 6)

  recentlyWatched.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const recentlyWatchedTop = recentlyWatched.slice(0, 8)

  const perYear = [...perYearMap.values()].sort((a, b) => a.year.localeCompare(b.year))

  // Build complete arc progress for ALL database arcs
  const perArc: ArcCompletionEntry[] = (arcsList ?? []).map((arc) => {
    const total = catalogArcCounts.get(arc.id) ?? 0
    const watched = watchedArcCounts.get(arc.id) ?? 0
    const progress = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0
    return {
      id: arc.id,
      slug: arc.slug,
      title: arc.title,
      description: arc.description,
      start_episode: arc.start_episode,
      end_episode: arc.end_episode,
      total,
      watched,
      progress,
    }
  })

  // Time formatted breakdown
  const days = Math.floor(minutesWatched / 1440)
  const hours = Math.floor((minutesWatched % 1440) / 60)
  const mins = minutesWatched % 60
  const timeFormattedStr = days > 0
    ? `${days}d ${hours}h ${mins}m`
    : hours > 0
      ? `${hours}h ${mins}m`
      : `${mins}m`

  const catalogCompletionProgress = totalCatalogCount > 0
    ? Math.min(100, Math.round(((watchedCount + rewatchedCount) / totalCatalogCount) * 100))
    : 0

  const detectiveRank = getDetectiveRank(watchedCount + rewatchedCount)

  return {
    watchedCount,
    rewatchedCount,
    totalViews,
    minutesWatched,
    timeFormatted: {
      days,
      hours,
      mins,
      formatted: timeFormattedStr,
    },
    totalCatalogCount,
    catalogCompletionProgress,
    detectiveRank,
    favoriteCount: favorites.length,
    favorites,
    perType,
    avgRating,
    ratedCount,
    ratingDistribution,
    topRated: topRatedTop,
    mostRewatched: mostRewatchedTop,
    recentlyWatched: recentlyWatchedTop,
    perYear,
    perArc,
  }
}

