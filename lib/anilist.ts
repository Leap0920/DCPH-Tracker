/**
 * AniList GraphQL client
 * Docs: https://anilist.gitbook.io / endpoint: https://graphql.anilist.co
 *
 * ROLE IN THIS SYSTEM
 *  - Lightweight "airing cache". AniList tracks the NEXT Detective Conan episode
 *    scheduled to air (via MAL id 235). We poll it on a schedule; when a new
 *    episode has aired we know its number and can lazily pull its full details
 *    from Kitsu.
 *
 * Reads are anonymous and generous (90 req/min for authed, still high for anon),
 * so a single scheduled call per run is well within limits. No auth required.
 */

const ANILIST_URL = "https://graphql.anilist.co"

/** Detective Conan MAL id — maps to AniList Media via `idMal`. */
export const DETECTIVE_CONAN_MAL_ID = 235

export interface AniListNextAiring {
  episode: number
  airingAt: number
  timeUntilAiring: number
}

export interface AniListMedia {
  id: number
  title: { romaji: string; english: string | null }
  status: string
  nextAiringEpisode: AniListNextAiring | null
}

const NEXT_AIRING_QUERY = `
query NextAiring($idMal: Int) {
  Media(idMal: $idMal) {
    id
    title { romaji english }
    status
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
}`

/**
 * Get the next episode scheduled to air for Detective Conan.
 * Returns null when no future episode is scheduled (e.g. off-season).
 */
export async function getNextAiringEpisode(
  malId: number = DETECTIVE_CONAN_MAL_ID
): Promise<AniListNextAiring | null> {
  const response = await fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: NEXT_AIRING_QUERY,
      variables: { idMal: malId },
    }),
  })

  if (!response.ok) {
    throw new Error(`AniList request failed: ${response.status}`)
  }

  const json = (await response.json()) as {
    data?: { Media?: AniListMedia }
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    throw new Error(`AniList error: ${json.errors[0].message}`)
  }

  return json.data?.Media?.nextAiringEpisode ?? null
}
