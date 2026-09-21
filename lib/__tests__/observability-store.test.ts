/**
 * The request-log read side, its Supabase adapter, and the policy layer over
 * them.
 *
 * Nothing here constructs a Supabase client or touches a network (constraint
 * 8): the adapter is tested against a hand-written recording fake typed against
 * the locally declared client interface, and the policy against a recording
 * fake port, so the calls -- above all the clamped window and the capped limit
 * -- are assertions rather than assumptions. The clock is injected, so no test
 * reads a real timer either.
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_WINDOW_MS,
  MAX_WINDOW_MS,
  NULL_BUCKET,
  PERCENTILE_SAMPLE_CAP,
  RECENT_ROW_LIMIT,
  RETENTION_BATCH_ROWS,
  RETENTION_MAX_BATCHES,
  createObservabilityStore,
  createSupabaseObservabilityPort,
  percentile,
  retentionDays,
  type FeedbackCountQuery,
  type ObservabilityClient,
  type ObservabilityDeleteQuery,
  type ObservabilityPort,
  type ObservabilityQuery,
  type ObservabilityResult,
  type RequestLogRow,
} from "@/lib/ai/observability/store"

const NOW_ISO = "2026-09-19T12:00:00.000Z"
const NOW = Date.parse(NOW_ISO)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const USER_ID = "11111111-1111-4111-8111-111111111111"
const ROW_ID = "99999999-9999-4999-8999-999999999999"

const LOG_TABLE = "ai_request_log"
const FEEDBACK_TABLE = "ai_message_feedback"

const originalRetentionDays = process.env.AI_LOG_RETENTION_DAYS

afterEach(() => {
  if (originalRetentionDays === undefined) delete process.env.AI_LOG_RETENTION_DAYS
  else process.env.AI_LOG_RETENTION_DAYS = originalRetentionDays
})

/** The stored row `listRequests` reads back, with both nullable fields null. */
const LOG_ROW: Record<string, unknown> = {
  id: ROW_ID,
  created_at: NOW_ISO,
  outcome: "ok",
  target_id: "groq:a",
  plan_source: null,
  degraded_reason: null,
  plan_ms: 12,
  retrieve_ms: 34,
  ttft_ms: 56,
  total_ms: 78,
  doc_count: 4,
  citations_valid: null,
  tools: ["retrieve", "wiki"],
  prompt_tokens: 100,
  completion_tokens: 20,
  user_id: USER_ID,
  conversation_id: null,
}

const LOG_ROW_MAPPED: RequestLogRow = {
  id: ROW_ID,
  createdAt: NOW,
  outcome: "ok",
  targetId: "groq:a",
  planSource: null,
  degradedReason: null,
  planMs: 12,
  retrieveMs: 34,
  ttftMs: 56,
  totalMs: 78,
  docCount: 4,
  citationsValid: null,
  tools: ["retrieve", "wiki"],
  promptTokens: 100,
  completionTokens: 20,
  userId: USER_ID,
  conversationId: null,
}

interface RecordedClientCall {
  table: string
  method: string
  args: unknown[]
}

interface ClientScript {
  /** The rows a list read returns. */
  rows?: Record<string, unknown>[] | null
  /** The number a `count: "exact"` read reports. */
  count?: number | null
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
  client: ObservabilityClient
  calls: RecordedClientCall[]
} {
  const calls: RecordedClientCall[] = []

  function record(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args })
  }

  function settle<T>(value: T): Promise<T> {
    return script.reject ? Promise.reject(script.reject) : Promise.resolve(value)
  }

  function query(table: string): ObservabilityQuery {
    const chain: ObservabilityQuery = {
      then(onFulfilled, onRejected) {
        const reply: ObservabilityResult = script.error
          ? { data: null, error: script.error }
          : { data: script.rows ?? null, error: null, count: script.count ?? null }
        return settle(reply).then(onFulfilled, onRejected)
      },
      gte(column, value) {
        record(table, "gte", [column, value])
        return chain
      },
      lt(column, value) {
        record(table, "lt", [column, value])
        return chain
      },
      eq(column, value) {
        record(table, "eq", [column, value])
        return chain
      },
      not(column, operator, value) {
        record(table, "not", [column, operator, value])
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
    }
    return chain
  }

  /** The delete chain, recording the `in()` predicate the sweep builds. */
  function deleteQuery(table: string): ObservabilityDeleteQuery {
    const chain: ObservabilityDeleteQuery = {
      then(onFulfilled, onRejected) {
        const reply: ObservabilityResult = script.error
          ? { data: null, error: script.error }
          : { data: null, error: null }
        return settle(reply).then(onFulfilled, onRejected)
      },
      in(column, values) {
        record(table, "in", [column, values])
        return chain
      },
    }
    return chain
  }

  const client: ObservabilityClient = {
    from(table) {
      return {
        select(columns, options) {
          // The options bag is absent on a row read, so recording it
          // conditionally keeps the assertions honest about which read ran.
          record(table, "select", options === undefined ? [columns] : [columns, options])
          return query(table)
        },
        delete() {
          record(table, "delete", [])
          return deleteQuery(table)
        },
      }
    },
  }

  return { client, calls }
}

