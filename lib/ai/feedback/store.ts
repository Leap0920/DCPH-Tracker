/**
 * The feedback store: the port, its Supabase adapter, and the policy layer over
 * them, in the shape lib/ai/memory's stores take.
 *
 * A vote is (message, user, value, when, optional note). Two rules shape this
 * file. Ownership is resolved through the caller's own rows, never taken from
 * the request: `ai_messages` has no `user_id`, so a message is the caller's only
 * if its conversation is, and the resolve read joins through
 * `ai_conversations!inner(user_id)` and filters on the user exactly as the
 * transcript adapter does (D1). And a second vote is a replacement, not a
 * second row: the write upserts on `(message_id, user_id)`, which is the unique
 * index the migration creates.
 *
 * The port is a faithful view of the table and the store is the rule over it, so
 * a caller cannot forget that a non-assistant message is unratable or that a
 * message that is not theirs must not be written. Zero I/O of its own: the
 * client is declared structurally, so a test injects a recording fake instead of
 * constructing a real client with the live service-role key (constraint 10).
 */

/** A stored vote as the store reads it back. Times are epoch ms on this side. */
export interface FeedbackVote {
  messageId: string
  userId: string
  value: 1 | -1
  note: string | null
  createdAt: number
}

/** What a write supplies; the row's id and timestamp are the database's. */
export interface NewFeedback {
  messageId: string
  userId: string
  value: 1 | -1
  note: string | null
}

/**
 * The outcome of resolving a message against the caller. `ok` means the message
 * exists, is the caller's and is an assistant turn; the other two are refusals
 * the route turns into its own status, which is why they are values rather than
 * exceptions.
 */
export type FeedbackResolution =
  | { status: "ok"; messageId: string }
  | { status: "not_found" }
  | { status: "not_assistant" }

/** What a record call answers: the stored value, or the reason it was refused. */
export type FeedbackRecordResult =
  | { recorded: true; value: 1 | -1 }
  | { recorded: false; reason: "not_found" | "not_assistant" }

export interface FeedbackPort {
  resolve(messageId: string, userId: string): Promise<FeedbackResolution>
  upsert(input: NewFeedback): Promise<FeedbackVote>
  forMessages(ids: string[]): Promise<FeedbackVote[]>
}

export interface FeedbackStore {
  record(input: NewFeedback): Promise<FeedbackRecordResult>
  forMessages(ids: string[]): Promise<FeedbackVote[]>
}

export interface FeedbackResult {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
}

