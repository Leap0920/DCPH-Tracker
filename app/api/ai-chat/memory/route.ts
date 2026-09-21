// app/api/ai-chat/memory/route.ts
//
// The transparency half of AI memory: list what the bot remembers about the
// signed-in user, and delete one fact.
//
// Two rules shape it. Ownership is never a client-supplied filter -- the user id
// comes from the session and rides into every statement, so one user's id cannot
// name another's row. And deletion is not a hard-delete question here: the store
// removes the row, returns `false` for "not yours", "not there" and "the
// database could not answer" alike, and the route turns all three into the same
// 404, because a response that distinguished them would let a caller probe
// another user's ids (Task 13).
//
// AI_MEMORY is deliberately not consulted: D6 stops extraction and injection,
// not transparency. A user who hits the kill switch must still be able to see
// and remove what was stored before it.
import { NextResponse } from "next/server"

import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { isMemoryEnabled } from "@/lib/ai/memory/flag"
import type { MemoryFact } from "@/lib/ai/memory/port"
import { MEMORY_LIST_LIMIT, createMemoryStore, type MemoryStore } from "@/lib/ai/memory/store"
import { createSupabaseMemoryPort, type MemoryClient } from "@/lib/ai/memory/supabase-port"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The message `app/api/admin/sync-crimes` already uses for the same condition. */
const MISSING_SERVICE_ROLE = "Missing Supabase service role env vars"

/**
 * The id shape Postgres will accept as a uuid. Tested before the admin client is
 * built, so a malformed id costs a string test and never a round trip.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } })
}

/** The fact as the page shows it: no user id, no provenance, nothing internal. */
function toPayload(fact: MemoryFact) {
  return {
    id: fact.id,
    kind: fact.kind,
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence,
    lastConfirmedAt: fact.lastConfirmedAt,
    status: fact.status,
  }
}

interface Authenticated {
  ok: true
  userId: string
}

/**
 * The session gate, first for both methods so an anonymous caller can never
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

/**
 * The store over the service-role client, or null when there is none. The table
 * has RLS on and no policies, so the user's own client cannot read it at all --
 * a missing key is a server misconfiguration, and a 500 says so rather than
 * pretending the user has no memories.
 */
function memoryStore(): MemoryStore | null {
  const admin = createAdminClient()
  if (admin === null) return null

  const port = createSupabaseMemoryPort(admin as unknown as MemoryClient)
  return createMemoryStore({ port, log: (message) => console.error(message) })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const store = memoryStore()
  if (store === null) return errorResponse(MISSING_SERVICE_ROLE, 500)

  try {
    // The store's order is the page's order (active first, then newest-confirmed)
    // and its default limit is the cap reported to the client.
    const facts = await store.list(auth.userId)
    // `memoryEnabled` reports the switch, it does not consult it: D6 stops
    // extraction and injection, not transparency, so the facts are returned
    // either way. It exists so the page can tell "memory is off" from "nothing
    // stored yet" -- both of which arrive as an empty `facts` array.
    return NextResponse.json(
      { facts: facts.map(toPayload), cap: MEMORY_LIST_LIMIT, memoryEnabled: isMemoryEnabled() },
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

  const store = memoryStore()
  if (store === null) return errorResponse(MISSING_SERVICE_ROLE, 500)

  try {
    const deleted = await store.delete(auth.userId, id)
    // The store contains a port failure into `false` (Task 8 rule 4), so a
    // database error lands here as "not yours" rather than as a 500: the two
    // must be indistinguishable, and a failed delete is one the user can retry.
    if (!deleted) return errorResponse("No memory with that id.", 404)

    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    // Unreachable while the store keeps that contract; kept as the last line of
    // defence so a future change cannot turn a delete into an unhandled throw.
    return errorResponse(messageOf(error), 500)
  }
}
