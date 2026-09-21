/**
 * The Supabase adapter for the memory port -- the only file in this task that
 * knows PostgREST.
 *
 * Two rules shape it, both carried over from the transcript adapter. Ownership
 * rides inside every query: `ai_user_memories.user_id` is what makes a fact this
 * user's, and a memory read without it is a cross-user leak. And an error always
 * rejects -- PostgREST's `{ error }` and a dropped connection both leave the port
 * as an exception carrying the database's message and the method that produced
 * it, so the caller decides how to degrade. Returning `[]` for "I could not read
 * your facts" would look like a user with no memory at all.
 *
 * `supersede` is the one method that is not a table write. Replacing an active
 * slot needs three statements in one transaction (rule 3, migration
 * 20260919120000), and this adapter is the only place that knows the function's
 * snake_case parameter names and the shape of what it returns.
 *
 * Zero I/O of its own: the client is declared structurally, so a test injects a
 * recording fake instead of constructing a real client with the live
 * service-role key (constraint 10).
 */

import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"
import type { MemoryKind } from "@/lib/ai/memory/slots"

export interface MemoryResult {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
  /** PostgREST reports it only for a `count: exact` request. */
  count?: number | null
}

export interface MemoryRowResult {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

/**
 * PostgREST's builder is a thenable that also chains, so the structural type has
 * to be both -- the same shape `TranscriptQuery` takes in
 * lib/ai/conversations/supabase-port.ts. `select` is on the builder as well
 * because a delete has to read back what it matched: without it, "nothing
 * matched" and "the request failed" are the same empty body.
 */
export interface MemoryQuery extends PromiseLike<MemoryResult> {
  eq(column: string, value: string | number): MemoryQuery
  is(column: string, value: null): MemoryQuery
  order(column: string, options: { ascending: boolean }): MemoryQuery
  limit(count: number): MemoryQuery
  select(columns: string): MemoryQuery
}

export interface MemoryInsert extends PromiseLike<{ error: { message: string } | null }> {
  select(columns: string): { single(): Promise<MemoryRowResult> }
}

export interface MemoryClient {
  from(table: string): {
    select(columns: string, options?: { count: "exact"; head: boolean }): MemoryQuery
    insert(values: Record<string, unknown>[]): MemoryInsert
    update(values: Record<string, unknown>): MemoryQuery
    delete(): MemoryQuery
  }
  rpc(
    fn: "ai_memory_supersede",
    args: {
      p_user_id: string
      p_old_id: string
      p_kind: string
      p_key: string
      p_value: string
      p_confidence: number
      p_source_message_id: string | null
      p_expires_at: string | null
    }
  ): Promise<MemoryRowResult>
}

export interface MemoryPortDeps {
  /**
   * The adapter's own clock, used only when a caller hands it a timestamp that
   * cannot be represented -- every method otherwise takes the caller's `now`.
   */
  now?: () => number
}

const MEMORY_TABLE = "ai_user_memories"

/** Every column the port's `MemoryFact` reads; created_at has no port field. */
const MEMORY_COLUMNS =
  "id,user_id,kind,key,value,confidence,status,superseded_by,source_message_id,evidence_count,last_confirmed_at,expires_at"

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
 * unrepresentable one: a bad clock must not lose the fact.
 */
function toIso(ms: number, fallback: number): string {
  return new Date(Number.isFinite(ms) ? ms : fallback).toISOString()
}

/** `null` is a real value for every nullable column here, so it survives as null. */
function nullable(value: unknown): string | null {
  return value == null ? null : String(value)
}

function rowToFact(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    // The migration's check constraint is what makes the casts honest: no other
    // value can exist in these two columns.
    kind: row.kind as MemoryKind,
    key: String(row.key),
    value: String(row.value ?? ""),
    confidence: Number(row.confidence ?? 0),
    status: row.status as MemoryFact["status"],
    supersededBy: nullable(row.superseded_by),
    sourceMessageId: nullable(row.source_message_id),
    evidenceCount: Number(row.evidence_count ?? 1),
    lastConfirmedAt: toEpochMs(row.last_confirmed_at),
    expiresAt: row.expires_at == null ? null : toEpochMs(row.expires_at),
  }
}

/**
 * The database's own message, prefixed with the call that produced it: the
 * caller chooses how to degrade, but its log line has to say which query failed
 * (the `[ai-transcript]` precedent). Printed nowhere here, so the line appears
 * exactly once -- where the caller handles the failure.
 */
function fail(method: string, message: string): never {
  throw new Error(`[ai-memory] ${method}: ${message}`)
}