describe("createSupabaseObservabilityPort countRequests", () => {
  it("head-counts the window and returns the exact number", async () => {
    const { client, calls } = createRecordingClient({ count: 7 })

    await expect(
      createSupabaseObservabilityPort(client).countRequests({ sinceMs: NOW - HOUR, untilMs: NOW })
    ).resolves.toBe(7)

    // A head count: the rows are never transferred, which is what makes an
    // exact count affordable over any window.
    expect(calls).toEqual([
      { table: LOG_TABLE, method: "select", args: ["id", { count: "exact", head: true }] },
      { table: LOG_TABLE, method: "gte", args: ["created_at", new Date(NOW - HOUR).toISOString()] },
      { table: LOG_TABLE, method: "lt", args: ["created_at", new Date(NOW).toISOString()] },
    ])
  })

  it("reads a missing count as zero rather than NaN", async () => {
    const { client } = createRecordingClient({ count: null })

    await expect(
      createSupabaseObservabilityPort(client).countRequests({ sinceMs: NOW - HOUR, untilMs: NOW })
    ).resolves.toBe(0)
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "relation does not exist" } })

    await expect(
      createSupabaseObservabilityPort(client).countRequests({ sinceMs: NOW - HOUR, untilMs: NOW })
    ).rejects.toThrow("[ai-observability] countRequests: relation does not exist")
  })
})

describe("createSupabaseObservabilityPort listRequests", () => {
  it("reads the newest rows in the window and maps every field", async () => {
    const { client, calls } = createRecordingClient({ rows: [LOG_ROW] })

    await expect(
      createSupabaseObservabilityPort(client).listRequests({
        sinceMs: NOW - HOUR,
        untilMs: NOW,
        limit: 50,
      })
    ).resolves.toEqual([LOG_ROW_MAPPED])

    expect(calls).toEqual([
      { table: LOG_TABLE, method: "select", args: [expect.stringContaining("degraded_reason")] },
      { table: LOG_TABLE, method: "gte", args: ["created_at", new Date(NOW - HOUR).toISOString()] },
      { table: LOG_TABLE, method: "lt", args: ["created_at", new Date(NOW).toISOString()] },
      { table: LOG_TABLE, method: "order", args: ["created_at", { ascending: false }] },
      { table: LOG_TABLE, method: "limit", args: [50] },
    ])
  })

  it("issues no date predicate when no window is given", async () => {
    const { client, calls } = createRecordingClient({ rows: [] })

    // `recent` reads the newest rows regardless of age, so the query is bounded
    // by the limit alone and the index still supplies the order.
    await expect(createSupabaseObservabilityPort(client).listRequests({ limit: 5 })).resolves.toEqual([])

    expect(calls).toEqual([
      { table: LOG_TABLE, method: "select", args: [expect.stringContaining("created_at")] },
      { table: LOG_TABLE, method: "order", args: ["created_at", { ascending: false }] },
      { table: LOG_TABLE, method: "limit", args: [5] },
    ])
  })

  it("keeps a null tool list distinct from an empty one", async () => {
    const { client } = createRecordingClient({ rows: [{ ...LOG_ROW, tools: null }] })

    const rows = await createSupabaseObservabilityPort(client).listRequests({ limit: 1 })

    // A v1 row's null tools and a pipeline row that dispatched nothing are
    // different facts, and the mapping must not collapse them.
    expect(rows[0]?.tools).toBeNull()
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "permission denied" } })

    await expect(createSupabaseObservabilityPort(client).listRequests({ limit: 5 })).rejects.toThrow(
      "[ai-observability] listRequests: permission denied"
    )
  })
})

