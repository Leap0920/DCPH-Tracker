import "server-only"
import { createClient } from "@/utils/supabase/server"
import { REQUEST_TIMEOUT_MS, withTimeout } from "@/lib/request-timeout"

/**
 * Safety floor mirrored from app/(app)/tracker/page.tsx so the badge can never
 * regress below what the tracker reports (e.g. an empty/failed read).
 */
export const EPISODE_FLOOR = 1209

/** Budget for each homepage Supabase read. Failure falls back, never hangs. */
export const HOMEPAGE_TIMEOUT_MS = REQUEST_TIMEOUT_MS

export type LatestEntry = {
  id: string
  title: string
  type: string
  episode_number: number | null
  air_date: string
  slug: string | null
}

type EpisodeQueryClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        not: (col: string, op: string, val: null) => {
          order: (col: string, opts: { ascending: boolean }) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{
                data: { episode_number: number | null } | null
                error: unknown
              }>
            }
          }
        }
      }
    }
  }
}

type FeedQueryClient = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<{ data: LatestEntry[] | null; error: unknown }>
      }
    }
  }
}

/**
 * Highest approved episode number in content_entries.
 * Timeout-wrapped: falls back to EPISODE_FLOOR instead of hanging the homepage.
 */
export async function getLatestEpisodeNumber(
  client?: EpisodeQueryClient,
  timeoutMs: number = HOMEPAGE_TIMEOUT_MS
): Promise<number> {
  try {
    const supabase = client ?? ((await createClient()) as unknown as EpisodeQueryClient)

    const { data, error } = await withTimeout(
      supabase
        .from("content_entries")
        .select("episode_number")
        .eq("type", "episode")
        .not("episode_number", "is", null)
        .order("episode_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      timeoutMs
    )

    if (error) return EPISODE_FLOOR

    return Math.max(EPISODE_FLOOR, data?.episode_number ?? 0)
  } catch {
    // Never let a hero badge take down the homepage.
    return EPISODE_FLOOR
  }
}

/**
 * Lean homepage preview query — only the six columns the feed renders.
 * Timeout-wrapped: returns null so the homepage renders without the feed.
 */
export async function getLatestContent(
  client?: FeedQueryClient,
  timeoutMs: number = HOMEPAGE_TIMEOUT_MS
): Promise<LatestEntry[] | null> {
  try {
    const supabase = client ?? ((await createClient()) as unknown as FeedQueryClient)

    const { data, error } = await withTimeout(
      supabase
        .from("content_entries")
        .select("id, title, type, episode_number, air_date, slug")
        .order("air_date", { ascending: false })
        .limit(7),
      timeoutMs
    )

    if (error) return null
    return data
  } catch {
    // Homepage must never crash because the content feed is unavailable.
    return null
  }
}

/**
 * Both homepage reads in parallel. Use from app/page.tsx so a slow DB costs
 * max(slow read) instead of the sum, bounded by HOMEPAGE_TIMEOUT_MS.
 */
export async function getHomepageContent(
  episodeClient?: EpisodeQueryClient,
  feedClient?: FeedQueryClient,
  timeoutMs: number = HOMEPAGE_TIMEOUT_MS
): Promise<{
  episode: number
  entries: LatestEntry[] | null
}> {
  const [episode, entries] = await Promise.all([
    getLatestEpisodeNumber(episodeClient, timeoutMs),
    getLatestContent(feedClient, timeoutMs),
  ])
  return { episode, entries }
}