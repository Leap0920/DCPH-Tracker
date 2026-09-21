/**
 * The conversation surfaces: the user's list, one transcript, and the archive
 * that stands in for a delete.
 *
 * Both collaborators that would reach the network are mocked -- the session
 * client and the admin-client factory -- and the admin client is a recording
 * fake, so "a malformed id must not touch the database" is an assertion about
 * recorded calls rather than a promise (constraint 10). The real store and the
 * real adapter run against that fake, which is the point: the ownership
 * predicate, the caps and the payload are the things under test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const USER_ID = "11111111-1111-4111-8111-111111111111"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_CONVERSATION_ID = "66666666-6666-4666-8666-666666666666"
const NOW_ISO = "2026-09-19T10:00:00.000Z"
const NOW = Date.parse(NOW_ISO)

function conversationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    user_id: USER_ID,
    title: "Episode 5",
    summary: "They talked about Haibara.",
    summarized_through: 8,
    message_count: 12,
    last_message_at: NOW_ISO,
    archived_at: null,
    ...overrides,
  }
}

/** Descending, the way the `order … desc` read returns them. */
const MESSAGE_ROWS: Record<string, unknown>[] = [
  { id: "m2", role: "assistant", content: "second", created_at: "2026-09-19T09:02:00.000Z" },
  { id: "m1", role: "user", content: "first", created_at: "2026-09-19T09:01:00.000Z" },
]

interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeChain {
  eq(column: string, value: unknown): FakeChain
  is(column: string, value: unknown): FakeChain
  order(column: string, options: unknown): FakeChain
  limit(count: number): FakeChain
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null
    error: { message: string } | null
  }>
  then(
    onFulfilled: (value: {
      data: Record<string, unknown>[] | null
      error: { message: string } | null
    }) => unknown,
    onRejected: (reason: unknown) => unknown
  ): unknown
}

interface FakeAdmin {
  calls: RecordedCall[]
  from(table: string): {
    select(columns: string): FakeChain
    update(values: Record<string, unknown>): FakeChain
  }
}

/**
 * The two query shapes the transcript adapter issues -- the ownership lookup a
 * `maybeSingle` ends, and the row reads and updates that are awaited -- plus a
 * log of every call, so "must not touch the database" is checkable by
 * inspection (constraint 10).
 */
function createFakeAdmin(
  script: {
    conversation?: Record<string, unknown> | null
    rows?: Record<string, unknown>[] | null
    reject?: Error
  } = {}
): FakeAdmin {
  const calls: RecordedCall[] = []

  function settle<T>(value: T): Promise<T> {
    return script.reject === undefined ? Promise.resolve(value) : Promise.reject(script.reject)
  }

  function chain(table: string): FakeChain {
    const self: FakeChain = {
      then(onFulfilled, onRejected) {
        return settle({ data: script.rows ?? [], error: null }).then(onFulfilled, onRejected)
      },
      maybeSingle() {
        calls.push({ table, method: "maybeSingle", args: [] })
        return settle({ data: script.conversation ?? null, error: null })
      },
      eq(column, value) {
        calls.push({ table, method: "eq", args: [column, value] })
        return self
      },
      is(column, value) {
        calls.push({ table, method: "is", args: [column, value] })
        return self
      },
      order(column, options) {
        calls.push({ table, method: "order", args: [column, options] })
        return self
      },
      limit(count) {
        calls.push({ table, method: "limit", args: [count] })
        return self
      },
    }
    return self
  }

  return {
    calls,
    from(table) {
      return {
        select(columns) {
          calls.push({ table, method: "select", args: [columns] })
          return chain(table)
        },
        update(values) {
          calls.push({ table, method: "update", args: [values] })
          return chain(table)
        },
      }
    },
  }
}

function get(id?: string) {
  const suffix = id === undefined ? "" : `?id=${encodeURIComponent(id)}`
  return new Request(`http://localhost/api/ai-chat/conversations${suffix}`, { method: "GET" })
}

