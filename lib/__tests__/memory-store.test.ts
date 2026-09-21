import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"
import { MEMORY_LIST_LIMIT, createMemoryStore } from "@/lib/ai/memory/store"
import {
  createSupabaseMemoryPort,
  type MemoryClient,
  type MemoryInsert,
  type MemoryQuery,
  type MemoryResult,
} from "@/lib/ai/memory/supabase-port"

/**
 * The memory store, its Supabase adapter, and the structural assertions for the
 * migration `supersede` depends on.
 *
 * Nothing here constructs a Supabase client or touches a network (constraint
 * 10): the adapter is tested against a hand-written recording fake typed against
 * the locally declared client interface, and the store against a recording fake
 * port, so the calls are assertions rather than assumptions. The migration is
 * never executed -- it is applied by hand, so its shape is the only thing a test
 * in this repo can honestly assert (constraint 12).
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const MEMORY_ID = "44444444-4444-4444-8444-444444444444"
const MESSAGE_ID = "66666666-6666-4666-8666-666666666666"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const NOW_ISO = "2026-09-19T10:00:00.000Z"
const LATER = NOW + 60_000
const LATER_ISO = "2026-09-19T10:01:00.000Z"
const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRES_AT = NOW + 90 * DAY_MS
const EXPIRES_ISO = "2026-12-18T10:00:00.000Z"

const FACT_ROW: Record<string, unknown> = {
  id: MEMORY_ID,
  user_id: USER_ID,
  kind: "preference",
  key: "favorite_character",
  value: "Haibara",
  confidence: 0.9,
  status: "active",
  superseded_by: null,
  source_message_id: MESSAGE_ID,
  evidence_count: 2,
  last_confirmed_at: NOW_ISO,
  expires_at: null,
}

const FACT: MemoryFact = {
  id: MEMORY_ID,
  userId: USER_ID,
  kind: "preference",
  key: "favorite_character",
  value: "Haibara",
  confidence: 0.9,
  status: "active",
  supersededBy: null,
  sourceMessageId: MESSAGE_ID,
  evidenceCount: 2,
  lastConfirmedAt: NOW,
  expiresAt: null,
}

const SUPERSEDED_ROW: Record<string, unknown> = {
  ...FACT_ROW,
  id: "77777777-7777-4777-8777-777777777777",
  value: "Ayumi",
  confidence: 0.6,
  status: "superseded",
  superseded_by: MEMORY_ID,
  source_message_id: null,
  evidence_count: 1,
  last_confirmed_at: "2026-09-19T09:00:00.000Z",
  expires_at: EXPIRES_ISO,
}

const SUPERSEDED_FACT: MemoryFact = {
  id: "77777777-7777-4777-8777-777777777777",
  userId: USER_ID,
  kind: "preference",
  key: "favorite_character",
  value: "Ayumi",
  confidence: 0.6,
  status: "superseded",
  supersededBy: MEMORY_ID,
  sourceMessageId: null,
  evidenceCount: 1,
  lastConfirmedAt: Date.parse("2026-09-19T09:00:00.000Z"),
  expiresAt: EXPIRES_AT,
}

function fact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    userId: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.9,
    status: "active",
    supersededBy: null,
    sourceMessageId: null,
    evidenceCount: 1,
    lastConfirmedAt: NOW,
    expiresAt: null,
    ...overrides,
  }
}

function newFact(overrides: Partial<NewFact> = {}): NewFact {
  return {
    userId: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.9,
    sourceMessageId: null,
    expiresAt: null,
    ...overrides,
  }
}

interface RecordedPortCall {
  method: keyof MemoryPort
  args: unknown[]
}

interface PortScript {
  active?: MemoryFact[]
  count?: number
  inserted?: MemoryFact
  superseded?: MemoryFact
  listed?: MemoryFact[]
  deleted?: boolean
  /** The one method that rejects, as a dropped connection would. */
  reject?: keyof MemoryPort
}

/**
 * A recording stand-in for the port. Every method logs the user id it was
 * handed first, so "we forgot the ownership filter" is a test failure rather
 * than a review finding -- the same shape the transcript store's fake uses.
 */
