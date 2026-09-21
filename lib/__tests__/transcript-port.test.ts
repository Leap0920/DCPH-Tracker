import { describe, expect, it } from "vitest"
import type { TranscriptPort } from "@/lib/ai/conversations/port"
import {
  createSupabaseTranscriptPort,
  type TranscriptClient,
  type TranscriptInsert,
  type TranscriptQuery,
} from "@/lib/ai/conversations/supabase-port"

/**
 * The adapter is the only file in this plan that knows PostgREST, so these tests
 * assert the calls it makes, not just the values it returns: the ownership
 * predicate is the security property under test (D1), and a missing embed is a
 * cross-user read. The client is a scripted recording fake — no project URL, no
 * service-role key, no network (constraint 10).
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const NOW_ISO = "2026-09-19T10:00:00.000Z"
const SINCE_ISO = "2026-09-19T09:30:00.000Z"

const CONVERSATION_ROW: Record<string, unknown> = {
  id: CONVERSATION_ID,
  user_id: USER_ID,
  title: "Episode 5",
  summary: "They talked about Haibara.",
  summarized_through: 8,
  message_count: 12,
  last_message_at: NOW_ISO,
  archived_at: null,
}

/** Descending, the way the `order … desc` read returns them. */
const MESSAGE_ROWS: Record<string, unknown>[] = [
  { id: "m3", role: "assistant", content: "third", created_at: "2026-09-19T09:03:00.000Z" },
  { id: "m2", role: "user", content: "second", created_at: "2026-09-19T09:02:00.000Z" },
  { id: "m1", role: "user", content: "first", created_at: "2026-09-19T09:01:00.000Z" },
]

interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeScript {
  /** Canned reply per table, as PostgREST would return it. */
  rows?: Record<string, Record<string, unknown>[] | null>
  /** A PostgREST failure: every call resolves with `{ error }`, exactly as the real client does. */
  error?: { message: string }
  /** A dropped connection: every call rejects instead of resolving. */
  reject?: Error
  /** The row `insert().select().single()` reads back. */
  inserted?: Record<string, unknown> | null
}

interface FakeClient {
  client: TranscriptClient
  calls: RecordedCall[]
}

/**
 * A scripted, recording stand-in for the Supabase client. The adapter is typed
 * against the locally declared `TranscriptClient`, so this needs no
 * `@supabase/supabase-js` import and never reaches the network.
 */
