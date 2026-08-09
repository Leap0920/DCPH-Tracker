import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export interface ContentEntriesResult {
  entries: ContentEntry[]
  /** arc_id -> { slug, title } for episode arc badges. */
  arcMap: Map<string, { slug: string; title: string }>
}

/**
 * Fetches ALL content entries in paginated chunks (PostgREST caps responses
 * at 1,000 rows per request) plus the arcs lookup. Behavior-parity with the
 * tracker page's original loadData().
 */
export async function fetchContentEntries(): Promise<ContentEntriesResult> {
  const supabase = createClient()

  const PAGE_SIZE = 1000
  const allEntries: ContentEntry[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: chunk, error: chunkError } = await supabase
      .from("content_entries")
      .select("*")
      .order("air_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (chunkError) throw chunkError
    if (!chunk || chunk.length === 0) break
    allEntries.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  const { data: arcsData, error: arcsError } = await supabase
    .from("arcs")
    .select("id, slug, title")
  if (arcsError) throw arcsError

  const arcMap = new Map<string, { slug: string; title: string }>()
  for (const a of arcsData ?? []) arcMap.set(a.id, { slug: a.slug, title: a.title })

  return { entries: allEntries, arcMap }
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