function createFakeMemoryPort(script: PortScript = {}): { port: MemoryPort; calls: RecordedPortCall[] } {
  const calls: RecordedPortCall[] = []

  function record(method: keyof MemoryPort, args: unknown[]): void {
    calls.push({ method, args })
  }

  function guard(method: keyof MemoryPort): void {
    if (script.reject === method) throw new Error(`${method} unavailable`)
  }

  const port: MemoryPort = {
    async loadActive(userId) {
      record("loadActive", [userId])
      guard("loadActive")
      return script.active ?? []
    },
    async countActive(userId) {
      record("countActive", [userId])
      guard("countActive")
      return script.count ?? 0
    },
    async insert(userId, insertion, now) {
      record("insert", [userId, insertion, now])
      guard("insert")
      return script.inserted ?? fact({ id: "generated", userId, value: insertion.value })
    },
    async update(userId, id, patch, now) {
      record("update", [userId, id, patch, now])
      guard("update")
    },
    async supersede(userId, oldId, replacement, now) {
      record("supersede", [userId, oldId, replacement, now])
      guard("supersede")
      return script.superseded ?? fact({ id: "generated", userId, value: replacement.value })
    },
    async list(userId, limit) {
      record("list", [userId, limit])
      guard("list")
      return script.listed ?? []
    },
    async delete(userId, id) {
      record("delete", [userId, id])
      guard("delete")
      return script.deleted ?? false
    },
  }

  return { port, calls }
}

interface RecordedClientCall {
  table: string
  method: string
  args: unknown[]
}

interface ClientScript {
  /** Canned reply per table, as PostgREST would return it. */
  rows?: Record<string, Record<string, unknown>[] | null>
  /** A PostgREST failure: every call resolves with `{ error }`, exactly as the real client does. */
  error?: { message: string }
  /** A dropped connection: every call rejects instead of resolving. */
  reject?: Error
  /** The row `insert().select().single()` reads back. */
  inserted?: Record<string, unknown> | null
  /** The row the supersede function returns. */
  rpc?: Record<string, unknown> | null
  /** PostgREST's `count` for a head request. */
  count?: number | null
}

/**
 * A scripted, recording stand-in for the Supabase client, typed against the
 * adapter's locally declared interface so it needs no `@supabase/supabase-js`
 * import and never reaches the network.
 */
function createRecordingClient(script: ClientScript = {}): {
  client: MemoryClient
  calls: RecordedClientCall[]
} {
  const calls: RecordedClientCall[] = []

  function record(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args })
  }

  function settle<T>(value: T): PromiseLike<T> {
    return script.reject ? Promise.reject(script.reject) : Promise.resolve(value)
  }

  // No return annotation: the same shape answers a list query and a
  // `single()` read, and `count` is simply ignored by the second.
  function failure() {
    return { data: null, error: script.error ?? { message: "unknown" }, count: null }
  }

  function query(table: string, rows: Record<string, unknown>[] | null): MemoryQuery {
    const chain: MemoryQuery = {
      then(onFulfilled, onRejected) {
        const reply: MemoryResult = script.error
          ? failure()
          : { data: rows, error: null, count: script.count ?? null }
        return settle(reply).then(onFulfilled, onRejected)
      },
      eq(column, value) {
        record(table, "eq", [column, value])
        return chain
      },
      is(column, value) {
        record(table, "is", [column, value])
        return chain
      },
      order(column, options) {
        record(table, "order", [column, options])
        return chain
      },
      limit(count) {
        record(table, "limit", [count])
        return chain
      },
      select(columns) {
        record(table, "select", [columns])
        return chain
      },
    }
    return chain
  }

  const client: MemoryClient = {
    from(table) {
      return {
        select(columns, options) {
          record(table, "select", options === undefined ? [columns] : [columns, options])
          return query(table, script.rows?.[table] ?? null)
        },
        insert(values): MemoryInsert {
          record(table, "insert", [values])
          return {
            then(onFulfilled, onRejected) {
              return settle({ error: script.error ?? null }).then(onFulfilled, onRejected)
            },
            select(columns) {
              record(table, "insert.select", [columns])
              return {
                single() {
                  record(table, "single", [])
                  if (script.error) return Promise.resolve(failure())
                  return Promise.resolve({ data: script.inserted ?? null, error: null })
                },
              }
            },
          }
        },
        update(values) {
          record(table, "update", [values])
          return query(table, null)
        },
        delete() {
          record(table, "delete", [])
          return query(table, script.rows?.[table] ?? null)
        },
      }
    },
    async rpc(fn, args) {
      record("rpc", "rpc", [fn, args])
      if (script.reject) throw script.reject
      return { data: script.rpc ?? null, error: script.error ?? null }
    },
  }

  return { client, calls }
}

