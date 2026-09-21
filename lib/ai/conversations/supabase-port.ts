/**
 * The Supabase adapter for the transcript port — the only file in this plan
 * that knows PostgREST.
 *
 * Two rules shape it. Ownership rides inside the query (D1): `ai_messages` has
 * no `user_id`, so message reads embed `ai_conversations!inner(user_id)` and
 * filter on it, message writes resolve the conversation as the caller first, and
 * an update carries the predicate on the update itself. And an error always
 * rejects: PostgREST's `{ error }` and a dropped connection both leave the port
 * as an exception carrying the database's message. Returning `[]` for "I could
 * not read your history" would look like an empty conversation, and the store
 * above is the layer that decides how to degrade (constraint 14).
 *
 * Zero I/O of its own: the client is declared structurally, so a test injects a
 * recording fake instead of constructing a real client with the live
 * service-role key (constraint 10).
 */

import type {
  Conversation,
  ConversationPatch,
  NewConversation,
  TranscriptPort,
  TranscriptTurn,
} from "@/lib/ai/conversations/port"

export interface TranscriptResult {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
}

export interface TranscriptRowResult {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

/**
 * PostgREST's builder is a thenable that also chains, so the structural type has
 * to be both — the same shape `WatchQuery` takes in lib/ai/tools/next-unwatched.ts.
 * It extends `PromiseLike` rather than `Promise` because that is what
 * supabase-js's builder implements, and `await` works on either.
 */
export interface TranscriptQuery extends PromiseLike<TranscriptResult> {
  eq(column: string, value: string | number): TranscriptQuery
  is(column: string, value: null): TranscriptQuery
  gte(column: string, value: string): TranscriptQuery
  order(column: string, options: { ascending: boolean }): TranscriptQuery
  limit(count: number): TranscriptQuery
  range(from: number, to: number): TranscriptQuery
  textSearch(column: string, query: string): TranscriptQuery
  maybeSingle(): Promise<TranscriptRowResult>
}

export interface TranscriptInsert extends PromiseLike<{ error: { message: string } | null }> {
  select(columns: string): { single(): Promise<TranscriptRowResult> }
}

export interface TranscriptClient {
  from(table: string): {
    select(columns: string): TranscriptQuery
    insert(values: Record<string, unknown>[]): TranscriptInsert
    update(values: Record<string, unknown>): TranscriptQuery
  }
}

export interface TranscriptPortDeps {
  /**
   * The adapter's own clock, used only when a caller hands it a timestamp that
   * cannot be represented — every method otherwise takes the caller's `now`.
   */
  now?: () => number
}

const CONVERSATION_TABLE = "ai_conversations"
const MESSAGE_TABLE = "ai_messages"

/** Every column the port's `Conversation` reads; `created_at` has no port field. */
const CONVERSATION_COLUMNS =
  "id,user_id,title,summary,summarized_through,message_count,last_message_at,archived_at"

const MESSAGE_COLUMNS = "id,role,content,created_at,conversation_id"

/**
 * The `!inner` embed is the whole ownership check for a message read: PostgREST
 * only applies the dotted `ai_conversations.user_id` filter to an embedded
 * relation that is inner-joined, and the inner join then drops every message
 * whose conversation is someone else's. A read that drops the embed is a
 * cross-user read, which is what the tests assert against.
 */
const MESSAGE_SCOPE = `${MESSAGE_COLUMNS},${CONVERSATION_TABLE}!inner(user_id)`

/** PostgREST's dotted path into the embedded conversation. */
const OWNER_FILTER = `${CONVERSATION_TABLE}.user_id`

/**
 * Epoch ms for a timestamptz column. PostgREST answers with ISO text; a number
 * or a `Date` is accepted as well so a driver change cannot silently produce
 * NaN, and an undatable value stays NaN rather than becoming 1970.
 */
function toEpochMs(value: unknown): number {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") return Date.parse(value)
  return Number.NaN
}

/**
 * ISO text for a timestamptz column. `new Date(NaN).toISOString()` throws a
 * RangeError from inside the write, so the adapter's clock stands in for an
 * unrepresentable one: a bad clock must not lose the write.
 */
function toIso(ms: number, fallback: number): string {
  return new Date(Number.isFinite(ms) ? ms : fallback).toISOString()
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: row.title == null ? null : String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    summarizedThrough: Number(row.summarized_through ?? 0),
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: toEpochMs(row.last_message_at),
    archivedAt: row.archived_at == null ? null : toEpochMs(row.archived_at),
  }
}

function rowToTurn(row: Record<string, unknown>): TranscriptTurn {
  return {
    id: String(row.id),
    // The migration's check constraint is what makes the cast honest: no other
    // value can exist in this column.
    role: row.role as TranscriptTurn["role"],
    content: String(row.content ?? ""),
    createdAt: toEpochMs(row.created_at),
    // A message read spans conversations (`searchMessages`), so the row has to
    // carry which one the turn belongs to. Absent stays undefined rather than
    // becoming the string "undefined".
    conversationId: row.conversation_id == null ? undefined : String(row.conversation_id),
  }
}

/**
 * The database's own message, prefixed with the call that produced it: the store
 * above chooses how to degrade, but its log line has to say which query failed.
 */
function fail(method: string, message: string): never {
  throw new Error(`[ai-transcript] ${method}: ${message}`)
}

