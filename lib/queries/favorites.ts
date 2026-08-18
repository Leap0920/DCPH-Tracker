import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

/**
 * A favorited content entry, flattened from the watch_status join so the
 * favorites page can render cards without knowing about the join.
 */
export interface FavoriteEntry {
  id: string
  slug: string
  title: string
  type: ContentEntry["type"]
  episode_number: number | null
  movie_number: number | null
  image_url: string | null
  runtime_minutes: number | null
  synopsis: string | null
  /** watch_status.updated_at — drives the "most recent first" ordering */
  updated_at: string
}

/**
 * A user's favorited entries, newest-updated first.
 *
 * watch_status declares an FK relationship to content_entries in the generated
 * types, so the embed is typed directly — same join pattern as
 * getSelfAnalytics (lib/queries/analytics.ts) and getUserStats
 * (lib/queries/profile.ts). RLS on watch_status is own-rows only, so this must
 * run through the authenticated server client (never the anon client).
 */
export async function getUserFavorites(userId: string): Promise<FavoriteEntry[]> {
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from("watch_status")
    .select(
      "updated_at, content_entries(id, slug, title, type, episode_number, movie_number, image_url, runtime_minutes, synopsis)"
    )
    .eq("user_id", userId)
    .eq("favorite", true)
    .order("updated_at", { ascending: false })

  if (error) throw error

  return (rows ?? []).flatMap((row) => {
    const entry = Array.isArray(row.content_entries)
      ? row.content_entries[0]
      : row.content_entries
    if (!entry) return []
    return [
      {
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        type: entry.type,
        episode_number: entry.episode_number,
        movie_number: entry.movie_number,
        image_url: entry.image_url,
        runtime_minutes: entry.runtime_minutes,
        synopsis: entry.synopsis,
        updated_at: row.updated_at,
      },
    ]
  })
}