const TABLE = "ai_user_memories"

describe("createMemoryStore policy", () => {
  it("carries the user id into the port on every single method", async () => {
    const { port, calls } = createFakeMemoryPort()
    const store = createMemoryStore({ port, now: () => NOW })

    await store.loadActive(USER_ID)
    await store.countActive(USER_ID)
    await store.insert(USER_ID, newFact(), NOW)
    await store.update(USER_ID, MEMORY_ID, { confidence: 0.9, evidenceCount: 2, lastConfirmedAt: NOW }, NOW)
    await store.supersede(USER_ID, MEMORY_ID, newFact(), NOW)
    await store.list(USER_ID, 5)
    await store.delete(USER_ID, MEMORY_ID)

    expect(calls.map((call) => call.method)).toEqual([
      "loadActive",
      "countActive",
      "insert",
      "update",
      "supersede",
      "list",
      "delete",
    ])
    // A memory read without the user's id is a cross-user leak: every method
    // hands it over, and this is the assertion that keeps a refactor honest.
    for (const call of calls) expect(call.args[0], call.method).toBe(USER_ID)
  })

  it("loadActive keeps only active facts that have not expired", async () => {
    const fresh = fact({ id: "fresh" })
    const future = fact({ id: "future", expiresAt: NOW + DAY_MS })
    const onTheBoundary = fact({ id: "boundary", expiresAt: NOW })
    const past = fact({ id: "past", expiresAt: NOW - 1 })
    const superseded = fact({ id: "superseded", status: "superseded", supersededBy: FACT.id })
    const expired = fact({ id: "expired", status: "expired" })

    const { port } = createFakeMemoryPort({
      active: [fresh, future, onTheBoundary, past, superseded, expired],
    })

    // The expiry is the policy's, not the database's: a progress fact whose
    // status was never flipped must still not reach the prompt (rule 2), and
    // the boundary instant counts as expired.
    await expect(createMemoryStore({ port, now: () => NOW }).loadActive(USER_ID)).resolves.toEqual([
      fresh,
      future,
    ])
  })

  it("supersede goes through the port's atomic write and marks nothing by hand", async () => {
    const replaced = fact({ id: "replacement", value: "Ayumi" })
    const { port, calls } = createFakeMemoryPort({ superseded: replaced })
    const store = createMemoryStore({ port, now: () => NOW })
    const replacement = newFact({ value: "Ayumi" })

    await expect(store.supersede(USER_ID, MEMORY_ID, replacement, NOW)).resolves.toEqual(replaced)

    // One call, and it is the port's supersede: a store that inserted and then
    // marked would be rejected by the partial unique index on the active slot.
    expect(calls).toEqual([{ method: "supersede", args: [USER_ID, MEMORY_ID, replacement, NOW] }])
  })

  it("delete resolves false for an id that is not the user's", async () => {
    const { port, calls } = createFakeMemoryPort()

    await expect(createMemoryStore({ port, now: () => NOW }).delete(USER_ID, MEMORY_ID)).resolves.toBe(false)

    // The id travels with the user id, so "not yours" and "not there" are the
    // same answer without a second round trip.
    expect(calls).toEqual([{ method: "delete", args: [USER_ID, MEMORY_ID] }])
  })

  it("delete never throws, even when the port rejects", async () => {
    const { port } = createFakeMemoryPort({ reject: "delete" })
    const lines: string[] = []
    const store = createMemoryStore({ port, now: () => NOW, log: (line) => lines.push(line) })

    // A failed delete and a missing row are both "not deleted": the route turns
    // either into a 404, and an exception here would be a 500 for a request the
    // user can simply retry (rule 4).
    await expect(store.delete(USER_ID, MEMORY_ID)).resolves.toBe(false)
    expect(lines).toEqual(["[ai-memory] delete failed: delete unavailable"])
  })

  it("list groups active rows before superseded ones, each newest-confirmed first", async () => {
    const activeOld = fact({ id: "a-old", lastConfirmedAt: NOW - 2000 })
    const activeNew = fact({ id: "a-new", lastConfirmedAt: NOW - 1000 })
    const supersededNew = fact({ id: "s-new", status: "superseded", lastConfirmedAt: NOW - 3000 })
    const supersededOld = fact({ id: "s-old", status: "superseded", lastConfirmedAt: NOW - 4000 })
    const expired = fact({ id: "e", status: "expired", lastConfirmedAt: NOW - 5000 })

    const { port, calls } = createFakeMemoryPort({
      listed: [supersededOld, activeOld, expired, supersededNew, activeNew],
    })

    // The transparency payload: what the user still believes first, then what
    // the bot replaced, and the statuses the store cannot reorder without
    // losing the reader's place.
    await expect(createMemoryStore({ port, now: () => NOW }).list(USER_ID, 10)).resolves.toEqual([
      activeNew,
      activeOld,
      supersededNew,
      supersededOld,
      expired,
    ])
    expect(calls).toEqual([{ method: "list", args: [USER_ID, 10] }])
  })

  it("list defaults to 50 and caps the page it was given", async () => {
    const rows = [fact({ id: "s", status: "superseded" }), fact({ id: "a1" }), fact({ id: "a2" })]
    const { port, calls } = createFakeMemoryPort({ listed: rows })
    const store = createMemoryStore({ port, now: () => NOW })

    await expect(store.list(USER_ID)).resolves.toHaveLength(3)
    await expect(store.list(USER_ID, 2)).resolves.toEqual([
      expect.objectContaining({ id: "a1" }),
      expect.objectContaining({ id: "a2" }),
    ])
    expect(calls.map((call) => call.args[1])).toEqual([MEMORY_LIST_LIMIT, 2])
  })
})