function remove(id?: string) {
  const suffix = id === undefined ? "" : `?id=${encodeURIComponent(id)}`
  return new Request(`http://localhost/api/ai-chat/conversations${suffix}`, { method: "DELETE" })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
})

describe("GET /api/ai-chat/conversations", () => {
  it("answers 401 for an anonymous caller and never reaches the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get())

    expect(response.status).toBe(401)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 500 when the service-role key is missing", async () => {
    createAdminClient.mockReturnValue(null)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get())

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toBe(
      "Missing Supabase service role env vars"
    )
  })

  it("lists the user's newest 30 unarchived conversations with no cache", async () => {
    const admin = createFakeAdmin({ rows: [conversationRow()] })
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get())
    const body = (await response.json()) as { conversations: Record<string, unknown>[] }

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    // The exact payload: nothing about the row that is not the user's business,
    // and no user id at all.
    expect(Object.keys(body.conversations[0] ?? {}).sort()).toEqual([
      "archivedAt",
      "id",
      "lastMessageAt",
      "messageCount",
      "title",
    ])
    expect(body.conversations[0]?.lastMessageAt).toBe(NOW)
    expect(body.conversations[0]?.messageCount).toBe(12)
    expect(body.conversations[0]?.archivedAt).toBeNull()

    // The store's cap, ordering, archive exclusion and owner filter are the
    // query's, so the call log is where they are asserted.
    expect(admin.calls).toContainEqual({
      table: "ai_conversations",
      method: "eq",
      args: ["user_id", USER_ID],
    })
    expect(admin.calls).toContainEqual({
      table: "ai_conversations",
      method: "is",
      args: ["archived_at", null],
    })
    expect(admin.calls).toContainEqual({
      table: "ai_conversations",
      method: "order",
      args: ["last_message_at", { ascending: false }],
    })
    expect(admin.calls).toContainEqual({ table: "ai_conversations", method: "limit", args: [30] })
    // A listing must not read a single message.
    expect(admin.calls.some((call) => call.table === "ai_messages")).toBe(false)
  })

  it("answers 500 with the database's message when the read fails", async () => {
    createAdminClient.mockReturnValue(createFakeAdmin({ reject: new Error("db down") }))
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get())

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain("db down")
  })

  it("answers with one transcript, oldest first, capped at 200 and ownership-scoped", async () => {
    const admin = createFakeAdmin({ conversation: conversationRow(), rows: MESSAGE_ROWS })
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get(CONVERSATION_ID))
    const body = (await response.json()) as {
      title: string | null
      summary: string | null
      messages: Record<string, unknown>[]
    }

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(Object.keys(body).sort()).toEqual(["id", "messages", "summary", "title"])
    expect(body.title).toBe("Episode 5")
    expect(body.summary).toBe("They talked about Haibara.")
    // The fake hands them over newest-first, the way the descending read does;
    // the transcript is the reader's order.
    expect(body.messages.map((message) => message.id)).toEqual(["m1", "m2"])
    expect(Object.keys(body.messages[0] ?? {}).sort()).toEqual([
      "content",
      "createdAt",
      "id",
      "role",
    ])
    expect(body.messages[0]?.createdAt).toBe(Date.parse("2026-09-19T09:01:00.000Z"))

    // The ownership predicate and the cap ride on the message read itself (D1).
    expect(admin.calls).toContainEqual({
      table: "ai_messages",
      method: "eq",
      args: ["conversation_id", CONVERSATION_ID],
    })
    expect(admin.calls).toContainEqual({
      table: "ai_messages",
      method: "eq",
      args: ["ai_conversations.user_id", USER_ID],
    })
    expect(admin.calls).toContainEqual({ table: "ai_messages", method: "limit", args: [200] })
  })

  it("answers 404 for a well-formed id that is not the caller's, without reading messages", async () => {
    const admin = createFakeAdmin({ conversation: null })
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get(OTHER_CONVERSATION_ID))

    expect(response.status).toBe(404)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    // The scoped conversation read said no, so no message read was attempted --
    // which is the whole point of checking ownership before touching ai_messages
    // (D1).
    expect(admin.calls.some((call) => call.table === "ai_messages")).toBe(false)
  })

  it("answers 404 for a malformed id without touching the database", async () => {
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get("not-a-uuid"))

    expect(response.status).toBe(404)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(admin.calls).toHaveLength(0)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 404 for an empty id rather than listing", async () => {
    // `?id=` is a client that sent the field with nothing in it: a request for a
    // conversation that cannot exist, not a request for the list.
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/conversations/route")

    const response = await GET(get(""))

    expect(response.status).toBe(404)
    expect(admin.calls).toHaveLength(0)
  })
})

