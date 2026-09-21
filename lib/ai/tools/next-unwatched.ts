/**
 * "What should I watch next?" answered from `watch_status` and
 * `content_entries`, in canon order.
 *
 * The filter runs in memory, not in SQL, deliberately: the watched side is a
 * list of ids, and `not.in(...)` would put all of them in the URL until
 * PostgREST refuses the request. A bounded window over canon order with a page
 * cap is predictable (1,500 episode rows at most) and the answer is identical.
 *
 * Zero I/O of its own: the client is injected structurally, so a test never
 * constructs the Supabase client (plan constraint 11) and this module never
 * imports it.
 */

export interface WatchResult {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
}

/** PostgREST's builder is a thenable that also chains, so the structural type has to be both. */
export interface WatchQuery extends Promise<WatchResult> {
  order(
    column: string,
    options: { ascending: boolean }
  ): {
    limit(count: number): Promise<WatchResult>
  }
}

export interface WatchClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): WatchQuery
    }
  }
}

export interface NextUnwatchedItem {
  id: string
  slug: string
  title: string
  episodeNumber: number | null
  airDate: string | null
}

/** The window each page widens to. */
const PAGE_SIZE = 500

/** Three pages, so one call reads 1,500 episode rows at most. */
const MAX_PAGES = 3

/** The watched side is capped for the same reason: a bounded read, always. */
const MAX_WATCHED_IDS = 2000

const WATCH_COLUMNS = "content_id"

/**
 * `type` is selected even though it is also filtered on: the column list is the
 * contract with the fake in the test, and a real query should name what it reads.
 */
const ENTRY_COLUMNS = "id, slug, title, type, episode_number, air_date"

/** A row projected onto the item shape; nullable columns stay nullable. */
function toItem(row: Record<string, unknown>): NextUnwatchedItem {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    episodeNumber: typeof row.episode_number === "number" ? row.episode_number : null,
    airDate: typeof row.air_date === "string" ? row.air_date : null,
  }
}

/**
 * The user's next episodes in canon order, skipping what they have watched.
 *
 * Never throws: a read failure degrades to "nothing to suggest", because the
 * caller is assembling an answer and a rejection here would be a 500.
 */
export async function nextUnwatched(
  client: WatchClient,
  userId: string,
  limit = 5
): Promise<NextUnwatchedItem[]> {
  const take = Math.max(0, Math.floor(limit))
  // An empty user id would read every user's watch status; a zero limit has
  // nothing to answer, and both are cheaper to refuse than to query.
  if (userId === "" || take === 0) return []

  try {
    const { data, error } = await client
      .from("watch_status")
      .select(WATCH_COLUMNS)
      .eq("user_id", userId)
    if (error) return []

    const watched = new Set<string>()
    for (const row of data ?? []) {
      const id = row.content_id
      if (typeof id !== "string" || id === "") continue
      watched.add(id)
      if (watched.size >= MAX_WATCHED_IDS) break
    }

    let unwatched: NextUnwatchedItem[] = []

    for (let page = 1; page <= MAX_PAGES && unwatched.length < take; page += 1) {
      // The client has no range/offset, so the window widens by raising the
      // limit instead of moving a cursor: the third read sees 1,500 rows, the
      // same bound three 500-row pages would give.
      const window = PAGE_SIZE * page
      const { data: rows, error: entriesError } = await client
        .from("content_entries")
        .select(ENTRY_COLUMNS)
        .eq("type", "episode")
        .order("canon_order", { ascending: true })
        .limit(window)
      if (entriesError) return []

      const pageRows = rows ?? []
      unwatched = pageRows.map(toItem).filter((item) => !watched.has(item.id))

      // A short page is the end of canon order: widening further would only
      // re-read the same rows.
      if (pageRows.length < window) break
    }

    return unwatched.slice(0, take)
  } catch {
    return []
  }
}
