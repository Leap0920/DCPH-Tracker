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
  /**
   * content id -> crime slugs, for the crime tags on a tracker row.
   *
   * Sourced from dcw_cases_view, which already joins each case to its entry.
   * 585 of the 1,216 episodes have at least one case, so this is the only
   * per-episode descriptive data the catalog actually carries — synopsis is
   * null on all but 54 rows. A case with no entry link cannot be attributed to
   * a row, so those are dropped here rather than guessed at.
   */
  crimeByContentId: Map<string, string[]>
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

  // `air_date` alone is not a total order: hundreds of episodes share a date, so
  // Postgres is free to return tied rows in a different order per page request.
  // With OFFSET paging that silently duplicates some rows and drops others — and
  // a duplicated episode is exactly how a tab ends up reading "1218 / 1216".
  // Ordering by a unique column as the tiebreaker makes paging deterministic.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: chunk, error: chunkError } = await supabase
      .from("content_entries")
      .select(CONTENT_LIST_SELECT)
      .order("air_date", { ascending: true })
      .order("id", { ascending: true })
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

/** PostgREST caps a response at 1,000 rows; dcw_cases_view has ~2,000. */
const CASE_PAGE_SIZE = 1000

/**
 * Crime slugs grouped by content id.
 *
 * Deliberately NON-FATAL: the tracker's job is to list episodes, and the crime
 * tags are an enhancement on top. If this view is missing (a fresh environment
 * that has not run migration-case-files-view.sql) the rows still render, just
 * without crime chips — so a failed lookup returns an empty map instead of
 * taking down the whole content query.
 */
async function fetchCrimeByContentId(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, string[]>> {
  const byContentId = new Map<string, string[]>()

  try {
    for (let offset = 0; ; offset += CASE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("dcw_cases_view")
        .select("entry_id, crime_slug")
        .not("entry_id", "is", null)
        .order("entry_id", { ascending: true })
        .range(offset, offset + CASE_PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      for (const row of data) {
        if (!row.entry_id || !row.crime_slug) continue
        const list = byContentId.get(row.entry_id)
        if (list) {
          if (!list.includes(row.crime_slug)) list.push(row.crime_slug)
        } else {
          byContentId.set(row.entry_id, [row.crime_slug])
        }
      }

      if (data.length < CASE_PAGE_SIZE) break
    }
  } catch {
    // Missing view / RLS denial — degrade to no crime tags.
    return new Map()
  }

  return byContentId
}

/**
 * Behavior-parity with the tracker page's original loadData(), but the content
 * pagination and the arcs lookup now run concurrently instead of serially.
 */
export async function fetchContentEntries(): Promise<ContentEntriesResult> {
  const supabase = createClient()

  const [entries, arcMap, crimeByContentId] = await Promise.all([
    fetchAllContentEntries(supabase),
    fetchArcMap(supabase),
    fetchCrimeByContentId(supabase),
  ])

  return { entries, arcMap, crimeByContentId }
}

export async function fetchContentEntryBySlug(slug: string) {
  const supabase = createClient()

  // maybeSingle: a slug that is not in the catalog is a normal miss the caller
  // handles, not the PGRST116 error single() raises for an empty result.
  const { data, error } = await supabase
    .from("content_entries")
    .select("*, arcs(*)")
    .eq("slug", slug)
    .maybeSingle()

  if (error) throw error
  return data
}