describe("DELETE /api/ai-chat/conversations", () => {
  it("archives the caller's own conversation and never deletes the transcript", async () => {
    const admin = createFakeAdmin({ conversation: conversationRow() })
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove(CONVERSATION_ID))

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect((await response.json()) as unknown).toEqual({ archived: true })

    // Ownership is resolved first, so a miss is a 404 rather than an update that
    // matches nothing -- and the lookup carries both predicates (D1).
    const updateIndex = admin.calls.findIndex((call) => call.method === "update")
    expect(updateIndex).toBeGreaterThanOrEqual(0)
    const lookup = admin.calls.slice(0, updateIndex)
    expect(lookup.some((call) => call.method === "maybeSingle")).toBe(true)
    expect(lookup).toContainEqual({
      table: "ai_conversations",
      method: "eq",
      args: ["id", CONVERSATION_ID],
    })
    expect(lookup).toContainEqual({
      table: "ai_conversations",
      method: "eq",
      args: ["user_id", USER_ID],
    })

    // A soft delete and nothing else: the row keeps its transcript, and the next
    // list read stops showing it (D4).
    const values = (admin.calls[updateIndex]?.args[0] ?? {}) as Record<string, unknown>
    expect(Object.keys(values)).toEqual(["archived_at"])
    expect(Number.isNaN(Date.parse(String(values.archived_at)))).toBe(false)

    // The ownership predicate rides on the update itself, not only on the lookup
    // that preceded it (Task 2 rule 3).
    const afterUpdate = admin.calls.slice(updateIndex + 1)
    expect(afterUpdate.some((call) => call.method === "eq" && call.args[0] === "id")).toBe(true)
    expect(afterUpdate.some((call) => call.method === "eq" && call.args[0] === "user_id")).toBe(true)
    expect(admin.calls.some((call) => call.table === "ai_messages")).toBe(false)
  })

  it("answers 404 for a well-formed id that is not the caller's and never writes", async () => {
    const admin = createFakeAdmin({ conversation: null })
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove(OTHER_CONVERSATION_ID))

    // One answer for "not yours" and "not there": the response must not be
    // usable to probe another user's conversations.
    expect(response.status).toBe(404)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(admin.calls.some((call) => call.method === "update")).toBe(false)
  })

  it("answers 400 for a missing id without touching the database", async () => {
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove())

    expect(response.status).toBe(400)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(admin.calls).toHaveLength(0)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 400 for a malformed id without touching the database", async () => {
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove("not-a-uuid"))

    expect(response.status).toBe(400)
    expect(admin.calls).toHaveLength(0)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 401 for an anonymous caller before it reads the id", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove(CONVERSATION_ID))

    expect(response.status).toBe(401)
    expect(admin.calls).toHaveLength(0)
  })

  it("answers 500, not a crash, when the database fails during the archive", async () => {
    createAdminClient.mockReturnValue(
      createFakeAdmin({ conversation: conversationRow(), reject: new Error("db down") })
    )
    const { DELETE } = await import("@/app/api/ai-chat/conversations/route")

    const response = await DELETE(remove(CONVERSATION_ID))

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain("db down")
  })
})