function createRecordingClient(script: FakeScript = {}): FakeClient {
  const calls: RecordedCall[] = []

  function record(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args })
  }

  function failure(): { data: null; error: { message: string } } {
    return { data: null, error: script.error ?? { message: "unknown" } }
  }

  function settle<T>(value: T): PromiseLike<T> {
    return script.reject ? Promise.reject(script.reject) : Promise.resolve(value)
  }

  function query(table: string, rows: Record<string, unknown>[] | null): TranscriptQuery {
    const chain: TranscriptQuery = {
      then(onFulfilled, onRejected) {
        return settle(script.error ? failure() : { data: rows, error: null }).then(onFulfilled, onRejected)
      },
      eq(column, value) {
        record(table, "eq", [column, value])
        return chain
      },
      is(column, value) {
        record(table, "is", [column, value])
        return chain
      },
      gte(column, value) {
        record(table, "gte", [column, value])
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
      range(from, to) {
        record(table, "range", [from, to])
        return chain
      },
      textSearch(column, textQuery) {
        record(table, "textSearch", [column, textQuery])
        return chain
      },
      maybeSingle() {
        record(table, "maybeSingle", [])
        if (script.error) return Promise.resolve(failure())
        return Promise.resolve({ data: rows?.[0] ?? null, error: null })
      },
    }
    return chain
  }

  const client: TranscriptClient = {
    from(table) {
      return {
        select(columns) {
          record(table, "select", [columns])
          return query(table, script.rows?.[table] ?? null)
        },
        insert(values): TranscriptInsert {
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
      }
    },
  }

  return { client, calls }
}

const CONVERSATION_QUERY: RecordedCall[] = [
  { table: "ai_conversations", method: "select", args: [expect.stringContaining("last_message_at")] },
]

describe("createSupabaseTranscriptPort conversation reads", () => {
  it("conversationOwnedBy filters by id and user_id, and maps the row to epoch ms", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [CONVERSATION_ROW] } })
    const port: TranscriptPort = createSupabaseTranscriptPort(client)

    await expect(port.conversationOwnedBy(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      id: CONVERSATION_ID,
      userId: USER_ID,
      title: "Episode 5",
      summary: "They talked about Haibara.",
      summarizedThrough: 8,
      messageCount: 12,
      lastMessageAt: NOW,
      archivedAt: null,
    })

    expect(calls).toEqual([
      ...CONVERSATION_QUERY,
      { table: "ai_conversations", method: "eq", args: ["id", CONVERSATION_ID] },
      { table: "ai_conversations", method: "eq", args: ["user_id", USER_ID] },
      { table: "ai_conversations", method: "maybeSingle", args: [] },
    ])
  })

  it("conversationOwnedBy returns null when the scoped read finds no row", async () => {
    // The scoped read is the whole check: another user's id and a nonexistent id
    // are the same answer here, which is what Task 3's refusal relies on.
    const { client } = createRecordingClient({ rows: { ai_conversations: [] } })

    await expect(
      createSupabaseTranscriptPort(client).conversationOwnedBy(OTHER_USER_ID, CONVERSATION_ID)
    ).resolves.toBeNull()
  })

  it("recentConversation scopes the owner, the archive and the cutoff, newest first, one row", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [CONVERSATION_ROW] } })

    await expect(
      createSupabaseTranscriptPort(client).recentConversation(USER_ID, NOW - 30 * 60 * 1000)
    ).resolves.toMatchObject({ id: CONVERSATION_ID, lastMessageAt: NOW })

    expect(calls).toEqual([
      ...CONVERSATION_QUERY,
      { table: "ai_conversations", method: "eq", args: ["user_id", USER_ID] },
      { table: "ai_conversations", method: "is", args: ["archived_at", null] },
      { table: "ai_conversations", method: "gte", args: ["last_message_at", SINCE_ISO] },
      { table: "ai_conversations", method: "order", args: ["last_message_at", { ascending: false }] },
      { table: "ai_conversations", method: "limit", args: [1] },
      { table: "ai_conversations", method: "maybeSingle", args: [] },
    ])
  })

  it("listConversations excludes archived rows and orders by last_message_at desc", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [CONVERSATION_ROW] } })

    await expect(createSupabaseTranscriptPort(client).listConversations(USER_ID, 30)).resolves.toEqual([
      {
        id: CONVERSATION_ID,
        userId: USER_ID,
        title: "Episode 5",
        summary: "They talked about Haibara.",
        summarizedThrough: 8,
        messageCount: 12,
        lastMessageAt: NOW,
        archivedAt: null,
      },
    ])

    expect(calls).toEqual([
      { table: "ai_conversations", method: "select", args: [expect.stringContaining("message_count")] },
      { table: "ai_conversations", method: "eq", args: ["user_id", USER_ID] },
      { table: "ai_conversations", method: "is", args: ["archived_at", null] },
      { table: "ai_conversations", method: "order", args: ["last_message_at", { ascending: false }] },
      { table: "ai_conversations", method: "limit", args: [30] },
    ])
  })
})

