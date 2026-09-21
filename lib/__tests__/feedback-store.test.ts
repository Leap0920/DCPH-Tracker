/**
 * The feedback store, its Supabase adapter, and the policy layer over them.
 *
 * Nothing here constructs a Supabase client or touches a network (constraint
 * 10): the adapter is tested against a hand-written recording fake typed against
 * the locally declared client interface, and the store against a recording fake
 * port, so the calls are assertions rather than assumptions. The migration is
 * never executed -- it is applied by hand, so its shape is the only thing the
 * migration test in this suite can honestly assert.
 */

import { describe, expect, it } from "vitest"
import {
  createFeedbackStore,
  createSupabaseFeedbackPort,
  type FeedbackClient,
  type FeedbackPort,
  type FeedbackQuery,
  type FeedbackResolution,
  type FeedbackResult,
  type FeedbackUpsert,
  type FeedbackVote,
} from "@/lib/ai/feedback/store"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const MESSAGE_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_MESSAGE_ID = "77777777-7777-4777-8777-777777777777"
const NOW_ISO = "2026-09-19T10:00:00.000Z"
const NOW = Date.parse(NOW_ISO)

const VOTE_ROW: Record<string, unknown> = {
  id: "88888888-8888-4888-8888-888888888888",
  message_id: MESSAGE_ID,
  user_id: USER_ID,
  value: 1,
  note: "That answered it.",
  created_at: NOW_ISO,
}

const VOTE: FeedbackVote = {
  messageId: MESSAGE_ID,
  userId: USER_ID,
  value: 1,
  note: "That answered it.",
  createdAt: NOW,
}

interface RecordedClientCall {
  table: string
  method: string
  args: unknown[]
}

interface ClientScript {
  /** The row `resolve`'s `maybeSingle` reads back; null is "not found". */
  message?: Record<string, unknown> | null
  /** The rows the `forMessages` list read returns. */
  votes?: Record<string, unknown>[] | null
  /** The row `upsert().select().single()` reads back. */
  upserted?: Record<string, unknown> | null
  /** A PostgREST failure: every call resolves with `{ error }`. */
  error?: { message: string }
  /** A dropped connection: every call rejects instead of resolving. */
  reject?: Error
}

/**
 * A scripted, recording stand-in for the Supabase client, typed against the
 * adapter's locally declared interface so it needs no `@supabase/supabase-js`
 * import and never reaches the network.
 */
function createRecordingClient(script: ClientScript = {}): {
  client: FeedbackClient
  calls: RecordedClientCall[]
} {
  const calls: RecordedClientCall[] = []

  function record(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args })
  }

  function settle<T>(value: T): Promise<T> {
    return script.reject ? Promise.reject(script.reject) : Promise.resolve(value)
  }

  function query(table: string, rows: Record<string, unknown>[] | null): FeedbackQuery {
    const chain: FeedbackQuery = {
      then(onFulfilled, onRejected) {
        const reply: FeedbackResult = script.error
          ? { data: null, error: script.error }
          : { data: rows, error: null }
        return settle(reply).then(onFulfilled, onRejected)
      },
      eq(column, value) {
        record(table, "eq", [column, value])
        return chain
      },
      in(column, values) {
        record(table, "in", [column, values])
        return chain
      },
      maybeSingle() {
        record(table, "maybeSingle", [])
        const reply = script.error
          ? { data: null, error: script.error }
          : { data: script.message ?? null, error: null }
        return settle(reply)
      },
    }
    return chain
  }

  const client: FeedbackClient = {
    from(table) {
      return {
        select(columns) {
          record(table, "select", [columns])
          return query(table, script.votes ?? null)
        },
        upsert(values, options): FeedbackUpsert {
          record(table, "upsert", [values, options])
          return {
            then(onFulfilled, onRejected) {
              return settle({ error: script.error ?? null }).then(onFulfilled, onRejected)
            },
            select(columns) {
              record(table, "upsert.select", [columns])
              return {
                single() {
                  record(table, "single", [])
                  if (script.error) return Promise.resolve({ data: null, error: script.error })
                  return Promise.resolve({ data: script.upserted ?? null, error: null })
                },
              }
            },
          }
        },
      }
    },
  }

  return { client, calls }
}

const TABLE = "ai_message_feedback"

