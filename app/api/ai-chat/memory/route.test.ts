/**
 * The transparency endpoint: what the user can list and delete.
 *
 * Both collaborators that would reach the network are mocked -- the session
 * client and the admin-client factory -- and the admin client is a recording
 * fake, so "a 400 must not touch the database" is an assertion about recorded
 * calls rather than a promise (constraint 10). The real store and the real
 * adapter run against that fake, which is the point: the ownership predicate
 * and the payload are the things under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const USER_ID = "11111111-1111-4111-8111-111111111111"
const FACT_ID = "44444444-4444-4444-8444-444444444444"
const OTHER_FACT_ID = "55555555-5555-4555-8555-555555555555"
const NOW_ISO = "2026-09-19T10:00:00.000Z"

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FACT_ID,
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
    ...overrides,
  }
}

interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeChain {
  select(columns: string): FakeChain
  eq(column: string, value: unknown): FakeChain
  order(column: string, options: unknown): FakeChain
  limit(count: number): FakeChain
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
  from(table: string): { select(columns: string): FakeChain; delete(): FakeChain }
}

/**
 * Only the two query shapes the memory port issues, and a log of every call:
 * the read chain a `list` builds, and the delete chain that reads back what it
 * removed so "nothing matched" is observable (Task 8).
 */
function createFakeAdmin(
  script: {
    rows?: Record<string, unknown>[] | null
    deleted?: Record<string, unknown>[] | null
    reject?: Error
  } = {}
): FakeAdmin {
  const calls: RecordedCall[] = []

  function chain(table: string, mode: "select" | "delete"): FakeChain {
    const self: FakeChain = {
      then(onFulfilled, onRejected) {
        if (script.reject !== undefined) {
          return Promise.reject(script.reject).then(onFulfilled, onRejected)
        }
        const data = mode === "delete" ? (script.deleted ?? []) : (script.rows ?? [])
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
      select(columns) {
        calls.push({ table, method: "select", args: [columns] })
        return self
      },
      eq(column, value) {
        calls.push({ table, method: "eq", args: [column, value] })
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
          return chain(table, "select")
        },
        delete() {
          calls.push({ table, method: "delete", args: [] })
          return chain(table, "delete")
        },
      }
    },
  }
}

function get() {
  return new Request("http://localhost/api/ai-chat/memory", { method: "GET" })
}

function remove(id?: string) {
  const suffix = id === undefined ? "" : `?id=${encodeURIComponent(id)}`
  return new Request(`http://localhost/api/ai-chat/memory${suffix}`, { method: "DELETE" })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AI_MEMORY
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
})

afterEach(() => {
  delete process.env.AI_MEMORY
})

