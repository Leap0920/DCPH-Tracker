import { createClient } from "@/utils/supabase/server"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"

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

export interface DetectiveRank {
  title: string
  level: number
  nextRankTitle: string | null
  nextRankThreshold: number | null
  progressToNext: number
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

const RANKS = [
  { threshold: 0, title: "Civilian Observer", level: 1 },
  { threshold: 1, title: "Apprentice Detective", level: 2 },
  { threshold: 25, title: "Junior Detective (Detective Boys)", level: 3 },
  { threshold: 100, title: "High School Sleuth", level: 4 },
  { threshold: 300, title: "Metropolitan Police Investigator", level: 5 },
  { threshold: 600, title: "Public Security Agent (Zero)", level: 6 },
  { threshold: 1000, title: "Master Detective (Silver Bullet)", level: 7 },
]

function getDetectiveRank(watchedCount: number): DetectiveRank {
  let currentRankIndex = 0
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (watchedCount >= RANKS[i].threshold) {
      currentRankIndex = i
      break
    }
  }

  const current = RANKS[currentRankIndex]
  const next = RANKS[currentRankIndex + 1] ?? null

  let progressToNext = 100
  if (next) {
    const currentBase = current.threshold
    const span = next.threshold - currentBase
    progressToNext = Math.min(100, Math.round(((watchedCount - currentBase) / span) * 100))
  }

  return {
    title: current.title,
    level: current.level,
    nextRankTitle: next?.title ?? null,
    nextRankThreshold: next?.threshold ?? null,
    progressToNext,
  }
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
  const { data: catalogEntries } = await supabase
    .from("content_entries")
    .select("id, type, arc_id")

  const totalCatalogCount = catalogEntries?.length ?? 0

  const catalogTypeCounts = new Map<ContentType, number>()
  const catalogArcCounts = new Map<string, number>()

  for (const entry of catalogEntries ?? []) {
    const t = entry.type as ContentType
    catalogTypeCounts.set(t, (catalogTypeCounts.get(t) ?? 0) + 1)
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
    if (views > 0) {
      totalViews += views
      minutesWatched += (entry.runtime_minutes ?? 25) * views
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
    if (views > 0) cur.totalViews += views
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
      if (views > 0) py.views += views
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

