import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"
import { PUBLIC_PROFILE_COLUMNS } from "@/lib/queries/profile"

type ContentType = Database["public"]["Tables"]["content_entries"]["Row"]["type"]

export interface SearchEntry {
  slug: string
  title: string
  type: ContentType
  image_url: string | null
}

export interface SearchArc {
  slug: string
  title: string
}

export interface SearchUser {
  username: string
  display_name: string
  avatar_url: string | null
}

export interface SearchResults {
  entries: SearchEntry[]
  arcs: SearchArc[]
  profiles: SearchUser[]
}

/**
 * Escapes LIKE/ILKE metacharacters so a literal `%` or `_` in a search query
 * is treated as text instead of widening the match (ilike injection guard).
 * The backslash itself is escaped first so the pattern stays unambiguous.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&")
}

const SEARCH_LIMIT = 20

/**
 * Case-insensitive `ilike %q%` across content_entries (title + synopsis),
 * arcs (title + description), and profiles (username + display_name).
 * Returns up to SEARCH_LIMIT rows per group. The profiles lookup prefers the
 * public_profiles security-definer view (safe columns only) and falls back to
 * the base table when the migration has not been applied yet — the same
 * view→table pattern as getRankings in lib/queries/leaderboard.ts.
 */
export async function searchAll(q: string): Promise<SearchResults> {
  const supabase = await createClient()
  const query = q.trim()
  if (!query) return { entries: [], arcs: [], profiles: [] }

  const pattern = `%${escapeLike(query)}%`

  // The three searches share only the pattern — run them concurrently so a
  // keystroke costs one round-trip latency, not three.
  const [entriesResult, arcsResult, viewQuery] = await Promise.all([
    supabase
      .from("content_entries")
      .select("slug, title, type, image_url")
      .or(`title.ilike.${pattern},synopsis.ilike.${pattern}`)
      .order("canon_order", { ascending: true })
      .limit(SEARCH_LIMIT),
    supabase
      .from("arcs")
      .select("slug, title")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .order("title", { ascending: true })
      .limit(SEARCH_LIMIT),
    supabase
      .from("public_profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
      .limit(SEARCH_LIMIT),
  ])

  const { data: entries, error: entriesError } = entriesResult
  if (entriesError) throw entriesError

  const { data: arcs, error: arcsError } = arcsResult
  if (arcsError) throw arcsError

  let profiles: SearchUser[]
  if (viewQuery.error) {
    // Fallback: the public_profiles view is missing (migration not applied yet).
    // Only fires on an error, so it runs after the parallel batch above.
    const baseQuery = await supabase
      .from("profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
      .limit(SEARCH_LIMIT)
    if (baseQuery.error) throw baseQuery.error
    profiles = (baseQuery.data ?? []).map((p) => ({
      username: p.username,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    }))
  } else {
    profiles = (viewQuery.data ?? []).map((p) => ({
      username: p.username,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    }))
  }

  return {
    entries: entries ?? [],
    arcs: arcs ?? [],
    profiles,
  }
}
