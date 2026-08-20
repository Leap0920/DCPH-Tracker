/**
 * Server-side anime progress for spoiler gating.
 *
 * Returns the plain episode/movie numbers the signed-in user has marked watched
 * or rewatched. Arrays (not Sets) so the result crosses the server/client
 * boundary without relying on collection serialization.
 */

import { createClient } from "@/utils/supabase/server"

export interface WatchedProgressPayload {
  isSignedIn: boolean
  watchedEpisodes: number[]
  watchedMovies: number[]
  highestEpisode: number
}

const PAGE_SIZE = 1000

export async function getWatchedProgress(): Promise<WatchedProgressPayload> {
  const empty: WatchedProgressPayload = {
    isSignedIn: false,
    watchedEpisodes: [],
    watchedMovies: [],
    highestEpisode: 0,
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return empty

  const episodes = new Set<number>()
  const movies = new Set<number>()
  let highestEpisode = 0

  // watch_status can exceed a single page for completionists; paginate.
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const { data, error } = await supabase
      .from("watch_status")
      .select(
        "status, content_entries!inner(type, episode_number, movie_number)",
      )
      .eq("user_id", user.id)
      .in("status", ["watched", "rewatched"])
      .range(from, to)

    if (error) {
      // Fail closed on progress, not on the page: an errored fetch yields
      // "signed in, nothing watched", which hides spoilers rather than leaking.
      console.error("[watched-progress] fetch failed", error)
      break
    }

    const rows = data ?? []
    for (const row of rows) {
      const entry = (row as { content_entries?: unknown }).content_entries
      const content = Array.isArray(entry) ? entry[0] : entry
      if (!content) continue

      const { type, episode_number: episodeNumber, movie_number: movieNumber } =
        content as {
          type?: string | null
          episode_number?: number | null
          movie_number?: number | null
        }

      if (type === "episode" && typeof episodeNumber === "number") {
        episodes.add(episodeNumber)
        if (episodeNumber > highestEpisode) highestEpisode = episodeNumber
      } else if (type === "movie" && typeof movieNumber === "number") {
        movies.add(movieNumber)
      }
    }

    if (rows.length < PAGE_SIZE) break
  }

  return {
    isSignedIn: true,
    watchedEpisodes: [...episodes].sort((a, b) => a - b),
    watchedMovies: [...movies].sort((a, b) => a - b),
    highestEpisode,
  }
}
