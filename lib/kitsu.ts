/**
 * Kitsu API client (JSON:API)
 * Docs: https://kitsu.docs.apiary.io / base: https://kitsu.io/api/edge
 *
 * ROLE IN THIS SYSTEM
 *  - Primary source for Detective Conan episode / movie / special / OVA metadata
 *    (titles, episode numbers, air dates, runtimes, artwork).
 *  - Used for the ONE-TIME full seed of all content entries.
 *  - Used for ON-DEMAND detail pulls when AniList signals a new episode has aired.
 *
 * Rate limit: ~60 requests/min. We space requests and honor `Retry-After` on 429.
 * Note: Kitsu reserves episode numbers beyond the real TV count (placeholders with no
 * airdate). Only episodes that have an `airdate` have actually aired — callers must
 * filter on `attributes.airdate` before persisting.
 */

const KITSU_BASE_URL = "https://kitsu.io/api/edge"

/** Detective Conan main TV series on Kitsu */
export const DETECTIVE_CONAN_KITSU_ID = 210
export const DETECTIVE_CONAN_KITSU_SLUG = "detective-conan"

const EPISODE_PAGE_SIZE = 20
// Safe under Kitsu's ~60 req/min limit (leaves headroom for retries).
const RATE_LIMIT_DELAY_MS = 1100

let lastRequestTime = 0

async function rateLimitedFetch<T>(url: string): Promise<T> {
  const now = Date.now()
  const sinceLast = now - lastRequestTime
  if (sinceLast < RATE_LIMIT_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - sinceLast))
  }
  lastRequestTime = Date.now()

  const response = await fetch(url)

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after")
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    lastRequestTime = Date.now()
    const retryResponse = await fetch(url)
    if (!retryResponse.ok) {
      throw new Error(`Kitsu API error: ${retryResponse.status}`)
    }
    return retryResponse.json()
  }

  if (!response.ok) {
    throw new Error(`Kitsu API error: ${response.status}`)
  }

  return response.json()
}

// ─── Types ───────────────────────────────────────────────────────

export interface KitsuImage {
  tiny: string
  small: string
  medium: string
  large: string
  original: string
}

export interface KitsuEpisodeAttributes {
  number: number
  airdate: string | null
  length: number | null
  canonicalTitle: string | null
  titles: {
    en?: string
    en_jp?: string
    en_us?: string
    ja_jp?: string
  }
  synopsis: string | null
  filler: boolean
}

export interface KitsuEpisode {
  id: string
  type: "episodes"
  attributes: KitsuEpisodeAttributes
}

export interface KitsuEpisodesResponse {
  data: KitsuEpisode[]
  meta: { count: number }
  links: {
    first: string
    next: string | null
    last: string | null
  }
}

export type KitsuSubtype = "TV" | "movie" | "OVA" | "special" | "ONA" | "music"

export interface KitsuAnimeAttributes {
  canonicalTitle: string | null
  titles: {
    en?: string
    en_jp?: string
    en_us?: string
    ja_jp?: string
  }
  subtype: KitsuSubtype
  startDate: string | null
  endDate: string | null
  episodeLength: number | null
  episodeCount: number | null
  synopsis: string | null
  posterImage: KitsuImage
  slug: string
}

export interface KitsuAnime {
  id: string
  type: "anime"
  attributes: KitsuAnimeAttributes
}

export interface KitsuSingleAnimeResponse {
  data: KitsuAnime
}

export interface KitsuAnimeListResponse {
  data: KitsuAnime[]
  links: { next: string | null }
}

// ─── API Functions ───────────────────────────────────────────────

/** Fetch a single anime (used for the series poster image). */
export async function getAnime(
  animeId: number | string = DETECTIVE_CONAN_KITSU_ID
): Promise<KitsuAnime> {
  const res = await rateLimitedFetch<KitsuSingleAnimeResponse>(
    `${KITSU_BASE_URL}/anime/${animeId}`
  )
  return res.data
}

/** Fetch ALL episodes for an anime, following `links.next` automatically. */
export async function getAllEpisodes(
  animeId: number | string = DETECTIVE_CONAN_KITSU_ID
): Promise<KitsuEpisode[]> {
  const all: KitsuEpisode[] = []
  let url: string | null = `${KITSU_BASE_URL}/anime/${animeId}/episodes?sort=number&page[limit]=${EPISODE_PAGE_SIZE}&page[offset]=0`

  while (url) {
    const res: KitsuEpisodesResponse = await rateLimitedFetch<KitsuEpisodesResponse>(url)
    all.push(...res.data)
    url = res.links?.next ?? null
  }

  return all
}

/**
 * Fetch a single episode by its TV number (1-indexed). Kitsu sorts episodes by
 * `number`, so we jump to the page that should contain it and scan a small window.
 * Returns null if the episode does not exist (e.g. an unfilled placeholder).
 */
export async function getEpisodeByNumber(
  number: number,
  animeId: number | string = DETECTIVE_CONAN_KITSU_ID
): Promise<KitsuEpisode | null> {
  const baseOffset = Math.max(0, number - 1 - ((number - 1) % EPISODE_PAGE_SIZE))

  for (let offset = baseOffset; offset <= baseOffset + EPISODE_PAGE_SIZE; offset += EPISODE_PAGE_SIZE) {
    const res = await rateLimitedFetch<KitsuEpisodesResponse>(
      `${KITSU_BASE_URL}/anime/${animeId}/episodes?sort=number&page[limit]=${EPISODE_PAGE_SIZE}&page[offset]=${offset}`
    )
    const found = res.data.find((e) => e.attributes.number === number)
    if (found) return found
    if (!res.links?.next) break
  }

  return null
}

/**
 * Fetch the Detective Conan franchise siblings (movies / OVAs / specials / ONAs)
 * via a text search. The main TV series is excluded.
 */
export async function getFranchiseEntries(
  slug: string = DETECTIVE_CONAN_KITSU_SLUG,
  excludeId: number | string = DETECTIVE_CONAN_KITSU_ID
): Promise<KitsuAnime[]> {
  const wanted: KitsuSubtype[] = ["movie", "OVA", "special", "ONA"]
  const searchText = slug.replace(/-/g, " ")
  const all: KitsuAnime[] = []
  let url: string | null = `${KITSU_BASE_URL}/anime?filter[text]=${encodeURIComponent(searchText)}&page[limit]=20`

  while (url) {
    const res: KitsuAnimeListResponse = await rateLimitedFetch<KitsuAnimeListResponse>(url)
    for (const anime of res.data) {
      if (anime.id === String(excludeId)) continue
      if (wanted.includes(anime.attributes.subtype)) all.push(anime)
    }
    url = res.links?.next ?? null
  }

  return all
}

/** Map a Kitsu subtype to one of our content_entry types. */
export function mapSubtypeToContentType(
  subtype: KitsuSubtype
): "movie" | "special" | "ova" | "episode" {
  switch (subtype) {
    case "movie":
      return "movie"
    case "OVA":
      return "ova"
    case "special":
      return "special"
    case "ONA":
      return "ova" // treat ONA as OVA
    default:
      return "episode"
  }
}