export function createSupabaseTranscriptPort(
  client: TranscriptClient,
  deps: TranscriptPortDeps = {}
): TranscriptPort {
  const clock = deps.now ?? Date.now

  return {
    async conversationOwnedBy(userId, conversationId) {
      const { data, error } = await client
        .from(CONVERSATION_TABLE)
        .select(CONVERSATION_COLUMNS)
        .eq("id", conversationId)
        // Both predicates in one query: a lookup by id alone cannot tell this
        // user's conversation from anyone else's.
        .eq("user_id", userId)
        .maybeSingle()
      if (error) fail("conversationOwnedBy", error.message)
      return data === null ? null : rowToConversation(data)
    },

    async recentConversation(userId, since) {
      const { data, error } = await client
        .from(CONVERSATION_TABLE)
        .select(CONVERSATION_COLUMNS)
        .eq("user_id", userId)
        // An archived conversation is one the user deleted; attaching to it
        // would resurrect the transcript they threw away.
        .is("archived_at", null)
        .gte("last_message_at", toIso(since, clock()))
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) fail("recentConversation", error.message)
      return data === null ? null : rowToConversation(data)
    },

    async createConversation(row, now) {
      const { data, error } = await client
        .from(CONVERSATION_TABLE)
        .insert([
          {
            user_id: row.userId,
            title: row.title,
            // The app's clock, not the database's: the attach window in
            // `recentConversation` compares against the same clock the route
            // passes in, and tests inject it.
            last_message_at: toIso(now, clock()),
          },
        ])
        .select(CONVERSATION_COLUMNS)
        .single()
      if (error) fail("createConversation", error.message)
      if (data === null) fail("createConversation", "the insert returned no row")
      return rowToConversation(data)
    },

    async updateConversation(userId, id, patch) {
      const values: Record<string, unknown> = {}
      if (patch.title !== undefined) values.title = patch.title
      if (patch.summary !== undefined) values.summary = patch.summary
      if (patch.summarizedThrough !== undefined) values.summarized_through = patch.summarizedThrough
      if (patch.messageCount !== undefined) values.message_count = patch.messageCount
      if (patch.lastMessageAt !== undefined) {
        values.last_message_at = toIso(patch.lastMessageAt, clock())
      }
      // `undefined` means "leave the column alone", so an explicit null has to
      // survive the mapping on its own: it is how an archive is undone.
      if (patch.archivedAt !== undefined) {
        values.archived_at = patch.archivedAt === null ? null : toIso(patch.archivedAt, clock())
      }

      // PostgREST rejects an empty PATCH body, and a patch with every field
      // absent has nothing to write.
      if (Object.keys(values).length === 0) return

      // The ownership predicate rides on the update itself (D1): a lookup first
      // would leave a window for a concurrent archive to be overwritten, and an
      // unscoped update would write into another user's conversation.
      const { error } = await client
        .from(CONVERSATION_TABLE)
        .update(values)
        .eq("id", id)
        .eq("user_id", userId)
      if (error) fail("updateConversation", error.message)
    },

    async lastMessages(userId, conversationId, limit) {
      const { data, error } = await client
        .from(MESSAGE_TABLE)
        .select(MESSAGE_SCOPE)
        .eq("conversation_id", conversationId)
        .eq(OWNER_FILTER, userId)
        // Descending plus a limit is what selects the latest window; the caller
        // reads a transcript, so the order is restored here rather than there.
        .order("created_at", { ascending: false })
        .limit(limit)
      if (error) fail("lastMessages", error.message)
      return (data ?? []).slice().reverse().map(rowToTurn)
    },

    async messagesRange(userId, conversationId, from, to) {
      const { data, error } = await client
        .from(MESSAGE_TABLE)
        .select(MESSAGE_SCOPE)
        .eq("conversation_id", conversationId)
        .eq(OWNER_FILTER, userId)
        .order("created_at", { ascending: true })
        // PostgREST's range is inclusive at both ends; the port's `to` is
        // exclusive, as in Array.prototype.slice.
        .range(from, to - 1)
      if (error) fail("messagesRange", error.message)
      return (data ?? []).map(rowToTurn)
    },

    async appendMessages(userId, conversationId, turns, now) {
      // Nothing to write and nothing to own: an empty append must not cost two
      // round trips.
      if (turns.length === 0) return

      // `ai_messages` has no user_id (D1), so the only way to know these turns
      // belong to the caller is to resolve the conversation as the caller
      // first. A miss is a refusal, never a best-effort write.
      const { data, error } = await client
        .from(CONVERSATION_TABLE)
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle()
      if (error) fail("appendMessages", error.message)
      if (data === null) fail("appendMessages", `conversation ${conversationId} is not the caller's`)

      const createdAt = toIso(now, clock())
      const { error: insertError } = await client.from(MESSAGE_TABLE).insert(
        turns.map((turn) => ({
          conversation_id: conversationId,
          role: turn.role,
          content: turn.content,
          created_at: createdAt,
        }))
      )
      if (insertError) fail("appendMessages", insertError.message)
    },

    async listConversations(userId, limit) {
      const { data, error } = await client
        .from(CONVERSATION_TABLE)
        .select(CONVERSATION_COLUMNS)
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("last_message_at", { ascending: false })
        .limit(limit)
      if (error) fail("listConversations", error.message)
      return (data ?? []).map(rowToConversation)
    },

    async searchMessages(userId, query, limit) {
      // A search spans the user's conversations, so the embed is the only
      // ownership filter there is — without it this reads everyone's history.
      const { data, error } = await client
        .from(MESSAGE_TABLE)
        .select(MESSAGE_SCOPE)
        .eq(OWNER_FILTER, userId)
        .textSearch("fts", query)
        .order("created_at", { ascending: false })
        .limit(limit)
      if (error) fail("searchMessages", error.message)
      return (data ?? []).map(rowToTurn)
    },
  }
}