describe("createSupabaseObservabilityPort countFeedback", () => {
  it("counts one vote value in the window", async () => {
    const { client, calls } = createRecordingClient({ count: 3 })

    await expect(
      createSupabaseObservabilityPort(client).countFeedback({
        sinceMs: NOW - HOUR,
        untilMs: NOW,
        value: -1,
      })
    ).resolves.toBe(3)

    expect(calls).toEqual([
      { table: FEEDBACK_TABLE, method: "select", args: ["id", { count: "exact", head: true }] },
      { table: FEEDBACK_TABLE, method: "gte", args: ["created_at", new Date(NOW - HOUR).toISOString()] },
      { table: FEEDBACK_TABLE, method: "lt", args: ["created_at", new Date(NOW).toISOString()] },
      { table: FEEDBACK_TABLE, method: "eq", args: ["value", -1] },
    ])
  })

  it("narrows to noted votes with is-not-null, not an equality", async () => {
    const { client, calls } = createRecordingClient({ count: 2 })

    await createSupabaseObservabilityPort(client).countFeedback({
      sinceMs: NOW - HOUR,
      untilMs: NOW,
      hasNote: true,
    })

    // `note <> null` matches no row in SQL, so the filter has to be `is not
    // null` or every vote would count as un-noted.
    expect(calls).toContainEqual({ table: FEEDBACK_TABLE, method: "not", args: ["note", "is", null] })
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "permission denied" } })

    await expect(
      createSupabaseObservabilityPort(client).countFeedback({ sinceMs: NOW - HOUR, untilMs: NOW })
    ).rejects.toThrow("[ai-observability] countFeedback: permission denied")
  })
})

describe("createSupabaseObservabilityPort listExpiredIds", () => {
  it("reads the oldest expired ids, unbounded by any window but the limit", async () => {
    const { client, calls } = createRecordingClient({
      rows: [{ id: ROW_ID }, { id: "other-id" }],
    })

    await expect(
      createSupabaseObservabilityPort(client).listExpiredIds({
        beforeMs: NOW - 90 * 24 * HOUR,
        limit: RETENTION_BATCH_ROWS,
      })
    ).resolves.toEqual([ROW_ID, "other-id"])

    // Ascending, so the sweep takes the rows closest to falling off the end,
    // and a bare `lt` predicate: no `gte` bounds the read to a window (F2).
    expect(calls).toEqual([
      { table: LOG_TABLE, method: "select", args: ["id"] },
      {
        table: LOG_TABLE,
        method: "lt",
        args: ["created_at", new Date(NOW - 90 * 24 * HOUR).toISOString()],
      },
      { table: LOG_TABLE, method: "order", args: ["created_at", { ascending: true }] },
      { table: LOG_TABLE, method: "limit", args: [RETENTION_BATCH_ROWS] },
    ])
  })

  it("answers an empty table with no ids", async () => {
    const { client } = createRecordingClient({ rows: [] })

    await expect(
      createSupabaseObservabilityPort(client).listExpiredIds({ beforeMs: NOW, limit: 10 })
    ).resolves.toEqual([])
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "relation does not exist" } })

    await expect(
      createSupabaseObservabilityPort(client).listExpiredIds({ beforeMs: NOW, limit: 10 })
    ).rejects.toThrow("[ai-observability] listExpiredIds: relation does not exist")
  })
})