describe("createSupabaseMemoryPort reads", () => {
  it("loadActive scopes the user and the status, newest first, and maps the row", async () => {
    const { client, calls } = createRecordingClient({ rows: { [TABLE]: [FACT_ROW] } })

    await expect(createSupabaseMemoryPort(client).loadActive(USER_ID)).resolves.toEqual([FACT])

    expect(calls).toEqual([
      { table: TABLE, method: "select", args: [expect.stringContaining("last_confirmed_at")] },
      { table: TABLE, method: "eq", args: ["user_id", USER_ID] },
      { table: TABLE, method: "eq", args: ["status", "active"] },
      { table: TABLE, method: "order", args: ["last_confirmed_at", { ascending: false }] },
    ])
  })

  it("countActive counts under the ownership filter, and reads a missing count as zero", async () => {
    const { client, calls } = createRecordingClient({ count: 3 })

    await expect(createSupabaseMemoryPort(client).countActive(USER_ID)).resolves.toBe(3)

    // A head request: the cap check needs the number, not the rows.
    expect(calls).toEqual([
      { table: TABLE, method: "select", args: ["id", { count: "exact", head: true }] },
      { table: TABLE, method: "eq", args: ["user_id", USER_ID] },
      { table: TABLE, method: "eq", args: ["status", "active"] },
    ])

    // NaN would poison every cap comparison, so an omitted count is no facts.
    const { client: bare } = createRecordingClient({ count: null })
    await expect(createSupabaseMemoryPort(bare).countActive(USER_ID)).resolves.toBe(0)
  })

  it("list scopes the user, orders newest-confirmed first and applies the limit", async () => {
    const { client, calls } = createRecordingClient({ rows: { [TABLE]: [FACT_ROW, SUPERSEDED_ROW] } })

    await expect(createSupabaseMemoryPort(client).list(USER_ID, 12)).resolves.toEqual([FACT, SUPERSEDED_FACT])

    expect(calls).toEqual([
      { table: TABLE, method: "select", args: [expect.stringContaining("evidence_count")] },
      { table: TABLE, method: "eq", args: ["user_id", USER_ID] },
      { table: TABLE, method: "order", args: ["last_confirmed_at", { ascending: false }] },
      { table: TABLE, method: "limit", args: [12] },
    ])
  })
})

