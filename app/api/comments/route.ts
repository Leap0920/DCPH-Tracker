import type { NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { ok, fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { MAX_COMMENT_LENGTH } from "@/lib/comment-constants"
import { redactForbiddenWords } from "@/lib/profanity"

/**
 * Episode/content comment posting API.
 *
 * Replaces the previous browser -> Supabase insert in
 * lib/queries/client/episode.ts. Two reasons it exists:
 *
 *  1. Profanity redaction has to happen somewhere the client cannot skip. The
 *     row itself must be clean, because every reader gets it straight from
 *     Postgres.
 *  2. The direct-insert path had NO rate limiting whatsoever — not origin, not
 *     burst, not per-user. RLS authorises, it does not throttle. A valid session
 *     could insert comments as fast as the network allowed.
 *
 * The client no longer supplies a user id: it comes from the server session, so
 * a caller cannot post as someone else by editing the request body.
 *
 * RLS-safe: the insert runs through the logged-in user's server client, NOT the
 * service-role client — same load-bearing reasoning as app/api/chat/route.ts.
 * The owner-insert policy enforces auth.uid() = user_id and any restrictive
 * is_active() ban policy rejects suspended users inside Postgres. A
 * service-role insert would bypass both.
 *
 * NOT a complete enforcement boundary, and it cannot be one: this route acts as
 * role `authenticated`, exactly like a browser REST call, so INSERT cannot be
 * revoked from `authenticated` without breaking the route itself. A crafted
 * request can therefore still store raw text. That is why
 * fetchEpisodeComments() also redacts on read — see the comment there.
 *
 * Defence ordering mirrors /api/chat, in cost order:
 *  1. same-origin check      — header compare, free
 *  2. in-memory IP burst cap — no DB round-trip
 *  3. auth                   — 401 before any persistent counter is touched
 *  4. body validation        — id shape + length cap
 *  5. persistent limit keyed by USER ID, not IP (NAT sharing is common here)
 *  6. redact, then insert
 *
 * No separate "does this content entry exist" query: content_id is a foreign key,
 * so Postgres rejects a bad id on the insert itself. One round-trip, not two.
 */

/** Pre-auth, per-instance burst cap. Generous: it only exists to stop floods. */
const BURST = { limit: 20, windowMs: 60_000 } as const

/**
 * Per-user comment quota — tighter than chat's 20/min, because a comment thread
 * is not a conversation stream. failClosed: false for the same reason as chat:
 * with no SUPABASE_SERVICE_ROLE_KEY configured, rateLimitPersistent falls back
 * to the in-memory result it already computed, so a real per-instance limit
 * still applies instead of commenting failing outright. Set failClosed: true
 * once a service-role key exists.
 */
const PER_USER = { limit: 10, windowMs: 60_000, failClosed: false } as const

/**
 * Lenient content id shape check. Tolerates both a UUID and a slug-style id so
 * this does not have to be edited if content_entries.id is not a uuid. It is a
 * cheap junk filter only — the foreign key is the real gate.
 */
const CONTENT_ID_RE = /^[0-9a-zA-Z-]{1,64}$/

/**
 * True when a PostgREST/Postgres error means the table is missing — i.e. the
 * episode_comments migration has not been applied yet.
 *
 * Duplicated from lib/queries/client/episode.ts on purpose: that module imports
 * the BROWSER Supabase client, which must never be pulled into a server route.
 */
function isTableMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const e = error as { code?: string; message?: string }
  if (e.code === "42P01" || e.code === "PGRST205") return true
  return /does not exist|could not find the table/i.test(e.message ?? "")
}

export async function GET() {
  return fail(404, "Not found")
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const burst = rateLimit(
      `comments:burst:${authRateLimitKey(request)}`,
      BURST
    )
    if (!burst.allowed) {
      return tooManyRequests(burst.retryAfterSeconds)
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return fail(400, "Invalid comment")
    }

    const raw = payload as { contentId?: unknown; body?: unknown } | null
    const contentId = typeof raw?.contentId === "string" ? raw.contentId : ""
    const rawBody = typeof raw?.body === "string" ? raw.body : ""

    if (!CONTENT_ID_RE.test(contentId)) {
      return fail(400, "Invalid comment")
    }

    const trimmed = rawBody.trim()
    if (trimmed.length === 0) {
      return fail(400, "Invalid comment")
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      return fail(400, "Comment too long")
    }

    const rl = await rateLimitPersistent(
      `comments:post:user:${user.id}`,
      PER_USER
    )
    if (!rl.allowed) {
      return tooManyRequests(rl.retryAfterSeconds)
    }

    // Redact AFTER the length check (so the cap applies to what the user
    // actually typed) and BEFORE the insert: the stored row must be clean,
    // because every reader receives it straight from Postgres. Redaction never
    // lengthens the string, so the cap still holds.
    const body = redactForbiddenWords(trimmed)

    const { data: inserted, error: insertError } = await supabase
      .from("episode_comments")
      .insert({ content_id: contentId, user_id: user.id, body })
      .select("id, content_id, user_id, body, created_at, updated_at")
      .single()

    if (insertError || !inserted) {
      // Distinguish "not migrated yet" from every other rejection: the client
      // shows this string verbatim, and "try again later" is the honest advice.
      if (isTableMissingError(insertError)) {
        return fail(503, "Comments aren't available yet. Try again later.")
      }
      // Banned/suspended users and FK violations land here. One generic status
      // for every reason: a distinct 403 would confirm "you are banned" and act
      // as a policy-probing oracle.
      return fail(400, "Comment could not be posted")
    }

    return ok({ comment: inserted })
  } catch (error) {
    return handleApiError(error, "comments")
  }
}
