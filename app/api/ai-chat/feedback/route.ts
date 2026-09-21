// app/api/ai-chat/feedback/route.ts
//
// The write half of D3: a reader's thumbs up/down on an answer, plus an optional
// note. It is the only writer of ai_message_feedback.
//
// Two rules shape it. Ownership is never a client-supplied filter: a message id
// arrives as a claim, and the store resolves it through the caller's own
// conversations before anything is written, so another user's message is never
// voted on (D3). And a missing message and an unowned one are the same 404 -- a
// response that distinguished them would let a caller probe another user's
// message ids, exactly as `app/api/ai-chat/conversations/route.ts` states.
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { isSameOrigin } from "@/lib/origin-check"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  createFeedbackStore,
  createSupabaseFeedbackPort,
  type FeedbackClient,
  type FeedbackStore,
} from "@/lib/ai/feedback/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The message `app/api/admin/sync-crimes` already uses for the same condition. */
const MISSING_SERVICE_ROLE = "Missing Supabase service role env vars"

/** A vote body is a uuid, one of two integers and a short note. */
const MAX_BODY_BYTES = 2_000

/** The note's own bound; the error names it so a caller can trim rather than guess. */
const MAX_NOTE_CHARS = 500

/**
 * The id shape Postgres will accept as a uuid. Tested before the admin client is
 * built, so a malformed id costs a string test and never a round trip.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One answer for "no such message", "not yours" and "that is not an id": a
 * response that distinguished them would let a caller probe another user's ids.
 */
const NO_MESSAGE = "No message with that id."

const FeedbackBodySchema = z.object({
  messageId: z.string().regex(UUID_PATTERN, "A valid `messageId` is required."),
  value: z.union([z.literal(1), z.literal(-1)], "`value` must be 1 or -1."),
  note: z
    .string()
    .max(MAX_NOTE_CHARS, `Note too long (max ${MAX_NOTE_CHARS} characters).`)
    .optional(),
})

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } })
}

interface Authenticated {
  ok: true
  userId: string
}

/** The session gate, so an anonymous caller can never reach a database call. */
async function requireUser(): Promise<Authenticated | { ok: false; response: NextResponse }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, response: errorResponse("Please sign in to chat with DCPH Bot.", 401) }
  return { ok: true, userId: user.id }
}

/**
 * The store over the service-role client, or null when there is none. The table
 * has RLS on and no policies, so the user's own client cannot write it at all --
 * a missing key is a server misconfiguration, and a 500 says so rather than
 * pretending the vote was recorded.
 */
function feedbackStore(): FeedbackStore | null {
  const admin = createAdminClient()
  if (admin === null) return null

  const port = createSupabaseFeedbackPort(admin as unknown as FeedbackClient)
  return createFeedbackStore({ port })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return errorResponse("Cross-origin requests are not allowed.", 403)
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse("Request body too large.", 413)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }

  const parsed = FeedbackBodySchema.safeParse(body)
  if (!parsed.success) {
    // The first issue's message is the schema's own, so the note case names its
    // cap rather than a generic failure.
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid feedback body.", 400)
  }
  const { messageId, value } = parsed.data
  // An absent, empty or whitespace-only note is no note: the store sends null so
  // a re-vote clears whatever the previous one left.
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null

  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const store = feedbackStore()
  if (store === null) return errorResponse(MISSING_SERVICE_ROLE, 500)

  try {
    // The resolution is the ownership check: the store reads the message through
    // the caller's own conversations, so an id that is not theirs never reaches
    // the write. A non-assistant message is refused too -- you do not rate your
    // own question -- and it is a 400 rather than a 404 because the caller did
    // own it.
    const result = await store.record({ messageId, userId: auth.userId, value, note })
    if (!result.recorded) {
      return result.reason === "not_assistant"
        ? errorResponse("Only an assistant message can be rated.", 400)
        : errorResponse(NO_MESSAGE, 404)
    }

    return NextResponse.json(
      { recorded: true, value: result.value },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    // The adapter's message names the call that failed and carries the
    // database's own text; the user is looking at their own data, so there is
    // nothing to hide behind a generic 500.
    return errorResponse(messageOf(error), 500)
  }
}