describe("createSupabaseMemoryPort writes", () => {
  it("insert writes the caller's clock and the caller's ownership, and returns the stored row", async () => {
    const { client, calls } = createRecordingClient({ inserted: FACT_ROW })

    await expect(
      createSupabaseMemoryPort(client).insert(
        USER_ID,
        newFact({ sourceMessageId: MESSAGE_ID, expiresAt: EXPIRES_AT }),
        NOW
      )
    ).resolves.toEqual(FACT)

    expect(calls).toEqual([
      {
        table: TABLE,
        method: "insert",
        args: [
          [
            {
              user_id: USER_ID,
              kind: "preference",
              key: "favorite_character",
              value: "Haibara",
              confidence: 0.9,
              source_message_id: MESSAGE_ID,
              expires_at: EXPIRES_ISO,
              last_confirmed_at: NOW_ISO,
            },
          ],
        ],
      },
      { table: TABLE, method: "insert.select", args: [expect.stringContaining("last_confirmed_at")] },
      { table: TABLE, method: "single", args: [] },
    ])
  })

  it("update carries the ownership predicate and refreshes updated_at", async () => {
    const { client, calls } = createRecordingClient()

    await createSupabaseMemoryPort(client).update(
      USER_ID,
      MEMORY_ID,
      { value: "Ayumi", confidence: 0.95, evidenceCount: 3, lastConfirmedAt: LATER },
      NOW
    )

    expect(calls).toEqual([
      {
        table: TABLE,
        method: "update",
        args: [
          {
            value: "Ayumi",
            confidence: 0.95,
            evidence_count: 3,
            last_confirmed_at: LATER_ISO,
            // Every write moves updated_at, so a confirmation is readable as
            // one without comparing last_confirmed_at against created_at.
            updated_at: NOW_ISO,
          },
        ],
      },
      { table: TABLE, method: "eq", args: ["id", MEMORY_ID] },
      { table: TABLE, method: "eq", args: ["user_id", USER_ID] },
    ])

    // A confirmation with no new value leaves the stored rendering alone.
    const { client: bare, calls: bareCalls } = createRecordingClient()
    await createSupabaseMemoryPort(bare).update(
      USER_ID,
      MEMORY_ID,
      { confidence: 0.95, evidenceCount: 3, lastConfirmedAt: LATER },
      NOW
    )
    expect(bareCalls[0].args[0]).not.toHaveProperty("value")
  })

  it("supersede calls the RPC once, with the ownership field, and maps the new row", async () => {
    const replacement = newFact({ value: "Ayumi", confidence: 0.8 })
    const created = { ...FACT_ROW, id: "88888888-8888-4888-8888-888888888888", value: "Ayumi", confidence: 0.8 }
    const { client, calls } = createRecordingClient({ rpc: created })

    await expect(
      createSupabaseMemoryPort(client).supersede(USER_ID, MEMORY_ID, replacement, NOW)
    ).resolves.toEqual({ ...FACT, id: "88888888-8888-4888-8888-888888888888", value: "Ayumi", confidence: 0.8 })

    // Exactly one call, and it is the function: the adapter never issues its
    // own update/insert sequence, which the partial unique index rejects
    // anyway. p_user_id is the ownership the function's first update checks.
    expect(calls).toEqual([
      {
        table: "rpc",
        method: "rpc",
        args: [
          "ai_memory_supersede",
          {
            p_user_id: USER_ID,
            p_old_id: MEMORY_ID,
            p_kind: "preference",
            p_key: "favorite_character",
            p_value: "Ayumi",
            p_confidence: 0.8,
            p_source_message_id: null,
            p_expires_at: null,
          },
        ],
      },
    ])
  })

  it("delete reports whether a scoped row was actually removed", async () => {
    // Nothing matched: the response is a `false`, not an exception.
    const { client, calls } = createRecordingClient({ rows: { [TABLE]: [] } })

    await expect(createSupabaseMemoryPort(client).delete(USER_ID, MEMORY_ID)).resolves.toBe(false)

    expect(calls).toEqual([
      { table: TABLE, method: "delete", args: [] },
      { table: TABLE, method: "eq", args: ["id", MEMORY_ID] },
      { table: TABLE, method: "eq", args: ["user_id", USER_ID] },
      { table: TABLE, method: "select", args: ["id"] },
    ])

    const { client: matched } = createRecordingClient({ rows: { [TABLE]: [{ id: MEMORY_ID }] } })
    await expect(createSupabaseMemoryPort(matched).delete(USER_ID, MEMORY_ID)).resolves.toBe(true)
  })
})