describe("createSupabaseFeedbackPort resolve", () => {
  it("resolves the caller's own assistant message and filters by the embedded owner", async () => {
    const { client, calls } = createRecordingClient({
      message: { id: MESSAGE_ID, role: "assistant", ai_conversations: { user_id: USER_ID } },
    })

    await expect(createSupabaseFeedbackPort(client).resolve(MESSAGE_ID, USER_ID)).resolves.toEqual({
      status: "ok",
      messageId: MESSAGE_ID,
    })

    // The ownership predicate rides on the resolve read, not on a second query:
    // a read without it is a cross-user read (D1).
    expect(calls).toEqual([
      { table: "ai_messages", method: "select", args: [expect.stringContaining("ai_conversations!inner")] },
      { table: "ai_messages", method: "eq", args: ["id", MESSAGE_ID] },
      { table: "ai_messages", method: "eq", args: ["ai_conversations.user_id", USER_ID] },
      { table: "ai_messages", method: "maybeSingle", args: [] },
    ])
  })

  it("returns not_found for a message the inner join dropped", async () => {
    // Another user's message and a message that never existed are the same row
    // to PostgREST, and the store keeps them the same answer.
    const { client } = createRecordingClient({ message: null })

    await expect(createSupabaseFeedbackPort(client).resolve(MESSAGE_ID, USER_ID)).resolves.toEqual({
      status: "not_found",
    })
  })

  it("distinguishes a non-assistant message from an unowned one", async () => {
    const { client } = createRecordingClient({
      message: { id: MESSAGE_ID, role: "user", ai_conversations: { user_id: USER_ID } },
    })

    // The caller owns this message, so it is not a 404: it is simply not an
    // answer, which is a different refusal.
    await expect(createSupabaseFeedbackPort(client).resolve(MESSAGE_ID, USER_ID)).resolves.toEqual({
      status: "not_assistant",
    })
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "permission denied" } })

    await expect(createSupabaseFeedbackPort(client).resolve(MESSAGE_ID, USER_ID)).rejects.toThrow(
      "[ai-feedback] resolve: permission denied"
    )
  })
})

describe("createSupabaseFeedbackPort upsert", () => {
  it("upserts on (message_id, user_id) and returns the stored vote", async () => {
    const { client, calls } = createRecordingClient({ upserted: VOTE_ROW })

    await expect(
      createSupabaseFeedbackPort(client).upsert({
        messageId: MESSAGE_ID,
        userId: USER_ID,
        value: 1,
        note: "That answered it.",
      })
    ).resolves.toEqual(VOTE)

    // The conflict target is the unique index from 20260919140000: without it a
    // second vote would stack rather than replace.
    expect(calls).toEqual([
      {
        table: TABLE,
        method: "upsert",
        args: [
          [{ message_id: MESSAGE_ID, user_id: USER_ID, value: 1, note: "That answered it." }],
          { onConflict: "message_id,user_id" },
        ],
      },
      { table: TABLE, method: "upsert.select", args: [expect.stringContaining("created_at")] },
      { table: TABLE, method: "single", args: [] },
    ])
  })

  it("sends a null note so a re-vote clears whatever the previous one left", async () => {
    const { client, calls } = createRecordingClient({
      upserted: { ...VOTE_ROW, value: -1, note: null },
    })

    await expect(
      createSupabaseFeedbackPort(client).upsert({
        messageId: MESSAGE_ID,
        userId: USER_ID,
        value: -1,
        note: null,
      })
    ).resolves.toEqual({ ...VOTE, value: -1, note: null })

    // The column is present in the payload, which is what makes
    // merge-duplicates overwrite it rather than leave the old note in place.
    const values = calls[0]?.args[0] as Record<string, unknown>[]
    expect(values[0]).toHaveProperty("note", null)
  })

  it("rejects when the upsert returns no row", async () => {
    const { client } = createRecordingClient({ upserted: null })

    await expect(
      createSupabaseFeedbackPort(client).upsert({ messageId: MESSAGE_ID, userId: USER_ID, value: 1, note: null })
    ).rejects.toThrow("[ai-feedback] upsert: the upsert returned no row")
  })
})

