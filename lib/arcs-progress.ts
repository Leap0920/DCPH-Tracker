import { createClient } from "@/utils/supabase/server"

/**
 * Live per-arc progress for the Story Arcs pages.
 *
 * The /arcs guide data itself stays fully static (lib/arcs-guide.ts); this
 * module only layers the signed-in user's watched state on top, computed
 * in memory from two queries (episode numbers + watch_status rows).
 */

export interface ArcProgressInfo {
  watched: number
  total: number
  percent: number
  /** First episode number in the arc range the user hasn't finished yet. */
  nextUnwatchedEpisode: number | null
}

/** Fallback when the catalog is unreadable; the live max comes from the DB. */
const LATEST_EPISODE = 1209

/**
 * Pure helper: progress of an arc given the set of watched episode numbers.
 * `latestEpisode` closes an arc that has no recorded end (see STORY_ARCS rum-arc) —
 * pass the catalog's newest episode so the bar keeps moving as episodes air.
 */
export function computeArcProgress(
  arc: { episodeStart: number; episodeEnd: number | null },
  watchedEpisodeNumbers: Set<number>,
  latestEpisode: number = LATEST_EPISODE
): ArcProgressInfo {
  const end = arc.episodeEnd ?? Math.max(latestEpisode, arc.episodeStart)
  let watched = 0
  let nextUnwatchedEpisode: number | null = null
  for (let ep = arc.episodeStart; ep <= end; ep++) {
    if (watchedEpisodeNumbers.has(ep)) {
      watched++
    } else if (nextUnwatchedEpisode === null) {
      nextUnwatchedEpisode = ep
    }
  }
  const total = end - arc.episodeStart + 1
  const percent = total > 0 ? Math.round((watched / total) * 100) : 0
  return { watched, total, percent, nextUnwatchedEpisode }
}

/**
 * Server-only: fetch every episode number plus the signed-in user's watched
 * rows, and return the watched episode numbers as a set. When signed out the
 * set is empty and `signedIn` is false (pages render neutral "0/N" bars).
 */
export async function getArcProgressData(): Promise<{
  signedIn: boolean
  watchedEpisodeNumbers: Set<number>
  /** The catalog's newest episode number — closes arcs with no recorded end. */
  latestEpisodeNumber: number
}> {
  const supabase = await createClient()

  // 1) Fetch all episode ids + numbers (chunked — PostgREST caps at 1,000 rows).
  const episodes: { id: string; episode_number: number | null }[] = []
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("content_entries")
      .select("id, episode_number")
      .eq("type", "episode")
      .order("episode_number", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error || !data || data.length === 0) break
    episodes.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  const idToNumber = new Map<string, number>()
  let latestEpisodeNumber = LATEST_EPISODE
  for (const e of episodes) {
    if (e.episode_number != null) {
      idToNumber.set(e.id, e.episode_number)
      if (e.episode_number > latestEpisodeNumber) latestEpisodeNumber = e.episode_number
    }
  }

  // 2) Fetch the signed-in user's watch_status rows. Chunked for the same reason
  //    as above: a user with 1,000+ rows would otherwise lose arc progress
  //    silently (they have one row per episode they have touched).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { signedIn: false, watchedEpisodeNumbers: new Set(), latestEpisodeNumber }
  }

  const statuses: { content_id: string; status: string }[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("watch_status")
      .select("content_id, status")
      .eq("user_id", user.id)
      .order("content_id")
      .range(offset, offset + PAGE_SIZE - 1)
    if (error || !data || data.length === 0) break
    statuses.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  const watchedEpisodeNumbers = new Set<number>()
  for (const s of statuses) {
    if (s.status === "watched" || s.status === "rewatched") {
      const num = idToNumber.get(s.content_id)
      if (num != null) watchedEpisodeNumbers.add(num)
    }
  }
  return { signedIn: true, watchedEpisodeNumbers, latestEpisodeNumber }
}