describe("createSupabaseTranscriptPort message reads", () => {
  it("lastMessages embeds the owner, orders descending, and returns ascending", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_messages: MESSAGE_ROWS } })

    await expect(
      createSupabaseTranscriptPort(client).lastMessages(USER_ID, CONVERSATION_ID, 2)
    ).resolves.toEqual([
      { id: "m1", role: "user", content: "first", createdAt: Date.parse("2026-09-19T09:01:00.000Z") },
      { id: "m2", role: "user", content: "second", createdAt: Date.parse("2026-09-19T09:02:00.000Z") },
      { id: "m3", role: "assistant", content: "third", createdAt: Date.parse("2026-09-19T09:03:00.000Z") },
    ])

    expect(calls).toEqual([
      {
        table: "ai_messages",
        method: "select",
        args: [expect.stringContaining("ai_conversations!inner(user_id)")],
      },
      { table: "ai_messages", method: "eq", args: ["conversation_id", CONVERSATION_ID] },
      { table: "ai_messages", method: "eq", args: ["ai_conversations.user_id", USER_ID] },
      { table: "ai_messages", method: "order", args: ["created_at", { ascending: false }] },
      { table: "ai_messages", method: "limit", args: [2] },
    ])
  })

  it("messagesRange embeds the owner and reads [from, to) in ascending order", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_messages: [MESSAGE_ROWS[0]] } })

    await expect(
      createSupabaseTranscriptPort(client).messagesRange(USER_ID, CONVERSATION_ID, 12, 20)
    ).resolves.toEqual([
      { id: "m3", role: "assistant", content: "third", createdAt: Date.parse("2026-09-19T09:03:00.000Z") },
    ])

    expect(calls).toEqual([
      {
        table: "ai_messages",
        method: "select",
        args: [expect.stringContaining("ai_conversations!inner(user_id)")],
      },
      { table: "ai_messages", method: "eq", args: ["conversation_id", CONVERSATION_ID] },
      { table: "ai_messages", method: "eq", args: ["ai_conversations.user_id", USER_ID] },
      { table: "ai_messages", method: "order", args: ["created_at", { ascending: true }] },
      // PostgREST's range is inclusive at both ends; the port's `to` is exclusive.
      { table: "ai_messages", method: "range", args: [12, 19] },
    ])
  })

  it("searchMessages searches fts under the ownership embed", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_messages: MESSAGE_ROWS } })

    await expect(
      createSupabaseTranscriptPort(client).searchMessages(USER_ID, "haibara", 5)
    ).resolves.toHaveLength(3)

    // A search spans conversations, so the embed is the only ownership filter
    // there is: without it this reads every user's history.
    expect(calls).toEqual([
      {
        table: "ai_messages",
        method: "select",
        args: [expect.stringContaining("ai_conversations!inner(user_id)")],
      },
      { table: "ai_messages", method: "eq", args: ["ai_conversations.user_id", USER_ID] },
      { table: "ai_messages", method: "textSearch", args: ["fts", "haibara"] },
      { table: "ai_messages", method: "order", args: ["created_at", { ascending: false }] },
      { table: "ai_messages", method: "limit", args: [5] },
    ])
  })
})

