import type { NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { ok, fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { MAX_MESSAGE_LENGTH } from "@/lib/chat-constants"
import { redactForbiddenWords } from "@/lib/profanity"

/**
 * Chat message send API.
 *
 * Replaces the previous browser -> Supabase insert. The client no longer
 * supplies a user id: it is taken from the server session, so a caller cannot
 * post as someone else even by editing the request body.
 *
 * RLS-safe: the insert runs through the logged-in user's server client, NOT the
 * service-role client. That is load-bearing, not laziness:
 *   - "Authenticated users can insert own messages" enforces auth.uid() = user_id
 *   - the restrictive "Inactive users cannot post chat messages" policy calls
 *     public.is_active(), so banned/suspended users are rejected by Postgres
 * A service-role insert would bypass both, and the ban check would have to be
 * reimplemented (badly) in app code. Do not switch this to createAdminClient().
 *
 * Defence ordering, in cost order:
 *  1. same-origin check      — header compare, free
 *  2. in-memory IP burst cap — no DB round-trip; guards the *unauthenticated*
 *     surface so a flood cannot force a Postgres write per request
 *  3. auth                   — 401 before any persistent counter is touched
 *  4. body validation        — UUID + length caps; cheap, and keeps malformed
 *     requests from consuming the per-user quota (they are still counted by
 *     the IP burst cap above, so this is not a free retry loop)
 *  5. persistent limit keyed by USER ID, not IP — an IP key would over-block
 *     users sharing NAT, which is common in the audience for a chat room
 *  6. room existence + is_active — a closed room must not accept writes
 *  7. insert, then attach the author profile (chat_messages has no FK to
 *     profiles; the shape must match what realtime consumers build)
 *
 * failClosed is false here on purpose — see the note at PER_USER below.
 */

/** Pre-auth, per-instance burst cap. Generous: it only exists to stop floods. */
const BURST = { limit: 30, windowMs: 60_000 } as const

/**
 * Per-user send quota. failClosed: false because a chat insert is a low-value
 * write already gated by origin, burst cap, auth, RLS ownership, the is_active()
 * ban policy and a length cap. When the persistent store is unavailable
 * (no SUPABASE_SERVICE_ROLE_KEY), rateLimitPersistent falls back to the
 * in-memory result it already computed with this same key/limit/window, so a
 * real per-instance limit still applies instead of chat failing outright.
 * Set failClosed: true once a service-role key is configured.
 */
const PER_USER = { limit: 20, windowMs: 60_000, failClosed: false } as const

/** Lenient UUID shape check — rejects junk without assuming a version nibble. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ChatProfile = {
  username: string
  display_name: string
  avatar_url: string | null
}

export async function GET() {
  return fail(404, "Not found")
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const burst = rateLimit(`chat:burst:${authRateLimitKey(request)}`, BURST)
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail(400, "Invalid message")
    }

    const raw = body as { roomId?: unknown; content?: unknown } | null
    const roomId = typeof raw?.roomId === "string" ? raw.roomId : ""
    const rawContent = typeof raw?.content === "string" ? raw.content : ""

    if (!UUID_RE.test(roomId)) {
      return fail(400, "Invalid message")
    }

    const trimmed = rawContent.trim()
    if (trimmed.length === 0) {
      return fail(400, "Invalid message")
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return fail(400, "Message too long")
    }

    // Redact AFTER the length checks (so the cap applies to what the user
    // actually typed) and BEFORE the insert: the stored row must be clean,
    // because realtime hands stored rows straight to every other client.
    // Redaction never lengthens the string, so the cap still holds.
    const content = redactForbiddenWords(trimmed)

    const rl = await rateLimitPersistent(`chat:post:user:${user.id}`, PER_USER)
    if (!rl.allowed) {
      return tooManyRequests(rl.retryAfterSeconds)
    }

    const { data: room, error: roomError } = await supabase
      .from("chat_rooms")
      .select("id")
      .eq("id", roomId)
      .eq("is_active", true)
      .maybeSingle()

    if (roomError || !room) {
      return fail(404, "Room not found")
    }

    const { data: inserted, error: insertError } = await supabase
      .from("chat_messages")
      .insert({ room_id: roomId, user_id: user.id, content })
      .select("id, room_id, user_id, content, created_at")
      .single()

    if (insertError || !inserted) {
      // Banned/suspended users land here via the restrictive is_active()
      // policy. One generic status for every rejection reason: a distinct
      // 403 would confirm "you are banned" and act as a policy-probing oracle.
      return fail(400, "Message could not be sent")
    }

    const { data: profileRow } = await supabase
      .from("public_profiles")
      .select("user_id, username, display_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle()

    // Rebuilt field-by-field so the payload matches ChatProfile exactly
    // (public_profiles is a view, so generated types may widen to nullable).
    const profiles: ChatProfile | null = profileRow
      ? {
          username: profileRow.username ?? "",
          display_name: profileRow.display_name ?? "",
          avatar_url: profileRow.avatar_url ?? null,
        }
      : null

    return ok({ message: { ...inserted, profiles } })
  } catch (error) {
    return handleApiError(error, "chat")
  }
}