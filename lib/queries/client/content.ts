import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type ContentEntryRow = Database["public"]["Tables"]["content_entries"]["Row"]

/**
 * Only the columns the tracker grid / ContentCard / ContentDetail actually read.
 * Kept as a literal (not a joined array) so supabase-js can still infer types.
 * NOTE: `dcw_title` is included because ContentDetail forwards it to
 * EpisodeWikiDetails; dropping it silently degrades wiki lookups to title matching.
 */
const CONTENT_LIST_SELECT =
  "id, slug, title, type, episode_number, movie_number, air_date, canon_order, release_order, arc_id, synopsis, image_url, runtime_minutes, dcw_title" as const

export interface ContentEntriesResult {
  entries: ContentEntryRow[]
  /** arc_id -> { slug, title } for episode arc badges. */
  arcMap: Map<string, { slug: string; title: string }>
}

const PAGE_SIZE = 1000

/**
 * Fetches ALL content entries in paginated chunks (PostgREST caps responses
 * at 1,000 rows per request). Pagination is inherently sequential, so the
 * parallelism win comes from running this alongside the arcs lookup.
 */
async function fetchAllContentEntries(
  supabase: ReturnType<typeof createClient>,
): Promise<ContentEntryRow[]> {
  const allEntries: ContentEntryRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: chunk, error: chunkError } = await supabase
      .from("content_entries")
      .select(CONTENT_LIST_SELECT)
      .order("air_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (chunkError) throw chunkError
    if (!chunk || chunk.length === 0) break

    allEntries.push(...(chunk as unknown as ContentEntryRow[]))
    if (chunk.length < PAGE_SIZE) break
  }

  return allEntries
}

async function fetchArcMap(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, { slug: string; title: string }>> {
  const { data: arcsData, error: arcsError } = await supabase
    .from("arcs")
    .select("id, slug, title")

  if (arcsError) throw arcsError

  const arcMap = new Map<string, { slug: string; title: string }>()
  for (const a of arcsData ?? []) {
    arcMap.set(a.id, { slug: a.slug, title: a.title })
  }
  return arcMap
}

/**
 * Behavior-parity with the tracker page's original loadData(), but the content
 * pagination and the arcs lookup now run concurrently instead of serially.
 */
export async function fetchContentEntries(): Promise<ContentEntriesResult> {
  const supabase = createClient()

  const [entries, arcMap] = await Promise.all([
    fetchAllContentEntries(supabase),
    fetchArcMap(supabase),
  ])

  return { entries, arcMap }
}

export async function fetchContentEntryBySlug(slug: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("content_entries")
    .select("*, arcs(*)")
    .eq("slug", slug)
    .single()

  if (error) throw error
  return data
}
