/**
 * Jikan API v4 Client
 * Unofficial MyAnimeList REST API
 * Docs: https://docs.api.jikan.moe/
 *
 * Rate limit: 3 requests/second (we use 400ms delay between requests)
 *
 * ROLE IN THIS SYSTEM: legacy / fallback metadata source. Kitsu is the
 * primary source; Jikan remains available for `source=jikan` syncs.
 */

const JIKAN_BASE_URL = "https://api.jikan.moe/v4"

// Detective Conan MAL ID
export const DETECTIVE_CONAN_MAL_ID = 235

// Rate limiting: wait 400ms between requests (safe under 3 req/s limit)
const RATE_LIMIT_DELAY_MS = 400

let lastRequestTime = 0

async function rateLimitedFetch<T>(url: string): Promise<T> {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest)
    )
  }
  lastRequestTime = Date.now()

  const response = await fetch(url)

  if (response.status === 429) {
    // Rate limited — wait 1 second and retry once
    await new Promise((resolve) => setTimeout(resolve, 1000))
    lastRequestTime = Date.now()
    const retryResponse = await fetch(url)
    if (!retryResponse.ok) {
      throw new Error(`Jikan API error: ${retryResponse.status}`)
    }
    return retryResponse.json()
  }

  if (!response.ok) {
    throw new Error(`Jikan API error: ${response.status}`)
  }

  return response.json()
}

// ─── Types ───────────────────────────────────────────────────────

export interface JikanImage {
  image_url: string
  small_image_url: string
  large_image_url: string
}

export interface JikanAnimeFull {
  data: {
    mal_id: number
    title: string
    title_japanese: string
    title_english: string | null
    synopsis: string | null
    image: JikanImage
    images: {
      jpg: JikanImage
      webp: JikanImage
    }
    type: string
    source: string
    episodes: number | null
    status: string
    aired: {
      from: string | null
      to: string | null
      string: string
    }
    duration: string
    rating: string
    score: number | null
    scored_by: number | null
    rank: number | null
    popularity: number | null
    members: number | null
    favorites: number | null
    studios: { mal_id: number; name: string }[]
    genres: { mal_id: number; name: string }[]
    related: Record<
      string,
      { entry: { mal_id: number; name: string; type: string }[] }[]
    >
  }
}

export interface JikanEpisode {
  mal_id: number
  url: string
  title: string
  title_japanese: string | null
  title_romanji: string | null
  aired: string | null
  score: number | null
  filler: boolean
  recap: boolean
  forum_url: string | null
}

export interface JikanEpisodesResponse {
  pagination: {
    last_visible_page: number
    has_next_page: boolean
  }
  data: JikanEpisode[]
}

export interface JikanAnime {
  data: {
    mal_id: number
    title: string
    title_english: string | null
    synopsis: string | null
    images: {
      jpg: JikanImage
    }
    type: string
    episodes: number | null
    aired: {
      from: string | null
    }
    duration: string
  }
}

// ─── API Functions ───────────────────────────────────────────────

/** Generate a URL-safe slug from text */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Get full anime details from Jikan
 */
export async function getAnimeFull(malId: number = DETECTIVE_CONAN_MAL_ID) {
  return rateLimitedFetch<JikanAnimeFull>(
    `${JIKAN_BASE_URL}/anime/${malId}/full`
  )
}

/**
 * Get basic anime details from Jikan (for related entries like movies/specials/OVAs)
 */
export async function getAnime(malId: number): Promise<JikanAnime> {
  return rateLimitedFetch<JikanAnime>(
    `${JIKAN_BASE_URL}/anime/${malId}`
  )
}

/**
 * Get episodes for an anime (paginated)
 * @param malId - MAL anime ID
 * @param page - Page number (1-indexed)
 */
export async function getEpisodes(
  malId: number = DETECTIVE_CONAN_MAL_ID,
  page: number = 1
) {
  return rateLimitedFetch<JikanEpisodesResponse>(
    `${JIKAN_BASE_URL}/anime/${malId}/episodes?page=${page}`
  )
}

/**
 * Fetch ALL episodes for an anime (handles pagination automatically)
 * Respects rate limits between pages
 */
export async function getAllEpisodes(
  malId: number = DETECTIVE_CONAN_MAL_ID
): Promise<JikanEpisode[]> {
  const allEpisodes: JikanEpisode[] = []
  let page = 1
  let hasNextPage = true

  while (hasNextPage) {
    const response = await getEpisodes(malId, page)
    allEpisodes.push(...response.data)
    hasNextPage = response.pagination.has_next_page
    page++
  }

  return allEpisodes
}

/**
 * Get related anime (movies, specials, OVAs) from the full anime data
 */
export function getRelatedEntries(animeFull: JikanAnimeFull) {
  const related = animeFull.data.related
  const entries: { mal_id: number; name: string; type: string }[] = []

  if (!related) return entries

  // Collect all related entries
  for (const items of Object.values(related)) {
    if (!Array.isArray(items)) continue
    for (const group of items) {
      if (group.entry) {
        for (const item of group.entry) {
          if (item.type === "anime") {
            entries.push(item)
          }
        }
      }
    }
  }

  return entries
}
