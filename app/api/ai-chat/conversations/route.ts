// app/api/ai-chat/conversations/route.ts
//
// The data half of D4: the conversations a user owns, one transcript, and the
// archive that stands in for a delete. The drawer that consumes it ships in
// Phase 5, which is why the surface is read-and-archive only.
//
// Two rules shape it, both inherited. Ownership is never a client-supplied
// filter -- the user id comes from the session and rides into every statement,
// so one user's id cannot name another's thread (D1: `ai_messages` has no
// `user_id`, so the conversation is the only place the owner can be read from).
// And a delete here is an archive: `archived_at` hides the conversation from
// every list while the transcript survives, because a mis-tap must not destroy a
// thread the user cannot get back (D4).
import { NextResponse } from "next/server"

import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Conversation, TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import {
  createSupabaseTranscriptPort,
  type TranscriptClient,
} from "@/lib/ai/conversations/supabase-port"
import { createTranscriptStore, type TranscriptStore } from "@/lib/ai/conversations/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The message `app/api/admin/sync-crimes` already uses for the same condition. */
const MISSING_SERVICE_ROLE = "Missing Supabase service role env vars"

/**
 * The id shape Postgres will accept as a uuid. Tested before the admin client is
 * built, so a malformed id costs a string test and never a round trip.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One answer for "no such conversation", "not yours" and "that is not an id":
 * a response that distinguished them would let a caller probe another user's
 * ids.
 */
const NO_CONVERSATION = "No conversation with that id."

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } })
}

/** The conversation as the drawer shows it: no user id, nothing internal. */
function toConversationPayload(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation.messageCount,
    lastMessageAt: conversation.lastMessageAt,
    archivedAt: conversation.archivedAt,
  }
}

/** A turn as the transcript view shows it. */
function toMessagePayload(turn: TranscriptTurn) {
  return { id: turn.id, role: turn.role, content: turn.content, createdAt: turn.createdAt }
}

interface Authenticated {
  ok: true
  userId: string
}

/**
 * The session gate, first for every method so an anonymous caller can never
 * reach a database call, however cheap.
 */
async function requireUser(): Promise<Authenticated | { ok: false; response: NextResponse }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, response: errorResponse("Please sign in to chat with DCPH Bot.", 401) }
  return { ok: true, userId: user.id }
}

interface TranscriptAccess {
  /** The reads, through the store that owns the caps, ordering and exclusion. */
  store: TranscriptStore
  /**
   * The archive is the one write here and the store has no method for it, so the
   * port travels alongside: the ownership predicate it carries on the update
   * itself is what keeps a lookup from being the only guard (Task 2 rule 3).
   */
  port: TranscriptPort
}

/**
 * The store and its port over the service-role client, or null when there is
 * none. The tables have RLS on and no policies, so the user's own client cannot
 * read them at all -- a missing key is a server misconfiguration, and a 500 says
 * so rather than pretending the user has no conversations.
 */
function transcriptAccess(): TranscriptAccess | null {
  const admin = createAdminClient()
  if (admin === null) return null

  const port = createSupabaseTranscriptPort(admin as unknown as TranscriptClient)
  return { port, store: createTranscriptStore({ port }) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  // Absent means the list. Present but not a uuid means the caller asked for
  // something that cannot exist, and it gets the same 404 an unowned id gets.
  const id = new URL(request.url).searchParams.get("id")
  if (id !== null && !UUID_PATTERN.test(id)) return errorResponse(NO_CONVERSATION, 404)

  const access = transcriptAccess()
  if (access === null) return errorResponse(MISSING_SERVICE_ROLE, 500)

  try {
    if (id === null) {
      // The store's own cap and ordering are the drawer's: 30 newest, archived
      // rows excluded.
      const conversations = await access.store.list(auth.userId)
      return NextResponse.json(
        { conversations: conversations.map(toConversationPayload) },
        { headers: { "Cache-Control": "no-store" } }
      )
    }

    // The scoped read is the ownership check, and it runs first so an id that is
    // not the caller's never reaches `ai_messages` (D1). It also supplies the
    // title and summary the transcript view shows.
    const conversation = await access.port.conversationOwnedBy(auth.userId, id)
    if (conversation === null) return errorResponse(NO_CONVERSATION, 404)

    // Oldest first, from the port's own ordering, and capped at the store's
    // default of 200 -- the drawer reads the tail of a thread.
    const messages = await access.store.transcript(auth.userId, id)
    // The second read is a second statement, so a row archived in between is
    // gone rather than an empty transcript; the same 404 keeps the two
    // indistinguishable.
    if (messages === null) return errorResponse(NO_CONVERSATION, 404)

    return NextResponse.json(
      {
        id: conversation.id,
        title: conversation.title,
        summary: conversation.summary,
        messages: messages.map(toMessagePayload),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    // The adapter's message names the call that failed and carries the
    // database's own text; the user is looking at their own data, so there is
    // nothing to hide behind a generic 500.
    return errorResponse(messageOf(error), 500)
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get("id") ?? ""
  if (!UUID_PATTERN.test(id)) {
    return errorResponse("A valid `id` query parameter is required.", 400)
  }

  const access = transcriptAccess()
  if (access === null) return errorResponse(MISSING_SERVICE_ROLE, 500)

  try {
    // Ownership is resolved first because the update reports no row count: a
    // lookup that misses is the only way to answer 404 instead of claiming an
    // archive that matched nothing.
    const conversation = await access.port.conversationOwnedBy(auth.userId, id)
    if (conversation === null) return errorResponse(NO_CONVERSATION, 404)

    // Archiving, never a hard delete (D4): the transcript survives a mis-tap,
    // and every list read excludes an archived row.
    await access.port.updateConversation(auth.userId, id, { archivedAt: Date.now() })

    return NextResponse.json({ archived: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    // Unreachable while the port keeps its contract; kept as the last line of
    // defence so a future change cannot turn an archive into an unhandled throw.
    return errorResponse(messageOf(error), 500)
  }
}
