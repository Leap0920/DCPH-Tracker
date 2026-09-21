/**
 * The seam is the one place the chat route touches the database, so these tests
 * run the real adapters and the real stores against a scripted admin client
 * (constraint 10: no test constructs a Supabase client or opens a connection).
 * Only two things are mocked, because they are the two that would reach the
 * network: the admin-client factory, and the memory writer — whose own contract
 * is already pinned in `memory-write.test.ts`.
 *
 * What is asserted here is the seam's own policy: the refusal that falls back to
 * the client's history, the `AI_MEMORY` switch with all four of its effects, the
 * message count the writer's schedule is derived from, and the rule that nothing
 * this module does after the response may reject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const run = vi.fn()
const createMemoryWriter = vi.fn(() => ({ run }))
vi.mock("@/lib/ai/memory/write", () => ({
  createMemoryWriter: () => createMemoryWriter(),
}))

import { createRequestPersistence } from "@/lib/chat/persistence"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const NOW_ISO = "2026-09-19T10:00:00.000Z"

const CONVERSATION_ROW: Record<string, unknown> = {
  id: CONVERSATION_ID,
  user_id: USER_ID,
  title: "Episode 5",
  summary: "They talked about Haibara.",
  summarized_through: 2,
  message_count: 1,
  last_message_at: NOW_ISO,
  archived_at: null,
}

/** Descending, the way the adapter's `order … desc` read returns them. */
const MESSAGE_ROWS: Record<string, unknown>[] = [
  { id: "m3", role: "system", content: "rules", created_at: "2026-09-19T09:03:00.000Z" },
  { id: "m2", role: "assistant", content: "second", created_at: "2026-09-19T09:02:00.000Z" },
  { id: "m1", role: "user", content: "first", created_at: "2026-09-19T09:01:00.000Z" },
]

const FACT_ROW: Record<string, unknown> = {
  id: "f1",
  user_id: USER_ID,
  kind: "preference",
  key: "favorite_character",
  value: "Haibara",
  confidence: 0.9,
  status: "active",
  superseded_by: null,
  source_message_id: null,
  evidence_count: 1,
  last_confirmed_at: NOW_ISO,
  expires_at: null,
}

const REPORT = {
  extracted: 0,
  added: 0,
  updated: 0,
  superseded: 0,
  skipped: 0,
  summarized: false,
}

/** The same window as `TranscriptTurn`s, the shape the writer extracts from. */
const WINDOW_TURNS = [
  { id: "m1", role: "user" as const, content: "first", createdAt: Date.parse("2026-09-19T09:01:00.000Z") },
  {
    id: "m2",
    role: "assistant" as const,
    content: "second",
    createdAt: Date.parse("2026-09-19T09:02:00.000Z"),
  },
]

interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeScript {
  /** What `maybeSingle` reads: the owned conversation, or null for an unknown id. */
  single?: Record<string, unknown> | null
  /** The row `insert().select().single()` returns when a conversation is created. */
  created?: Record<string, unknown> | null
  /** Rows an awaited message read returns. */
  messages?: Record<string, unknown>[] | null
  /** Rows a memory read returns. */
  facts?: Record<string, unknown>[] | null
  /** A dropped connection: every call rejects instead of resolving. */
  reject?: Error
  /** Reads still answer, but every insert reports PostgREST's `{ error }`. */
  failInserts?: boolean
  /** The conversation reads answer; every message read reports `{ error }`. */
  failMessages?: boolean
}

interface FakeQuery {
  eq(column: string, value: unknown): FakeQuery
  is(column: string, value: unknown): FakeQuery
  gte(column: string, value: unknown): FakeQuery
  order(column: string, options: unknown): FakeQuery
  limit(count: number): FakeQuery
  range(from: number, to: number): FakeQuery
  textSearch(column: string, query: string): FakeQuery
  select(columns: string): FakeQuery
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
  then(
    onFulfilled: (value: {
      data: Record<string, unknown>[] | null
      error: { message: string } | null
    }) => unknown,
    onRejected: (reason: unknown) => unknown
  ): unknown
}

