import { createClient } from "@/utils/supabase/client"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { redactForbiddenWords } from "@/lib/profanity"

// episode_comments.user_id references auth.users(id) — there is NO foreign key
// to profiles, so PostgREST cannot embed authors here. We fetch author
// profiles from the public_profiles view in a second query and join them in
// code (exact attachProfiles pattern from lib/queries/chat.ts:19-31).
const COMMENT_COLUMNS = "id, content_id, user_id, body, created_at"
const PAGE_SIZE = 50

export type EpisodeCommentAuthor = {
  username: string
  display_name: string
  avatar_url: string | null
}

/** content_entries.type CHECK-constrained union — see database.types.ts. */
type ContentEntryType = Database["public"]["Tables"]["content_entries"]["Row"]["type"]

type EpisodeCommentBase = Database["public"]["Tables"]["episode_comments"]["Row"]

export type EpisodeCommentRow = EpisodeCommentBase & {
  author: EpisodeCommentAuthor | null
}

export interface EpisodeCommentsResult {
  comments: EpisodeCommentRow[]
  /**
   * True when a chunk beyond the first returned a full page (exactly
   * PAGE_SIZE rows) — i.e. the conversation may continue past what is loaded.
   */
  hasMore: boolean
}

/**
 * Attach author profiles to a batch of comments with one extra query.
 * Unknown users (deleted profile / no row) get `author: null`.
 */
async function attachProfiles<T extends { user_id: string }>(
  rows: T[],
  supabase: SupabaseClient<Database>
): Promise<(T & { author: EpisodeCommentAuthor | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id))]
  if (ids.length === 0) return rows as (T & { author: EpisodeCommentAuthor | null })[]
  const { data: profs } = await supabase
    .from("public_profiles")
    .select("user_id, username, display_name, avatar_url")
    .in("user_id", ids)
  const byId = new Map((profs ?? []).map((p) => [p.user_id, p]))
  return rows.map((r) => ({ ...r, author: byId.get(r.user_id) ?? null }))
}

/** True when a PostgREST/Postgres error means the table (or view) is missing. */
function isTableMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const e = error as { code?: string; message?: string }
  if (e.code === "42P01" || e.code === "PGRST205") return true
  return /does not exist|could not find the table/i.test(e.message ?? "")
}

/**
 * Fetches ALL comments for a content entry in paginated chunks, oldest first
 * (conversation order). PostgREST caps each request at 1,000 rows, so we page
 * with PAGE_SIZE=50 `.range()` and break on an empty or short chunk.
 *
 * `hasMore` is true when a chunk beyond the first was exactly full (50 rows).
 * Tolerates a missing episode_comments table (migration not yet applied) by
 * degrading to an empty result; any other error is rethrown.
 */
export async function fetchEpisodeComments(contentId: string): Promise<EpisodeCommentsResult> {
  const supabase = createClient()

  const comments: EpisodeCommentBase[] = []
  let hasMore = false
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: chunk, error: chunkError } = await supabase
      .from("episode_comments")
      .select(COMMENT_COLUMNS)
      .eq("content_id", contentId)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (chunkError) {
      if (isTableMissingError(chunkError)) return { comments: [], hasMore: false }
      throw chunkError
    }
    if (!chunk || chunk.length === 0) break
    comments.push(...(chunk as EpisodeCommentBase[]))
    if (chunk.length < PAGE_SIZE) break
    if (offset > 0) hasMore = true
  }

  const withAuthors = await attachProfiles(comments, supabase)

  // Mask forbidden words on the way out. /api/comments already redacts before
  // insert, so this covers two things it cannot: rows written before the filter
  // existed, and rows written by bypassing the route (that route runs as role
  // `authenticated`, exactly like a browser REST call, so it cannot be made the
  // exclusive writer without a service-role key). Redaction is idempotent, so
  // re-masking an already-clean row is a no-op, and unchanged rows keep their
  // object identity. Done here rather than in the component so every consumer of
  // this query is covered by construction.
  const redacted = withAuthors.map((c) => {
    const clean = redactForbiddenWords(c.body)
    return clean === c.body ? c : { ...c, body: clean }
  })

  return { comments: redacted, hasMore }
}

/**
 * Posts a new comment through /api/comments and returns the inserted row
 * (without author — the caller attaches the author from the current user's
 * profile).
 *
 * No longer a direct Supabase insert, and no longer takes a userId: the server
 * reads the author from the session, so a caller cannot post as someone else.
 * The route also applies profanity redaction and rate limiting, neither of which
 * a browser insert could enforce.
 */
export async function addEpisodeComment(
  contentId: string,
  body: string
): Promise<EpisodeCommentBase> {
  const res = await fetch("/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId, body: body.trim() }),
  })

  const json = (await res.json().catch(() => null)) as
    | { success: true; data: { comment: EpisodeCommentBase } }
    | { error?: string }
    | null

  if (!res.ok || !json || !("success" in json)) {
    const detail =
      json && "error" in json && typeof json.error === "string"
        ? json.error
        : "Couldn't post your comment. Try again."
    throw new Error(detail)
  }

  return json.data.comment
}

/**
 * Deletes a comment by id. RLS rejects non-owners — the error is surfaced to
 * the caller (thrown), never swallowed.
 */
export async function deleteEpisodeComment(id: string): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase.from("episode_comments").delete().eq("id", id)
  if (error) throw error
}

/**
 * Fetches the aggregate rating for a content entry via the
 * `get_content_rating` RPC. Returns null on ANY failure — the function/table
 * may not be migrated yet, so this degrades gracefully (error-tolerant
 * fallback precedent from app/api/sync/route.ts:171-175).
 */
export async function fetchContentRating(
  contentId: string
): Promise<{ avg_rating: number; rating_count: number } | null> {
  const supabase = createClient()

  try {
    const { data, error } = await supabase.rpc("get_content_rating", {
      p_content_id: contentId,
    })
    if (error) return null
    // PostgREST `returns table` RPCs come back as an array even for a single
    // row — unwrap it so callers can read avg_rating/rating_count directly.
    const row = Array.isArray(data) ? data[0] : data
    return row ?? null
  } catch {
    return null
  }
}

/**
 * Fetches the previous and next entries within the same `type` by
 * canon_order. canon_order is NOT unique across types, so both queries MUST
 * filter `.eq("type", type)`. Either side may be null at the boundaries.
 */
export async function fetchAdjacentEntries(
  type: string,
  canonOrder: number
): Promise<{
  prev: { slug: string; title: string } | null
  next: { slug: string; title: string } | null
}> {
  const supabase = createClient()

  const [prevRes, nextRes] = await Promise.all([
    supabase
      .from("content_entries")
      .select("slug, title")
      .eq("type", type as ContentEntryType)
      .lt("canon_order", canonOrder)
      .order("canon_order", { ascending: false })
      .limit(1),
    supabase
      .from("content_entries")
      .select("slug, title")
      .eq("type", type as ContentEntryType)
      .gt("canon_order", canonOrder)
      .order("canon_order", { ascending: true })
      .limit(1),
  ])

  if (prevRes.error) throw prevRes.error
  if (nextRes.error) throw nextRes.error

  return {
    prev: prevRes.data?.[0] ?? null,
    next: nextRes.data?.[0] ?? null,
  }
}