export interface FeedbackRowResult {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

/**
 * PostgREST's builder is a thenable that also chains, so the structural type has
 * to be both -- the same shape `MemoryQuery` takes in
 * lib/ai/memory/supabase-port.ts. `in` is on the builder because Phase 6's
 * reporting reads a set of message ids in one query.
 */
export interface FeedbackQuery extends PromiseLike<FeedbackResult> {
  eq(column: string, value: string | number): FeedbackQuery
  in(column: string, values: string[]): FeedbackQuery
  maybeSingle(): Promise<FeedbackRowResult>
}

export interface FeedbackUpsert extends PromiseLike<{ error: { message: string } | null }> {
  select(columns: string): { single(): Promise<FeedbackRowResult> }
}

export interface FeedbackClient {
  from(table: string): {
    select(columns: string): FeedbackQuery
    upsert(values: Record<string, unknown>[], options: { onConflict: string }): FeedbackUpsert
  }
}

const FEEDBACK_TABLE = "ai_message_feedback"
const MESSAGE_TABLE = "ai_messages"

/** Every column a vote reads; `created_at` is carried as epoch ms. */
const FEEDBACK_COLUMNS = "id,message_id,user_id,value,note,created_at"

/**
 * The `!inner` embed is the ownership check for the resolve read, the same
 * contract the transcript adapter states: PostgREST only applies the dotted
 * filter to an inner-joined relation, and the inner join then drops every
 * message whose conversation is someone else's. A read that drops the embed is a
 * cross-user read, which is what the tests assert against.
 */
const MESSAGE_SCOPE = "id,role,ai_conversations!inner(user_id)"

/** PostgREST's dotted path into the embedded conversation. */
const OWNER_FILTER = "ai_conversations.user_id"

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

function rowToVote(row: Record<string, unknown>): FeedbackVote {
  return {
    messageId: String(row.message_id),
    userId: String(row.user_id),
    // The migration's check constraint is what makes the cast honest: no other
    // value can exist in this column.
    value: Number(row.value) as 1 | -1,
    note: row.note == null ? null : String(row.note),
    createdAt: toEpochMs(row.created_at),
  }
}

/**
 * The database's own message, prefixed with the call that produced it: the
 * caller chooses how to degrade, but its log line has to say which query failed
 * (the `[ai-transcript]` precedent).
 */
function fail(method: string, message: string): never {
  throw new Error(`[ai-feedback] ${method}: ${message}`)
}

export function createSupabaseFeedbackPort(client: FeedbackClient): FeedbackPort {
  return {
    async resolve(messageId, userId) {
      const { data, error } = await client
        .from(MESSAGE_TABLE)
        .select(MESSAGE_SCOPE)
        .eq("id", messageId)
        // Both predicates in one query: a lookup by id alone cannot tell this
        // user's message from anyone else's.
        .eq(OWNER_FILTER, userId)
        .maybeSingle()
      if (error) fail("resolve", error.message)
      // "not there" and "not yours" are one outcome here: the route turns both
      // into a 404, and the response must not be usable to probe another user's
      // message ids.
      if (data === null) return { status: "not_found" }
      // You do not rate your own question, and a system turn is not an answer.
      if (data.role !== "assistant") return { status: "not_assistant" }
      return { status: "ok", messageId }
    },

    async upsert(input) {
      const { data, error } = await client
        .from(FEEDBACK_TABLE)
        .upsert(
          [
            {
              message_id: input.messageId,
              // The argument, not a value read back: the ownership the caller
              // asked for is the one that must reach the row.
              user_id: input.userId,
              value: input.value,
              // Always sent, including as null: a re-vote with no note has to
              // clear the note the previous vote left, and merge-duplicates only
              // updates the columns the payload carries.
              note: input.note,
            },
          ],
          // The unique index from 20260919140000: a second vote replaces the
          // first instead of stacking.
          { onConflict: "message_id,user_id" }
        )
        .select(FEEDBACK_COLUMNS)
        .single()
      if (error) fail("upsert", error.message)
      if (data === null) fail("upsert", "the upsert returned no row")
      return rowToVote(data)
    },

    async forMessages(ids) {
      // Nothing to read and nothing to scope: an empty set must not cost a round
      // trip (the `appendMessages` precedent).
      if (ids.length === 0) return []
      const { data, error } = await client
        .from(FEEDBACK_TABLE)
        .select(FEEDBACK_COLUMNS)
        .in("message_id", ids)
      if (error) fail("forMessages", error.message)
      return (data ?? []).map(rowToVote)
    },
  }
}

/**
 * The policy layer. `record` is the one method that writes, and it resolves the
 * message first: a message id that is not the caller's, or that is not an
 * assistant turn, never reaches the upsert. `forMessages` is a read Phase 6's
 * reporting consumes, and it short-circuits an empty set before the port sees
 * it.
 */
export function createFeedbackStore(deps: { port: FeedbackPort }): FeedbackStore {
  const port = deps.port

  return {
    async record(input) {
      const resolution = await port.resolve(input.messageId, input.userId)
      if (resolution.status !== "ok") {
        return { recorded: false, reason: resolution.status }
      }
      const vote = await port.upsert(input)
      return { recorded: true, value: vote.value }
    },

    async forMessages(ids) {
      if (ids.length === 0) return []
      return port.forMessages(ids)
    },
  }
}