describe("createSupabaseTranscriptPort writes", () => {
  it("appendMessages verifies ownership, then inserts one row per turn", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [{ id: CONVERSATION_ID }] } })

    await expect(
      createSupabaseTranscriptPort(client).appendMessages(
        USER_ID,
        CONVERSATION_ID,
        [
          { role: "user", content: "who is Haibara?" },
          { role: "assistant", content: "A scientist." },
        ],
        NOW
      )
    ).resolves.toBeUndefined()

    expect(calls).toEqual([
      { table: "ai_conversations", method: "select", args: ["id"] },
      { table: "ai_conversations", method: "eq", args: ["id", CONVERSATION_ID] },
      { table: "ai_conversations", method: "eq", args: ["user_id", USER_ID] },
      { table: "ai_conversations", method: "maybeSingle", args: [] },
      {
        table: "ai_messages",
        method: "insert",
        args: [
          [
            {
              conversation_id: CONVERSATION_ID,
              role: "user",
              content: "who is Haibara?",
              created_at: NOW_ISO,
            },
            {
              conversation_id: CONVERSATION_ID,
              role: "assistant",
              content: "A scientist.",
              created_at: NOW_ISO,
            },
          ],
        ],
      },
    ])
  })

  it("appendMessages refuses a conversation the caller does not own, and never writes", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [] } })

    await expect(
      createSupabaseTranscriptPort(client).appendMessages(
        OTHER_USER_ID,
        CONVERSATION_ID,
        [{ role: "user", content: "hi" }],
        NOW
      )
    ).rejects.toThrow(/not the caller's/)

    expect(calls.map((call) => call.table)).not.toContain("ai_messages")
  })

  it("appendMessages makes no call at all for an empty turn list", async () => {
    const { client, calls } = createRecordingClient()

    await expect(
      createSupabaseTranscriptPort(client).appendMessages(USER_ID, CONVERSATION_ID, [], NOW)
    ).resolves.toBeUndefined()

    expect(calls).toEqual([])
  })

  it("updateConversation carries the ownership filter on the update itself", async () => {
    const { client, calls } = createRecordingClient()

    await expect(
      createSupabaseTranscriptPort(client).updateConversation(USER_ID, CONVERSATION_ID, {
        messageCount: 13,
        lastMessageAt: NOW,
      })
    ).resolves.toBeUndefined()

    expect(calls).toEqual([
      {
        table: "ai_conversations",
        method: "update",
        args: [{ message_count: 13, last_message_at: NOW_ISO }],
      },
      { table: "ai_conversations", method: "eq", args: ["id", CONVERSATION_ID] },
      { table: "ai_conversations", method: "eq", args: ["user_id", USER_ID] },
    ])
  })

  it("updateConversation maps the whole patch and keeps an explicit null unarchive", async () => {
    const { client, calls } = createRecordingClient()

    await createSupabaseTranscriptPort(client).updateConversation(USER_ID, CONVERSATION_ID, {
      title: "Episode 5",
      summary: "so far",
      summarizedThrough: 8,
      archivedAt: null,
    })

    // Absent fields stay absent: `undefined` means "leave the column alone".
    expect(calls[0]).toEqual({
      table: "ai_conversations",
      method: "update",
      args: [{ title: "Episode 5", summary: "so far", summarized_through: 8, archived_at: null }],
    })
  })

  it("updateConversation makes no call for a patch with nothing in it", async () => {
    const { client, calls } = createRecordingClient()

    await expect(
      createSupabaseTranscriptPort(client).updateConversation(USER_ID, CONVERSATION_ID, {})
    ).resolves.toBeUndefined()

    expect(calls).toEqual([])
  })

  it("createConversation inserts the owner's row and returns what the database stored", async () => {
    const { client, calls } = createRecordingClient({ inserted: CONVERSATION_ROW })

    await expect(
      createSupabaseTranscriptPort(client).createConversation({ userId: USER_ID, title: null }, NOW)
    ).resolves.toEqual({
      id: CONVERSATION_ID,
      userId: USER_ID,
      title: "Episode 5",
      summary: "They talked about Haibara.",
      summarizedThrough: 8,
      messageCount: 12,
      lastMessageAt: NOW,
      archivedAt: null,
    })

    expect(calls).toEqual([
      {
        table: "ai_conversations",
        method: "insert",
        args: [[{ user_id: USER_ID, title: null, last_message_at: NOW_ISO }]],
      },
      { table: "ai_conversations", method: "insert.select", args: [expect.stringContaining("message_count")] },
      { table: "ai_conversations", method: "single", args: [] },
    ])
  })

  it("falls back to its own clock for an unrepresentable timestamp", async () => {
    const { client, calls } = createRecordingClient({ rows: { ai_conversations: [{ id: CONVERSATION_ID }] } })

    // `new Date(NaN).toISOString()` throws, so a bad clock must not reach the
    // write as an invalid timestamptz.
    await createSupabaseTranscriptPort(client, { now: () => NOW }).appendMessages(
      USER_ID,
      CONVERSATION_ID,
      [{ role: "user", content: "hi" }],
      Number.NaN
    )

    expect(calls.at(-1)).toEqual({
      table: "ai_messages",
      method: "insert",
      args: [[{ conversation_id: CONVERSATION_ID, role: "user", content: "hi", created_at: NOW_ISO }]],
    })
  })
})

describe("createSupabaseTranscriptPort failures", () => {
  it("rejects with the database's message rather than an empty result", async () => {
    const { client } = createRecordingClient({ error: { message: "relation does not exist" } })
    const port = createSupabaseTranscriptPort(client)

    await expect(port.conversationOwnedBy(USER_ID, CONVERSATION_ID)).rejects.toThrow("relation does not exist")
    await expect(port.lastMessages(USER_ID, CONVERSATION_ID, 8)).rejects.toThrow("relation does not exist")
    await expect(port.listConversations(USER_ID, 30)).rejects.toThrow("relation does not exist")
    await expect(
      port.updateConversation(USER_ID, CONVERSATION_ID, { messageCount: 1 })
    ).rejects.toThrow("relation does not exist")
    await expect(port.appendMessages(USER_ID, CONVERSATION_ID, [{ role: "user", content: "x" }], NOW)).rejects.toThrow(
      "relation does not exist"
    )
  })

  it("propagates a rejected connection instead of swallowing it", async () => {
    const { client } = createRecordingClient({ reject: new Error("fetch failed") })

    await expect(
      createSupabaseTranscriptPort(client).searchMessages(USER_ID, "haibara", 5)
    ).rejects.toThrow("fetch failed")
  })

  it("never inserts when the ownership read itself fails", async () => {
    const { client, calls } = createRecordingClient({ error: { message: "boom" } })

    await expect(
      createSupabaseTranscriptPort(client).appendMessages(
        USER_ID,
        CONVERSATION_ID,
        [{ role: "user", content: "x" }],
        NOW
      )
    ).rejects.toThrow("boom")

    expect(calls.map((call) => call.table)).not.toContain("ai_messages")
  })
})