describe("GET /api/ai-chat/memory", () => {
  it("answers 401 for an anonymous caller and never reaches the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()

    expect(response.status).toBe(401)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 500 when the service-role key is missing", async () => {
    createAdminClient.mockReturnValue(null)
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toBe(
      "Missing Supabase service role env vars"
    )
  })

  it("lists the user's facts with the cap, active first, and no cache", async () => {
    // The superseded row is handed over first on purpose: the store's ordering
    // is what puts the active one at the top of the page.
    const admin = createFakeAdmin({
      rows: [
        factRow({ id: OTHER_FACT_ID, value: "the old favorite", status: "superseded" }),
        factRow(),
      ],
    })
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()
    const body = (await response.json()) as {
      facts: Record<string, unknown>[]
      cap: number
      memoryEnabled: boolean
    }

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body.cap).toBe(50)
    expect(body.memoryEnabled).toBe(true)
    expect(body.facts.map((fact) => fact.status)).toEqual(["active", "superseded"])
    // The exact payload: nothing about the row that is not the user's business,
    // and no user id at all.
    expect(Object.keys(body.facts[0] ?? {}).sort()).toEqual([
      "confidence",
      "id",
      "key",
      "kind",
      "lastConfirmedAt",
      "status",
      "value",
    ])
    expect(body.facts[0]?.lastConfirmedAt).toBe(Date.parse(NOW_ISO))
    expect(admin.calls.some((call) => call.method === "eq" && call.args[0] === "user_id")).toBe(true)
  })

  it("lists facts even when AI_MEMORY is off", async () => {
    // D6: the kill switch stops extraction and injection, not transparency.
    process.env.AI_MEMORY = "off"
    const admin = createFakeAdmin({ rows: [factRow()] })
    createAdminClient.mockReturnValue(admin)
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()

    expect(response.status).toBe(200)
    expect(admin.calls.length).toBeGreaterThan(0)
  })

  it("reports memoryEnabled false and still lists the stored facts when AI_MEMORY is off", async () => {
    // The two facts together are the point: the flag lets the page tell "memory
    // is off" from "nothing stored yet", while the facts are still returned --
    // D6 stops extraction and injection, not transparency.
    process.env.AI_MEMORY = "off"
    createAdminClient.mockReturnValue(createFakeAdmin({ rows: [factRow()] }))
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()
    const body = (await response.json()) as {
      facts: Record<string, unknown>[]
      memoryEnabled: boolean
    }

    expect(response.status).toBe(200)
    expect(body.memoryEnabled).toBe(false)
    expect(body.facts.map((fact) => fact.id)).toEqual([FACT_ID])
  })

  it("answers 500 with the database's message when the read fails", async () => {
    createAdminClient.mockReturnValue(createFakeAdmin({ reject: new Error("db down") }))
    const { GET } = await import("@/app/api/ai-chat/memory/route")

    const response = await GET()

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain("db down")
  })
})

describe("DELETE /api/ai-chat/memory", () => {
  it("deletes the caller's own fact and reads it back by ownership", async () => {
    const admin = createFakeAdmin({ deleted: [{ id: FACT_ID }] })
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove(FACT_ID))

    expect(response.status).toBe(200)
    expect((await response.json()) as unknown).toEqual({ deleted: true })
    const ids = admin.calls
      .filter((call) => call.method === "eq" && call.args[0] === "id")
      .map((call) => call.args[1])
    expect(ids).toContain(FACT_ID)
    expect(admin.calls.some((call) => call.method === "eq" && call.args[0] === "user_id")).toBe(true)
  })

  it("answers 404 for a well-formed id that is not the caller's", async () => {
    createAdminClient.mockReturnValue(createFakeAdmin({ deleted: [] }))
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove(OTHER_FACT_ID))

    // One answer for "not yours", "not there" and "already gone": the response
    // must not be usable to probe another user's rows.
    expect(response.status).toBe(404)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
  })

  it("answers 404, not a crash, when the database fails mid-delete", async () => {
    // The store turns a port failure into `false` (Task 8 rule 4), so this is
    // the same answer as "not yours" -- deliberately, and never a 500 that
    // would distinguish the two.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    createAdminClient.mockReturnValue(createFakeAdmin({ reject: new Error("db down") }))
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove(FACT_ID))

    expect(response.status).toBe(404)
    spy.mockRestore()
  })

  it("answers 400 for a missing id without touching the database", async () => {
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove())

    expect(response.status).toBe(400)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
    expect(admin.calls).toHaveLength(0)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 400 for a malformed id without touching the database", async () => {
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove("not-a-uuid"))

    expect(response.status).toBe(400)
    expect(admin.calls).toHaveLength(0)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("still deletes when AI_MEMORY is off", async () => {
    process.env.AI_MEMORY = "off"
    createAdminClient.mockReturnValue(createFakeAdmin({ deleted: [{ id: FACT_ID }] }))
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove(FACT_ID))

    expect(response.status).toBe(200)
    expect((await response.json()) as unknown).toEqual({ deleted: true })
  })

  it("answers 401 for an anonymous caller before it reads the id", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const admin = createFakeAdmin()
    createAdminClient.mockReturnValue(admin)
    const { DELETE } = await import("@/app/api/ai-chat/memory/route")

    const response = await DELETE(remove(FACT_ID))

    expect(response.status).toBe(401)
    expect(admin.calls).toHaveLength(0)
  })
})
