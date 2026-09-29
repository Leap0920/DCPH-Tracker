import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { getDefaultRuntime } from "@/lib/utils"
import { MAINLINE_MOVIES } from "@/lib/movies-guide"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"]

/**
 * Safe public columns only. Never select("*") — the base table holds PII
 * (birthday, bio, status, ban_reason, ...) that must stay private.
 */
export const PUBLIC_PROFILE_COLUMNS = "user_id, username, display_name, avatar_url, bio"

/**
 * Reads a profile through the admin client or `public_profiles` view
 * (safe columns only: user_id, username, display_name, avatar_url, bio).
 */
async function selectPublicProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: "username" | "user_id",
  value: string,
  mode: "maybeSingle" | "single"
) {
  try {
    const admin = createAdminClient()
    if (admin) {
      const baseQuery = admin
        .from("profiles")
        .select(PUBLIC_PROFILE_COLUMNS)
        .eq(column, value)
      const base = await (mode === "maybeSingle" ? baseQuery.maybeSingle() : baseQuery.single())
      if (!base.error && base.data) return base
    }
  } catch {
    // Non-fatal, fallback to view
  }

  const viewQuery = supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq(column, value)

  const view = await (mode === "maybeSingle" ? viewQuery.maybeSingle() : viewQuery.single())

  if (!view.error) return view

  // Fallback: view missing bio column → safe 4 columns
  const fallbackQuery = supabase
    .from("public_profiles")
    .select("user_id, username, display_name, avatar_url")
    .eq(column, value)

  return mode === "maybeSingle" ? fallbackQuery.maybeSingle() : fallbackQuery.single()
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
      // Total order for the paging: without it a user past 1,000 watch rows can
      // be shown a wrong case count and watch time.
      .order("id")
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

  // Times the user hit rewatch = passes beyond the first. Same reading as
  // /analytics, where views - cases solved = rewatches.
  const totalRewatchViews = seen.reduce(
    (sum, ws) => sum + Math.max((ws.watch_count ?? 0) - 1, 0),
    0
  )

  // Total minutes with runtime fallback (matches analytics)
  let totalMinutes = 0
  for (const ws of seen) {
    const entry = Array.isArray(ws.content_entries) ? ws.content_entries[0] : ws.content_entries
    const minutes = entry?.runtime_minutes ?? getDefaultRuntime(entry?.type ?? "")
    // A seen row is at least one view: a missing or zero watch_count must not
    // erase minutes the row itself proves were spent. Same floor in analytics
    // and in the tracker's "spent" figure.
    const views = Math.max(ws.watch_count ?? 0, 1)
    totalMinutes += minutes * views
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

  // Total catalog count, on the same footing as analytics and the tracker: every
  // non-film row plus the canonical 29 films. Counting raw rows said 1,371 here
  // while the tracker said 1,366 — the five extra rows are the crossover films,
  // the manner short and the Haibara compilation, which are not mainline films.
  const { count: nonMovieRows } = await supabase
    .from("content_entries")
    .select("*", { count: "exact", head: true })
    .neq("type", "movie")
  const totalCatalogCount = (nonMovieRows ?? 0) + MAINLINE_MOVIES.length

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