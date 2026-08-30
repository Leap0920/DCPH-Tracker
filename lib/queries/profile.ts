import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { getDefaultRuntime } from "@/lib/utils"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]

/**
 * Safe public columns only. Never select("*") — the base table holds PII
 * (birthday, bio, status, ban_reason, ...) that must stay private.
 */
export const PUBLIC_PROFILE_COLUMNS = "user_id, username, display_name, avatar_url"

/**
 * Reads a profile through the `public_profiles` security-definer view
 * (safe columns only). Falls back to the base table with safe columns when
 * the view has not been created yet (migration not applied). This function
 * is safe to call for anonymous visitors — the view grants anon read.
 */
async function selectPublicProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: "username" | "user_id",
  value: string,
  mode: "maybeSingle" | "single"
) {
  const viewQuery = supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq(column, value)

  const view = await (mode === "maybeSingle" ? viewQuery.maybeSingle() : viewQuery.single())

  if (!view.error) return view

  // Fallback: view missing (migration not applied) → safe columns on base table.
  const base = supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq(column, value)

  const fb = await (mode === "maybeSingle" ? base.maybeSingle() : base.single())
  if (fb.error) throw fb.error
  return fb
}

export async function getProfileByUsername(username: string) {
  const supabase = await createClient()
  const result = await selectPublicProfile(supabase, "username", username, "maybeSingle")
  return result.data
}

export async function getProfileByUserId(userId: string) {
  const supabase = await createClient()
  const result = await selectPublicProfile(supabase, "user_id", userId, "single")
  return result.data
}

export async function updateProfile(userId: string, updates: ProfileUpdate) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select(PUBLIC_PROFILE_COLUMNS)
    .single()

  if (error) throw error

  return data
}

export async function getProfileStats(userId: string) {
  const supabase = createAdminClient() ?? (await createClient())

  // PostgREST caps a single request at 1,000 rows — page to get everything.
  const PAGE_SIZE = 1000
  const watchStatuses: {
    status: string | null
    watch_count: number | null
    content_entries: { runtime_minutes: number | null; type: string } | null
  }[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error: watchError } = await supabase
      .from("watch_status")
      .select("status, watch_count, content_entries(runtime_minutes, type)")
      .eq("user_id", userId)
      .range(from, from + PAGE_SIZE - 1)

    if (watchError) throw watchError
    if (!chunk || chunk.length === 0) break
    watchStatuses.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  const watched = watchStatuses.filter((ws) => ws.status === "watched")
  const rewatched = watchStatuses.filter((ws) => ws.status === "rewatched")
  const seen = [...watched, ...rewatched]

  // Cases solved = unique entries seen at least once (matches analytics)
  const casesSolved = watched.length + rewatched.length

  // Total rewatch views = sum of watch_count for rewatched items.
  // e.g. ep1 rewatched 5x + ep23 rewatched 2x = 7 total rewatch views
  const totalRewatchViews = rewatched.reduce((sum, ws) => sum + (ws.watch_count ?? 0), 0)

  // Total minutes with runtime fallback (matches analytics)
  let totalMinutes = 0
  for (const ws of seen) {
    const entry = Array.isArray(ws.content_entries) ? ws.content_entries[0] : ws.content_entries
    const minutes = entry?.runtime_minutes ?? getDefaultRuntime(entry?.type ?? "")
    const views = ws.watch_count ?? 0
    if (views > 0) totalMinutes += minutes * views
  }

  // Format time as "Xd Yh Zm"
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const mins = Math.round(totalMinutes % 60)
  const timeFormatted = days > 0
    ? `${days}d ${hours}h ${mins}m`
    : hours > 0
      ? `${hours}h ${mins}m`
      : `${mins}m`

  // Total catalog count
  const { count: totalCatalogCount } = await supabase
    .from("content_entries")
    .select("*", { count: "exact", head: true })

  // Badge count
  const { count: badgeCount, error: badgeError } = await supabase
    .from("user_badges")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)

  if (badgeError) throw badgeError

  return {
    casesSolved,
    totalRewatchViews,
    totalMinutes,
    timeFormatted,
    totalCatalogCount: totalCatalogCount ?? 0,
    badgeCount: badgeCount ?? 0,
  }
}

/**
 * One comment in a user's public comment trail, joined with the episode it
 * was posted on (title/slug power the /tracker/[slug] link).
 */
export interface CommentTrailItem {
  id: string
  body: string
  created_at: string
  content_id: string
  episode_title: string
  episode_slug: string
  episode_type: string
}

/** True when a PostgREST/Postgres error means the table (or view) is missing. */
function isTableMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const e = error as { code?: string; message?: string }
  if (e.code === "42P01" || e.code === "PGRST205") return true
  return /does not exist|could not find the table/i.test(e.message ?? "")
}

/**
 * Fetches a user's comments newest-first with episode context (title/slug)
 * for the public profile page.
 *
 * episode_comments declares no FK relationship in the generated types
 * (Relationships: []), so the content_entries embed is not typed — we join in
 * code instead (exact two-query pattern from lib/queries/client/episode.ts
 * attachProfiles).
 *
 * Paginated: `limit` rows at `offset`, with `hasMore` true when the page came
 * back exactly full. Tolerates a missing episode_comments table (migration
 * not applied) by degrading to an empty result; any other error is rethrown.
 */
export async function getUserComments(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ comments: CommentTrailItem[]; hasMore: boolean }> {
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from("episode_comments")
    .select("id, content_id, body, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    if (isTableMissingError(error)) return { comments: [], hasMore: false }
    throw error
  }

  if (!rows || rows.length === 0) {
    return { comments: [], hasMore: false }
  }

  const contentIds = [...new Set(rows.map((r) => r.content_id))]
  const { data: entries, error: entriesError } = await supabase
    .from("content_entries")
    .select("id, slug, title, type")
    .in("id", contentIds)

  if (entriesError) throw entriesError

  const entryById = new Map((entries ?? []).map((e) => [e.id, e]))
  const comments: CommentTrailItem[] = rows.map((row) => {
    const entry = entryById.get(row.content_id)
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      content_id: row.content_id,
      episode_title: entry?.title ?? "Unknown",
      episode_slug: entry?.slug ?? "",
      episode_type: entry?.type ?? "episode",
    }
  })

  return { comments, hasMore: rows.length === limit }
}