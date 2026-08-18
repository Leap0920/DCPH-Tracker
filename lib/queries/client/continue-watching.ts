import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type ContentEntryRow = Database["public"]["Tables"]["content_entries"]["Row"]

/** A watched/rewatched entry joined with its content row, for the strip cards. */
export interface ContinueWatchingEntry {
  /** watch_status.content_id — equals the joined content row's id. */
  content_id: string
  /** watch_status.updated_at — when the user last touched this entry. */
  updated_at: string
  id: string
  slug: string
  title: string
  type: ContentEntryRow["type"]
  episode_number: number | null
  movie_number: number | null
  image_url: string | null
  runtime_minutes: number | null
  synopsis: string | null
}

/** A content row for the "Up Next" suggestion (no watch_status row yet). */
export type NextUpEntry = Omit<ContinueWatchingEntry, "content_id" | "updated_at">

const CONTENT_SELECT =
  "id, slug, title, type, episode_number, movie_number, image_url, runtime_minutes, synopsis"

/**
 * The user's watched/rewatched EPISODES as a linear run, canon-ordered from
 * ep 1 up to the latest episode they focused. Only `type = "episode"` rows
 * participate (movies/specials/etc. are excluded so the strip reads as a
 * clean episode sequence). The most recent `limit` episodes of that run are
 * returned in ascending canon order — the last card is the latest focused.
 */
export async function getContinueWatching(userId: string, limit = 8): Promise<ContinueWatchingEntry[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("watch_status")
    .select(`content_id, updated_at, content_entries(${CONTENT_SELECT})`)
    .eq("user_id", userId)
    .in("status", ["watched", "rewatched"])
    .eq("content_entries.type", "episode")
    .order("content_entries(canon_order)", { ascending: false })
    .limit(limit)

  if (error) throw error
  if (!data) return []

  const entries: ContinueWatchingEntry[] = []
  for (const row of data) {
    const entry = Array.isArray(row.content_entries) ? row.content_entries[0] : row.content_entries
    if (!entry) continue
    entries.push({ content_id: row.content_id, updated_at: row.updated_at, ...entry })
  }
  // Descending fetch → ascending strip: ep 1 first, latest focused last.
  return entries.reverse()
}

/**
 * First content entry by `canon_order` that has NO watch_status row for the
 * user (watch_status rows only exist after the user first interacts with an
 * entry — including a status of "unwatched"). Returns null when the user has
 * touched every entry.
 */
export async function getNextUp(userId: string): Promise<NextUpEntry | null> {
  const supabase = createClient()

  const PAGE_SIZE = 1000

  // Collect every content_id the user has a watch_status row for (any status).
  const touched = new Set<string>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: rows, error } = await supabase
      .from("watch_status")
      .select("content_id")
      .eq("user_id", userId)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!rows || rows.length === 0) break
    for (const row of rows) touched.add(row.content_id)
    if (rows.length < PAGE_SIZE) break
  }

  // Scan content in canon order until the first untouched entry.
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: entries, error } = await supabase
      .from("content_entries")
      .select(CONTENT_SELECT)
      .order("canon_order", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!entries || entries.length === 0) break
    const next = entries.find((e) => !touched.has(e.id))
    if (next) return next
    if (entries.length < PAGE_SIZE) break
  }

  return null
}