describe("createSupabaseFeedbackPort forMessages", () => {
  it("short-circuits an empty set without issuing a query", async () => {
    const { client, calls } = createRecordingClient({ votes: [VOTE_ROW] })

    await expect(createSupabaseFeedbackPort(client).forMessages([])).resolves.toEqual([])

    // An empty read must not cost a round trip, so no call reaches the client.
    expect(calls).toEqual([])
  })

  it("reads a set of message ids in one query and maps the rows", async () => {
    const second = { ...VOTE_ROW, message_id: OTHER_MESSAGE_ID, value: -1, note: null }
    const { client, calls } = createRecordingClient({ votes: [VOTE_ROW, second] })

    await expect(createSupabaseFeedbackPort(client).forMessages([MESSAGE_ID, OTHER_MESSAGE_ID])).resolves.toEqual([
      VOTE,
      { ...VOTE, messageId: OTHER_MESSAGE_ID, value: -1, note: null },
    ])

    expect(calls).toEqual([
      { table: TABLE, method: "select", args: [expect.stringContaining("message_id")] },
      { table: TABLE, method: "in", args: ["message_id", [MESSAGE_ID, OTHER_MESSAGE_ID]] },
    ])
  })
})

interface RecordedPortCall {
  method: string
  args: unknown[]
}

interface PortScript {
  resolution?: FeedbackResolution
  vote?: FeedbackVote
  votes?: FeedbackVote[]
  /** The one method that rejects, as a dropped connection would. */
  reject?: string
}

function createFakePort(script: PortScript = {}): { port: FeedbackPort; calls: RecordedPortCall[] } {
  const calls: RecordedPortCall[] = []

  function guard(method: string): void {
    if (script.reject === method) throw new Error(`${method} unavailable`)
  }

  const port: FeedbackPort = {
    async resolve(messageId, userId) {
      calls.push({ method: "resolve", args: [messageId, userId] })
      guard("resolve")
      return script.resolution ?? { status: "ok", messageId }
    },
    async upsert(input) {
      calls.push({ method: "upsert", args: [input] })
      guard("upsert")
      return (
        script.vote ?? {
          messageId: input.messageId,
          userId: input.userId,
          value: input.value,
          note: input.note,
          createdAt: NOW,
        }
      )
    },
    async forMessages(ids) {
      calls.push({ method: "forMessages", args: [ids] })
      guard("forMessages")
      return script.votes ?? []
    },
  }

  return { port, calls }
}

describe("createFeedbackStore", () => {
  it("records through resolve then upsert, and reports the stored value", async () => {
    const { port, calls } = createFakePort()
    const store = createFeedbackStore({ port })

    await expect(
      store.record({ messageId: MESSAGE_ID, userId: USER_ID, value: 1, note: null })
    ).resolves.toEqual({ recorded: true, value: 1 })

    // The resolution runs first, so a message that is not the caller's never
    // reaches the write.
    expect(calls.map((call) => call.method)).toEqual(["resolve", "upsert"])
    expect(calls[0]?.args).toEqual([MESSAGE_ID, USER_ID])
  })

  it("refuses an unowned message without writing", async () => {
    const { port, calls } = createFakePort({ resolution: { status: "not_found" } })

    await expect(
      createFeedbackStore({ port }).record({ messageId: MESSAGE_ID, userId: USER_ID, value: 1, note: null })
    ).resolves.toEqual({ recorded: false, reason: "not_found" })

    expect(calls.map((call) => call.method)).toEqual(["resolve"])
  })

  it("refuses a non-assistant message without writing", async () => {
    const { port, calls } = createFakePort({ resolution: { status: "not_assistant" } })

    await expect(
      createFeedbackStore({ port }).record({ messageId: MESSAGE_ID, userId: USER_ID, value: -1, note: null })
    ).resolves.toEqual({ recorded: false, reason: "not_assistant" })

    expect(calls.map((call) => call.method)).toEqual(["resolve"])
  })

  it("forMessages short-circuits an empty set before the port sees it", async () => {
    const { port, calls } = createFakePort({ votes: [VOTE] })

    await expect(createFeedbackStore({ port }).forMessages([])).resolves.toEqual([])

    expect(calls).toEqual([])
  })

  it("forMessages delegates a non-empty set to the port", async () => {
    const { port, calls } = createFakePort({ votes: [VOTE] })

    await expect(createFeedbackStore({ port }).forMessages([MESSAGE_ID])).resolves.toEqual([VOTE])

    expect(calls).toEqual([{ method: "forMessages", args: [[MESSAGE_ID]] }])
  })
})