describe("createSupabaseObservabilityPort deleteRequests", () => {
  it("deletes exactly the given ids", async () => {
    const { client, calls } = createRecordingClient({})

    await createSupabaseObservabilityPort(client).deleteRequests([ROW_ID, "other-id"])

    expect(calls).toEqual([
      { table: LOG_TABLE, method: "delete", args: [] },
      { table: LOG_TABLE, method: "in", args: ["id", [ROW_ID, "other-id"]] },
    ])
  })

  it("issues no query for an empty id list", async () => {
    const { client, calls } = createRecordingClient({})

    // An empty `.in()` is an invalid predicate; nothing to delete is not a query.
    await createSupabaseObservabilityPort(client).deleteRequests([])

    expect(calls).toEqual([])
  })

  it("rejects with the database's message and the method that failed", async () => {
    const { client } = createRecordingClient({ error: { message: "permission denied" } })

    await expect(
      createSupabaseObservabilityPort(client).deleteRequests([ROW_ID])
    ).rejects.toThrow("[ai-observability] deleteRequests: permission denied")
  })
})

interface RecordedPortCall {
  method: string
  args: unknown[]
}

interface PortScript {
  count?: number
  rows?: RequestLogRow[]
  /** A per-query answer, so the three feedback counts can differ. */
  feedback?: number | ((query: FeedbackCountQuery) => number)
  /**
   * Successive `listExpiredIds` answers. The sweep is expected to stop on a
   * short or empty batch, so a script that never runs short pins the run cap.
   */
  expired?: string[][]
  /** The one method that rejects, as a dropped connection would. */
  reject?: string
}

function createFakePort(script: PortScript = {}): {
  port: ObservabilityPort
  calls: RecordedPortCall[]
} {
  const calls: RecordedPortCall[] = []
  let expiredReads = 0

  const port: ObservabilityPort = {
    async countRequests(window) {
      calls.push({ method: "countRequests", args: [window] })
      if (script.reject === "countRequests") throw new Error("countRequests unavailable")
      return script.count ?? 0
    },
    async listRequests(query) {
      calls.push({ method: "listRequests", args: [query] })
      if (script.reject === "listRequests") throw new Error("listRequests unavailable")
      return script.rows ?? []
    },
    async countFeedback(query) {
      calls.push({ method: "countFeedback", args: [query] })
      if (script.reject === "countFeedback") throw new Error("countFeedback unavailable")
      if (typeof script.feedback === "function") return script.feedback(query)
      return script.feedback ?? 0
    },
    async listExpiredIds(query) {
      calls.push({ method: "listExpiredIds", args: [query] })
      if (script.reject === "listExpiredIds") throw new Error("listExpiredIds unavailable")
      return script.expired?.[expiredReads++] ?? []
    },
    async deleteRequests(ids) {
      calls.push({ method: "deleteRequests", args: [ids] })
      if (script.reject === "deleteRequests") throw new Error("deleteRequests unavailable")
    },
  }

  return { port, calls }
}

function row(overrides: Partial<RequestLogRow>): RequestLogRow {
  return {
    id: ROW_ID,
    createdAt: NOW - HOUR,
    outcome: "ok",
    targetId: "groq:a",
    planSource: "router",
    degradedReason: null,
    planMs: 10,
    retrieveMs: 20,
    ttftMs: 30,
    totalMs: 40,
    docCount: 3,
    citationsValid: true,
    tools: [],
    promptTokens: 100,
    completionTokens: 50,
    userId: null,
    conversationId: null,
    ...overrides,
  }
}

/**
 * Five rows that exercise every bucket: a null degraded_reason and a null
 * plan_source (the v1 shape), both citation verdicts and the unmeasured null, a
 * missing retrieval latency, and latency samples that are both odd and even in
 * length.
 */
const SUMMARY_ROWS: RequestLogRow[] = [
  row({
    id: "r1",
    outcome: "ok",
    degradedReason: null,
    planSource: "router",
    citationsValid: true,
    retrieveMs: 10,
    ttftMs: 100,
    totalMs: 200,
  }),
  row({
    id: "r2",
    outcome: "ok",
    degradedReason: "uncited",
    planSource: "router",
    citationsValid: false,
    retrieveMs: 20,
    ttftMs: 200,
    totalMs: 400,
  }),
  row({
    id: "r3",
    outcome: "partial",
    degradedReason: null,
    planSource: "model",
    citationsValid: null,
    retrieveMs: 30,
    ttftMs: 300,
    totalMs: 600,
  }),
  row({
    id: "r4",
    outcome: "error",
    degradedReason: "retrieval_failed",
    planSource: null,
    citationsValid: true,
    retrieveMs: null,
    ttftMs: 400,
    totalMs: 800,
  }),
  row({
    id: "r5",
    outcome: "rate_limited",
    degradedReason: "retrieval_failed",
    planSource: null,
    citationsValid: null,
    retrieveMs: null,
    ttftMs: null,
    totalMs: null,
  }),
]