describe("createSupabaseMemoryPort failures", () => {
  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "permission denied" } })
    const port = createSupabaseMemoryPort(client)
    const patch = { confidence: 0.9, evidenceCount: 2, lastConfirmedAt: NOW }

    // The bracketed prefix is the log line the caller emits, so a failure is
    // never mistaken for an empty result: [ai-transcript]'s precedent.
    await expect(port.loadActive(USER_ID)).rejects.toThrow("[ai-memory] loadActive: permission denied")
    await expect(port.countActive(USER_ID)).rejects.toThrow("[ai-memory] countActive: permission denied")
    await expect(port.list(USER_ID, 50)).rejects.toThrow("[ai-memory] list: permission denied")
    await expect(port.insert(USER_ID, newFact(), NOW)).rejects.toThrow("[ai-memory] insert: permission denied")
    await expect(port.update(USER_ID, MEMORY_ID, patch, NOW)).rejects.toThrow(
      "[ai-memory] update: permission denied"
    )
    await expect(port.supersede(USER_ID, MEMORY_ID, newFact(), NOW)).rejects.toThrow(
      "[ai-memory] supersede: permission denied"
    )
    await expect(port.delete(USER_ID, MEMORY_ID)).rejects.toThrow("[ai-memory] delete: permission denied")
  })

  it("propagates a rejected connection instead of swallowing it", async () => {
    const { client } = createRecordingClient({ reject: new Error("fetch failed") })

    await expect(createSupabaseMemoryPort(client).loadActive(USER_ID)).rejects.toThrow("fetch failed")
    await expect(createSupabaseMemoryPort(client).delete(USER_ID, MEMORY_ID)).rejects.toThrow("fetch failed")
  })
})

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const migrationUrl = new URL(
  "../../supabase/migrations/20260919120000_ai_memory_supersede.sql",
  import.meta.url
)

// A missing file must fail as an assertion, not as an import-time ENOENT: the
// suite has to survive a fresh checkout where the migration has not landed yet.
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

/** The function's body, flattened so an assertion does not pin the line breaks. */
const bodyStart = sql.indexOf("begin")
const bodyEnd = sql.indexOf("end; $$", bodyStart)
const body = bodyStart === -1 || bodyEnd === -1 ? "" : sql.slice(bodyStart, bodyEnd)
const bodyFlat = body.replace(/\s+/g, " ").trim()
const fileFlat = sql.replace(/\s+/g, " ").trim()

/** One statement, from a keyword to the semicolon that ends it. */
function statementAfter(text: string, keyword: string): string {
  const start = text.indexOf(keyword)
  expect(start, keyword).toBeGreaterThanOrEqual(0)
  const end = text.indexOf(";", start)
  expect(end, keyword).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe("ai_memory_supersede migration", () => {
  it("creates the function as volatile with a pinned search path", () => {
    expect((sql.match(/create or replace function/gi) ?? []).length).toBe(1)
    expect(sql).toMatch(/create or replace function public\.ai_memory_supersede\(/)
    expect(sql).toMatch(/returns public\.ai_user_memories/)
    expect(sql).toMatch(/language plpgsql volatile/)
    // A function with an unpinned search_path resolves `public.ai_user_memories`
    // through whatever the caller's path happens to be first.
    expect(sql).toMatch(/set search_path = public, extensions, pg_temp/)
  })

  it("marks only the caller's own active row, and refuses anything else", () => {
    // The first update is the whole check: another user's id, a row that is
    // already superseded and a row that never existed all take the same path,
    // and a silently successful no-op is not one of them.
    const firstUpdate = statementAfter(bodyFlat, "update public.ai_user_memories")
    expect(firstUpdate).toContain("id = p_old_id")
    expect(firstUpdate).toContain("user_id = p_user_id")
    expect(firstUpdate).toContain("status = 'active'")

    expect(bodyFlat).toContain("if not found then")
    expect((sql.match(/raise exception/gi) ?? []).length).toBe(1)
  })

  it("inserts the replacement and points the old row at it", () => {
    const insert = statementAfter(bodyFlat, "insert into public.ai_user_memories")
    expect(insert).toContain(
      "(user_id, kind, key, value, confidence, status, source_message_id, expires_at, last_confirmed_at)"
    )
    expect(insert).toContain(
      "values (p_user_id, p_kind, p_key, p_value, p_confidence, 'active', p_source_message_id, p_expires_at, now())"
    )
    expect((sql.match(/insert into public\.ai_user_memories/gi) ?? []).length).toBe(1)

    // The pointer is written last because the replacement has no id before the
    // insert -- the reason superseding is one function and not two statements.
    const pointer = statementAfter(bodyFlat, "set superseded_by = v_new.id")
    expect(pointer).toContain("where id = p_old_id and user_id = p_user_id")
    expect(bodyFlat).toContain("return v_new")
  })

  it("revokes anon and authenticated, and is additive only", () => {
    expect(fileFlat).toContain(
      "revoke all on function public.ai_memory_supersede(uuid, uuid, text, text, text, real, uuid, timestamptz) from anon, authenticated"
    )
    // Constraint 4: this file is applied to a live project by hand, so a
    // destructive or privileged statement here would be unrecoverable.
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
  })
})