export function createSupabaseMemoryPort(
  client: MemoryClient,
  deps: MemoryPortDeps = {}
): MemoryPort {
  const clock = deps.now ?? Date.now

  return {
    async loadActive(userId) {
      const { data, error } = await client
        .from(MEMORY_TABLE)
        .select(MEMORY_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "active")
        // The index is (user_id, status, last_confirmed_at desc), so this read
        // is one index scan and the newest-confirmed order is free. The expiry
        // is deliberately not filtered here: it is a clock decision and the
        // store owns the clock.
        .order("last_confirmed_at", { ascending: false })
      if (error) fail("loadActive", error.message)
      return (data ?? []).map(rowToFact)
    },

    async countActive(userId) {
      // A head request: the cap check needs the number, not the rows. A count
      // PostgREST omits reads as zero facts, because NaN would poison every
      // comparison against the cap.
      const { count, error } = await client
        .from(MEMORY_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "active")
      if (error) fail("countActive", error.message)
      return count ?? 0
    },

    async insert(userId, fact, now) {
      const { data, error } = await client
        .from(MEMORY_TABLE)
        .insert([
          {
            // The argument, not `fact.userId`: the ownership the caller asked
            // for is the one that must reach the row.
            user_id: userId,
            kind: fact.kind,
            key: fact.key,
            value: fact.value,
            confidence: fact.confidence,
            source_message_id: fact.sourceMessageId,
            expires_at: fact.expiresAt === null ? null : toIso(fact.expiresAt, clock()),
            // The app's clock, so a write and the read that follows it agree
            // about how old the fact is (Task 9's decay term).
            last_confirmed_at: toIso(now, clock()),
            // `status` is left to the column default, 'active': sending it here
            // would suggest this method can write any other status, and it must
            // not -- the supersede function is the only path to 'superseded'.
          },
        ])
        .select(MEMORY_COLUMNS)
        .single()
      if (error) fail("insert", error.message)
      if (data === null) fail("insert", "the insert returned no row")
      return rowToFact(data)
    },

    async update(userId, id, patch, now) {
      const values: Record<string, unknown> = {
        confidence: patch.confidence,
        evidence_count: patch.evidenceCount,
        last_confirmed_at: toIso(patch.lastConfirmedAt, clock()),
        // Every write moves updated_at, so a confirmation is distinguishable
        // from the insert that created the row without comparing timestamps.
        updated_at: toIso(now, clock()),
      }
      // `undefined` means "leave the column alone": a confirmation with no new
      // value keeps the stored rendering, the one the user has seen.
      if (patch.value !== undefined) values.value = patch.value

      // The ownership predicate rides on the update itself: a lookup first
      // would leave a window for a concurrent write across users.
      const { error } = await client
        .from(MEMORY_TABLE)
        .update(values)
        .eq("id", id)
        .eq("user_id", userId)
      if (error) fail("update", error.message)
    },

    // The port's `now` is deliberately not accepted: the function stamps the new
    // row with the database's now() in the same transaction, and a caller's
    // clock could disagree with the row it just replaced.
    async supersede(userId, oldId, replacement) {
      const { data, error } = await client.rpc("ai_memory_supersede", {
        p_user_id: userId,
        p_old_id: oldId,
        p_kind: replacement.kind,
        p_key: replacement.key,
        p_value: replacement.value,
        p_confidence: replacement.confidence,
        p_source_message_id: replacement.sourceMessageId,
        p_expires_at: replacement.expiresAt === null ? null : toIso(replacement.expiresAt, clock()),
      })
      if (error) fail("supersede", error.message)
      // A function returning a composite type comes back as one object; the
      // array branch keeps a driver that wraps it in one from losing the row.
      const row = Array.isArray(data) ? data[0] : data
      if (row == null) fail("supersede", "the function returned no row")
      return rowToFact(row)
    },

    async list(userId, limit) {
      const { data, error } = await client
        .from(MEMORY_TABLE)
        .select(MEMORY_COLUMNS)
        .eq("user_id", userId)
        // Newest-confirmed first is the page's own order. The active-before-
        // superseded grouping is the store's policy: it is a reading rule, not
        // a storage one.
        .order("last_confirmed_at", { ascending: false })
        .limit(limit)
      if (error) fail("list", error.message)
      return (data ?? []).map(rowToFact)
    },

    async delete(userId, id) {
      const { data, error } = await client
        .from(MEMORY_TABLE)
        .delete()
        .eq("id", id)
        // Ownership on the statement itself, never a lookup first: another
        // user's id must not be removable, and the route's 404 must not depend
        // on a second round trip.
        .eq("user_id", userId)
        // `select` is what makes "nothing matched" observable -- PostgREST
        // returns the removed rows, and an empty set is the honest `false`.
        .select("id")
      if (error) fail("delete", error.message)
      return (data ?? []).length > 0
    },
  }
}