interface FakeInsert {
  select(columns: string): {
    single(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
  }
  then(
    onFulfilled: (value: { error: { message: string } | null }) => unknown,
    onRejected: (reason: unknown) => unknown
  ): unknown
}

interface FakeAdmin {
  calls: RecordedCall[]
  from(table: string): {
    select(columns: string): FakeQuery
    insert(values: Record<string, unknown>[]): FakeInsert
    update(values: Record<string, unknown>): FakeQuery
  }
}

/**
 * A scripted, recording stand-in for the admin client. It implements only the
 * query shapes the two ports use, which is the point: the fake is the contract
 * the adapters are read through, so a port method that starts issuing a call
 * this fake does not have fails the test rather than the deployment.
 */
function createFakeAdmin(script: FakeScript = {}): FakeAdmin {
  const calls: RecordedCall[] = []

  function note(table: string, method: string, args: unknown[] = []): void {
    calls.push({ table, method, args })
  }

  function settle<T>(value: T): Promise<T> {
    return script.reject ? Promise.reject(script.reject) : Promise.resolve(value)
  }

  function rowsFor(table: string): Record<string, unknown>[] | null {
    if (table === "ai_messages") return script.messages ?? null
    if (table === "ai_user_memories") return script.facts ?? null
    return null
  }

  function errorFor(table: string): { message: string } | null {
    return table === "ai_messages" && script.failMessages ? { message: "messages unavailable" } : null
  }

  function query(table: string): FakeQuery {
    const chain: FakeQuery = {
      then(onFulfilled, onRejected) {
        return settle({ data: errorFor(table) === null ? rowsFor(table) : null, error: errorFor(table) }).then(
          onFulfilled,
          onRejected
        )
      },
      eq(column, value) {
        note(table, "eq", [column, value])
        return chain
      },
      is(column, value) {
        note(table, "is", [column, value])
        return chain
      },
      gte(column, value) {
        note(table, "gte", [column, value])
        return chain
      },
      order(column, options) {
        note(table, "order", [column, options])
        return chain
      },
      limit(count) {
        note(table, "limit", [count])
        return chain
      },
      range(from, to) {
        note(table, "range", [from, to])
        return chain
      },
      textSearch(column, textQuery) {
        note(table, "textSearch", [column, textQuery])
        return chain
      },
      select(columns) {
        note(table, "select", [columns])
        return chain
      },
      maybeSingle() {
        note(table, "maybeSingle")
        return settle({ data: script.single ?? null, error: null })
      },
    }
    return chain
  }

  return {
    calls,
    from(table) {
      return {
        select(columns) {
          note(table, "select", [columns])
          return query(table)
        },
        insert(values): FakeInsert {
          note(table, "insert", [values])
          return {
            select() {
              return {
                single: () => settle({ data: script.created ?? null, error: null }),
              }
            },
            then(onFulfilled, onRejected) {
              return settle({ error: script.failInserts ? { message: "insert failed" } : null }).then(
                onFulfilled,
                onRejected
              )
            },
          }
        },
        update(values) {
          note(table, "update", [values])
          return query(table)
        },
      }
    },
  }
}

function inserts(admin: FakeAdmin, table: string): unknown[] {
  return admin.calls.filter((call) => call.table === table && call.method === "insert").map((call) => call.args[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AI_MEMORY
  createMemoryWriter.mockImplementation(() => ({ run }))
  run.mockResolvedValue(REPORT)
})

afterEach(() => {
  delete process.env.AI_MEMORY
})

describe("createRequestPersistence", () => {
  it("returns null when no admin client is configured", async () => {
    createAdminClient.mockReturnValue(null)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    expect(seam).toBeNull()
    expect(createMemoryWriter).not.toHaveBeenCalled()
  })

  it("returns null for a conversation id that is not the caller's", async () => {
    const admin = createFakeAdmin({ single: null })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    expect(seam).toBeNull()
  })

  it("creates a conversation when the request carries no id", async () => {
    const admin = createFakeAdmin({ single: null, created: CONVERSATION_ROW })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID })

    expect(seam?.conversationId).toBe(CONVERSATION_ID)
  })

  it("loads the verbatim window without its summary-less system rows", async () => {
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, messages: MESSAGE_ROWS })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })
    const window = await seam?.window()

    expect(window).toEqual({
      summary: "They talked about Haibara.",
      // Oldest first, the order the model reads; the system row is dropped
      // because a transcript's roles are only ever user and assistant.
      turns: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
    })
  })

  it("reports a degraded window as null rather than an empty transcript", async () => {
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, failMessages: true })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    await expect(seam?.window()).resolves.toBeNull()
  })

  it("renders the [MEM] block from the user's active facts", async () => {
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, facts: [FACT_ROW] })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })
    const block = await seam?.memories("Who is your favorite character?")

    expect(block).toContain("[MEM] favorite_character: Haibara")
    expect(admin.calls.some((call) => call.table === "ai_user_memories")).toBe(true)
  })

  it("renders nothing for a user with no facts", async () => {
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, facts: [] })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    await expect(seam?.memories("anything")).resolves.toBe("")
  })

  it("records both turns and hands the writer the emitted answer's count", async () => {
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, messages: MESSAGE_ROWS })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      now: () => NOW,
    })
    // The prompt's window is what the writer extracts from, so it has to be
    // loaded before the after-work runs.
    await seam?.window()
    await seam?.record("user", "Who is Haibara?")
    await seam?.afterTurn({ answer: "She is a character." })

    expect(inserts(admin, "ai_messages")[0]).toEqual([
      { conversation_id: CONVERSATION_ID, role: "user", content: "Who is Haibara?", created_at: NOW_ISO },
    ])
    expect(inserts(admin, "ai_messages")[1]).toEqual([
      { conversation_id: CONVERSATION_ID, role: "assistant", content: "She is a character.", created_at: NOW_ISO },
    ])
    expect(run).toHaveBeenCalledWith({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      // The count after the assistant turn: one stored message plus this
      // request's two turns. The writer's every-fourth-turn schedule reads it.
      messageCount: 3,
      sourceMessageId: null,
      turns: WINDOW_TURNS,
      summary: "They talked about Haibara.",
    })
  })

  it("records both turns when AI_MEMORY is off and calls no writer", async () => {
    process.env.AI_MEMORY = "off"
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, messages: MESSAGE_ROWS })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })
    await seam?.record("user", "Who is Haibara?")
    await seam?.afterTurn({ answer: "She is a character." })

    // The transcript is not part of the kill switch's job: both turns land.
    expect(inserts(admin, "ai_messages")).toHaveLength(2)
    expect(createMemoryWriter).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it("reads no facts when AI_MEMORY is off", async () => {
    process.env.AI_MEMORY = "off"
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, facts: [FACT_ROW] })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    await expect(seam?.memories("Who is your favorite character?")).resolves.toBe("")
    expect(admin.calls.some((call) => call.table === "ai_user_memories")).toBe(false)
  })

  it("logs a rejected writer run and never rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const admin = createFakeAdmin({ single: CONVERSATION_ROW })
    createAdminClient.mockReturnValue(admin)
    run.mockRejectedValue(new Error("writer exploded"))

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    await expect(seam?.afterTurn({ answer: "hi" })).resolves.toBeUndefined()
    expect(spy.mock.calls.flat().join(" ")).toContain("[ai-chat]")
    spy.mockRestore()
  })

  it("logs a rejected transcript write and still lets the writer run", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const admin = createFakeAdmin({ single: CONVERSATION_ROW, failInserts: true })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({ userId: USER_ID, conversationId: CONVERSATION_ID })

    await expect(seam?.afterTurn({ answer: "hi" })).resolves.toBeUndefined()
    expect(spy.mock.calls.flat().join(" ")).toContain("[ai-chat]")
    // The summary stage reads the stored transcript, so a failed append must not
    // stop it catching up on what already landed.
    expect(run).toHaveBeenCalled()
    spy.mockRestore()
  })
})