describe("createObservabilityStore summary", () => {
  it("aggregates every bucket from the window's rows, nulls included", async () => {
    const { port, calls } = createFakePort({ count: 5, rows: SUMMARY_ROWS })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.summary({ sinceMs: NOW - HOUR, untilMs: NOW })

    expect(summary.requestCount).toBe(5)
    expect(summary.sampledRows).toBe(5)
    expect(summary.sampled).toBe(false)
    expect(summary.byOutcome).toEqual({ ok: 2, partial: 1, error: 1, rate_limited: 1 })
    // "no degradation" and "a v1 request" are counts of their own, not gaps.
    expect(summary.byDegradedReason).toEqual({ [NULL_BUCKET]: 2, uncited: 1, retrieval_failed: 2 })
    expect(summary.byPlanSource).toEqual({ router: 2, model: 1, [NULL_BUCKET]: 2 })
    expect(summary.citations).toEqual({ valid: 2, invalid: 1, unmeasured: 2 })

    // Odd sample: [10, 20, 30] -> p50 is the middle value, p95 interpolates.
    expect(summary.latency.retrieveMs).toEqual({ count: 3, p50: 20, p95: 29 })
    // Even sample: [100, 200, 300, 400] -> both quantiles interpolate.
    expect(summary.latency.ttftMs).toEqual({ count: 4, p50: 250, p95: 385 })
    expect(summary.latency.totalMs).toEqual({ count: 4, p50: 500, p95: 770 })

    expect(calls[0]?.args).toEqual([{ sinceMs: NOW - HOUR, untilMs: NOW }])
    expect(calls[1]?.args).toEqual([
      { sinceMs: NOW - HOUR, untilMs: NOW, limit: PERCENTILE_SAMPLE_CAP },
    ])
  })

  it("clamps a window wider than the maximum to the maximum", async () => {
    const { port, calls } = createFakePort({ rows: [] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.summary({ sinceMs: NOW - 400 * 24 * HOUR, untilMs: NOW })

    // The caller asked for more than a year and got thirty days: the bound is
    // not a parameter, and the summary names the window it really read.
    expect(calls[0]?.args).toEqual([{ sinceMs: NOW - MAX_WINDOW_MS, untilMs: NOW }])
    expect(calls[1]?.args).toEqual([
      { sinceMs: NOW - MAX_WINDOW_MS, untilMs: NOW, limit: PERCENTILE_SAMPLE_CAP },
    ])
    expect(summary.sinceMs).toBe(NOW - MAX_WINDOW_MS)
    expect(summary.untilMs).toBe(NOW)
  })

  it("defaults an omitted window to the default window ending at the injected clock", async () => {
    const { port, calls } = createFakePort({ rows: [] })
    const store = createObservabilityStore({ port, now: () => NOW })

    await store.summary()

    expect(calls[0]?.args).toEqual([{ sinceMs: NOW - DEFAULT_WINDOW_MS, untilMs: NOW }])
    expect(calls[1]?.args).toEqual([
      { sinceMs: NOW - DEFAULT_WINDOW_MS, untilMs: NOW, limit: PERCENTILE_SAMPLE_CAP },
    ])
  })

  it("caps the sampled row read and says the breakdown was sampled", async () => {
    const rows = Array.from({ length: PERCENTILE_SAMPLE_CAP }, (_, index) => row({ id: `r${index}` }))
    const { port, calls } = createFakePort({ count: 5000, rows })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.summary({ sinceMs: NOW - HOUR, untilMs: NOW })

    // The count is exact while the breakdown is not, and the summary says so
    // rather than presenting a capped sample as the whole window.
    expect(summary.requestCount).toBe(5000)
    expect(summary.sampledRows).toBe(PERCENTILE_SAMPLE_CAP)
    expect(summary.sampled).toBe(true)
    expect(calls[1]?.args).toEqual([
      { sinceMs: NOW - HOUR, untilMs: NOW, limit: PERCENTILE_SAMPLE_CAP },
    ])
  })

  it("answers an empty window with zeros and issues no query", async () => {
    const { port, calls } = createFakePort({ rows: SUMMARY_ROWS })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.summary({ sinceMs: NOW, untilMs: NOW - HOUR })

    expect(calls).toEqual([])
    expect(summary).toEqual({
      sinceMs: NOW,
      untilMs: NOW - HOUR,
      requestCount: 0,
      sampledRows: 0,
      sampled: false,
      byOutcome: {},
      byDegradedReason: {},
      byPlanSource: {},
      citations: { valid: 0, invalid: 0, unmeasured: 0 },
      latency: {
        retrieveMs: { count: 0, p50: null, p95: null },
        ttftMs: { count: 0, p50: null, p95: null },
        totalMs: { count: 0, p50: null, p95: null },
      },
    })
  })

  it("answers an empty table with zeros, not null and not a crash", async () => {
    const { port } = createFakePort({ count: 0, rows: [] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.summary({ sinceMs: NOW - HOUR, untilMs: NOW })

    expect(summary.requestCount).toBe(0)
    expect(summary.byOutcome).toEqual({})
    expect(summary.byDegradedReason).toEqual({})
    expect(summary.byPlanSource).toEqual({})
    expect(summary.citations).toEqual({ valid: 0, invalid: 0, unmeasured: 0 })
    expect(summary.latency.totalMs).toEqual({ count: 0, p50: null, p95: null })
    expect(summary.sampled).toBe(false)
  })

  it("propagates the port's failure unchanged", async () => {
    const { port } = createFakePort({ reject: "countRequests" })
    const store = createObservabilityStore({ port, now: () => NOW })

    await expect(store.summary({ sinceMs: NOW - HOUR, untilMs: NOW })).rejects.toThrow(
      "countRequests unavailable"
    )
  })
})

describe("createObservabilityStore recent", () => {
  it("caps a limit larger than the constant and asks for the cap", async () => {
    const { port, calls } = createFakePort({ rows: SUMMARY_ROWS })
    const store = createObservabilityStore({ port, now: () => NOW })

    await store.recent({ limit: 5000 })

    expect(calls).toEqual([{ method: "listRequests", args: [{ limit: RECENT_ROW_LIMIT }] }])
  })

  it("defaults an omitted limit to the constant", async () => {
    const { port, calls } = createFakePort({ rows: [] })
    const store = createObservabilityStore({ port, now: () => NOW })

    await store.recent()

    expect(calls).toEqual([{ method: "listRequests", args: [{ limit: RECENT_ROW_LIMIT }] }])
  })

  it("passes a smaller limit through untouched", async () => {
    const { port, calls } = createFakePort({ rows: [] })
    const store = createObservabilityStore({ port, now: () => NOW })

    await store.recent({ limit: 25 })

    expect(calls).toEqual([{ method: "listRequests", args: [{ limit: 25 }] }])
  })

  it("short-circuits a non-positive limit without issuing a query", async () => {
    const { port, calls } = createFakePort({ rows: SUMMARY_ROWS })
    const store = createObservabilityStore({ port, now: () => NOW })

    await expect(store.recent({ limit: 0 })).resolves.toEqual([])

    // An empty list must not cost a round trip (the `forMessages([])`
    // precedent).
    expect(calls).toEqual([])
  })
})

describe("createObservabilityStore feedbackSummary", () => {
  it("counts up, down and noted votes in the clamped window", async () => {
    const { port, calls } = createFakePort({
      feedback: (query) => (query.value === 1 ? 4 : query.value === -1 ? 2 : 3),
    })
    const store = createObservabilityStore({ port, now: () => NOW })

    const summary = await store.feedbackSummary({ sinceMs: NOW - HOUR, untilMs: NOW })

    expect(summary).toEqual({ sinceMs: NOW - HOUR, untilMs: NOW, up: 4, down: 2, noted: 3 })
    expect(calls.map((call) => call.method)).toEqual([
      "countFeedback",
      "countFeedback",
      "countFeedback",
    ])
    expect(calls.map((call) => call.args[0])).toEqual([
      { sinceMs: NOW - HOUR, untilMs: NOW, value: 1 },
      { sinceMs: NOW - HOUR, untilMs: NOW, value: -1 },
      { sinceMs: NOW - HOUR, untilMs: NOW, hasNote: true },
    ])
  })

  it("clamps the feedback window to the same maximum", async () => {
    const { port, calls } = createFakePort({ feedback: 0 })
    const store = createObservabilityStore({ port, now: () => NOW })

    await store.feedbackSummary({ sinceMs: NOW - 400 * 24 * HOUR, untilMs: NOW })

    expect(calls[0]?.args[0]).toEqual({ sinceMs: NOW - MAX_WINDOW_MS, untilMs: NOW, value: 1 })
  })

  it("answers an empty window with zeros and issues no query", async () => {
    const { port, calls } = createFakePort({ feedback: 9 })
    const store = createObservabilityStore({ port, now: () => NOW })

    await expect(store.feedbackSummary({ sinceMs: NOW, untilMs: NOW - HOUR })).resolves.toEqual({
      sinceMs: NOW,
      untilMs: NOW - HOUR,
      up: 0,
      down: 0,
      noted: 0,
    })

    expect(calls).toEqual([])
  })
})

describe("retentionDays", () => {
  it("defaults to ninety days when the variable is absent", () => {
    delete process.env.AI_LOG_RETENTION_DAYS

    expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS)
    expect(DEFAULT_RETENTION_DAYS).toBe(90)
  })

  it("parses a positive integer and trims surrounding space", () => {
    process.env.AI_LOG_RETENTION_DAYS = "30"
    expect(retentionDays()).toBe(30)

    process.env.AI_LOG_RETENTION_DAYS = " 45 "
    expect(retentionDays()).toBe(45)
  })

  it("falls back to the default for zero, negative, fractional and unparseable values", () => {
    // Never to zero: a zero-day cutoff would delete the whole table.
    for (const raw of ["0", "-1", "1.5", "90d", "", "  ", "abc", "NaN", "Infinity"]) {
      process.env.AI_LOG_RETENTION_DAYS = raw
      expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS)
    }
  })

  it("falls back for a value too large to be a safe integer", () => {
    process.env.AI_LOG_RETENTION_DAYS = "99999999999999999999"
    expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS)
  })
})

describe("createObservabilityStore retention", () => {
  it("defaults to a dry run: one bounded read and no delete", async () => {
    const ids = Array.from({ length: RETENTION_BATCH_ROWS }, (_, index) => `id-${index}`)
    const { port, calls } = createFakePort({ expired: [ids] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention()

    expect(report.dryRun).toBe(true)
    expect(report.removed).toBe(RETENTION_BATCH_ROWS)
    expect(report.batches).toBe(1)
    // A full batch means more expired rows exist; the sweep is not complete.
    expect(report.exhausted).toBe(false)
    expect(calls.map((call) => call.method)).toEqual(["listExpiredIds"])
    expect(calls[0]?.args).toEqual([
      { beforeMs: NOW - DEFAULT_RETENTION_DAYS * DAY, limit: RETENTION_BATCH_ROWS },
    ])
  })

  it("treats an explicit dryRun: true as a dry run too", async () => {
    const { port, calls } = createFakePort({ expired: [["a", "b"]] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: true })

    expect(report.dryRun).toBe(true)
    expect(report.removed).toBe(2)
    expect(calls.map((call) => call.method)).toEqual(["listExpiredIds"])
  })

  it("reports a short dry-run batch as exhausted", async () => {
    const { port } = createFakePort({ expired: [["only-one"]] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention()

    expect(report.removed).toBe(1)
    expect(report.exhausted).toBe(true)
  })

  it("keeps the retention cutoff unwindowed: the full age, never MAX_WINDOW_MS (F2)", async () => {
    const { port, calls } = createFakePort({ expired: [[]] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: false })

    // The failure this pins: a 90-day cutoff routed through resolveWindow would
    // arrive as NOW - MAX_WINDOW_MS (30 days), so the sweep would look complete
    // while leaving most of the expired table behind. `DEFAULT_RETENTION_DAYS`
    // days must be strictly wider than the read side's maximum window for this
    // assertion to mean anything.
    expect(DEFAULT_RETENTION_DAYS * DAY).toBeGreaterThan(MAX_WINDOW_MS)
    expect(calls[0]?.args).toEqual([
      { beforeMs: NOW - DEFAULT_RETENTION_DAYS * DAY, limit: RETENTION_BATCH_ROWS },
    ])
    expect(report.cutoffMs).toBe(NOW - DEFAULT_RETENTION_DAYS * DAY)
  })

  it("deletes batch after batch in a real run and stops at the first short batch", async () => {
    const full = Array.from({ length: RETENTION_BATCH_ROWS }, (_, index) => `full-${index}`)
    const partial = ["last-1", "last-2"]
    const { port, calls } = createFakePort({ expired: [full, partial] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: false })

    expect(report).toEqual({
      retentionDays: DEFAULT_RETENTION_DAYS,
      cutoffMs: NOW - DEFAULT_RETENTION_DAYS * DAY,
      dryRun: false,
      removed: RETENTION_BATCH_ROWS + 2,
      batches: 2,
      exhausted: true,
    })
    expect(calls.map((call) => call.method)).toEqual([
      "listExpiredIds",
      "deleteRequests",
      "listExpiredIds",
      "deleteRequests",
    ])
    expect(calls[1]?.args).toEqual([full])
    expect(calls[3]?.args).toEqual([partial])
  })

  it("stops at the run's batch cap and reports the sweep as not exhausted", async () => {
    const full = Array.from({ length: RETENTION_BATCH_ROWS }, (_, index) => `full-${index}`)
    // Never runs short: only the run cap can stop the loop.
    const expired = Array.from({ length: RETENTION_MAX_BATCHES + 5 }, () => full)
    const { port, calls } = createFakePort({ expired })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: false })

    expect(report.batches).toBe(RETENTION_MAX_BATCHES)
    expect(report.removed).toBe(RETENTION_MAX_BATCHES * RETENTION_BATCH_ROWS)
    // The field that keeps a partial sweep from being read as a complete one.
    expect(report.exhausted).toBe(false)
    expect(calls.filter((call) => call.method === "deleteRequests")).toHaveLength(
      RETENTION_MAX_BATCHES
    )
  })

  it("reports an empty table as exhausted with nothing removed", async () => {
    const { port, calls } = createFakePort({ expired: [[]] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: false })

    expect(report).toEqual({
      retentionDays: DEFAULT_RETENTION_DAYS,
      cutoffMs: NOW - DEFAULT_RETENTION_DAYS * DAY,
      dryRun: false,
      removed: 0,
      batches: 0,
      exhausted: true,
    })
    expect(calls.map((call) => call.method)).toEqual(["listExpiredIds"])
  })

  it("uses the configured age for the cutoff", async () => {
    process.env.AI_LOG_RETENTION_DAYS = "30"
    const { port, calls } = createFakePort({ expired: [[]] })
    const store = createObservabilityStore({ port, now: () => NOW })

    const report = await store.retention({ dryRun: false })

    expect(report.retentionDays).toBe(30)
    expect(calls[0]?.args).toEqual([{ beforeMs: NOW - 30 * DAY, limit: RETENTION_BATCH_ROWS }])
  })

  it("propagates the port's failure unchanged", async () => {
    const { port } = createFakePort({ reject: "listExpiredIds" })
    const store = createObservabilityStore({ port, now: () => NOW })

    await expect(store.retention({ dryRun: false })).rejects.toThrow("listExpiredIds unavailable")
  })
})

describe("percentile", () => {
  it("takes the middle value of an odd sample", () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2)
    expect(percentile([1, 2, 3], 0.95)).toBeCloseTo(2.9, 10)
  })

  it("interpolates the two middle values of an even sample", () => {
    // Pinned so the definition cannot drift to a nearest-rank variant: p50 of
    // four values is 25, not 20 and not 30.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25)
    expect(percentile([10, 20, 30, 40], 0.95)).toBeCloseTo(38.5, 10)
  })

  it("sorts a copy rather than the caller's array", () => {
    const values = [3, 1, 2]

    expect(percentile(values, 0.5)).toBe(2)
    expect(values).toEqual([3, 1, 2])
  })

  it("answers null for an empty sample", () => {
    expect(percentile([], 0.5)).toBeNull()
  })
})
