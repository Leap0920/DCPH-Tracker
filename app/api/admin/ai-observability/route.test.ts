// app/api/admin/ai-observability/route.test.ts
//
// Constraint 11: `.env.local` holds a real SUPABASE_SERVICE_ROLE_KEY, so a test
// that let the route build its own admin client could read the live project's
// request log. Every collaborator is mocked, and the happy-path tests assert
// that `createAdminClient` was the mock -- that assertion is the negative
// control proving no real Supabase client was ever constructed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const rateLimitPersistent = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({
  rateLimitPersistent: (...args: unknown[]) => rateLimitPersistent(...args),
}))

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const getUser = vi.fn()
const getProfile = vi.fn()
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: getProfile }) }) }),
  }),
}))

const summary = vi.fn()
const recent = vi.fn()
const feedbackSummary = vi.fn()
const createObservabilityStore = vi.fn()
const createSupabaseObservabilityPort = vi.fn()
vi.mock("@/lib/ai/observability/store", () => ({
  createObservabilityStore: (...args: unknown[]) => createObservabilityStore(...args),
  createSupabaseObservabilityPort: (...args: unknown[]) =>
    createSupabaseObservabilityPort(...args),
}))

const SECRET = "test-secret"
const USER_ID = "11111111-1111-4111-8111-111111111111"

/** The client handed to the port; never a real Supabase client. */
const FAKE_CLIENT = { fake: "admin-client" }
const FAKE_PORT = { fake: "port" }

const SUMMARY = {
  sinceMs: 1_700_000_000_000,
  untilMs: 1_700_086_400_000,
  requestCount: 3,
  sampledRows: 3,
  sampled: false,
  byOutcome: { ok: 3 },
  byDegradedReason: { none: 3 },
  byPlanSource: { router: 3 },
  citations: { valid: 2, invalid: 0, unmeasured: 1 },
  latency: {
    retrieveMs: { count: 3, p50: 10, p95: 20 },
    ttftMs: { count: 3, p50: 30, p95: 40 },
    totalMs: { count: 3, p50: 50, p95: 60 },
  },
}
const RECENT = [{ id: "row-1" }]
const FEEDBACK = { sinceMs: SUMMARY.sinceMs, untilMs: SUMMARY.untilMs, up: 2, down: 1, noted: 1 }

const originalCronSecret = process.env.CRON_SECRET

/**
 * A request shaped enough for the route: `headers` for isSameOrigin, `nextUrl`
 * for the rate-limit key, and `url` for the window params. A plain `Request`
 * would have no `nextUrl`.
 */
function get(query = "", headers: Record<string, string> = {}): NextRequest {
  const url = `http://localhost/api/admin/ai-observability${query}`
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ host: "localhost", origin: "http://localhost", ...headers }),
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  rateLimitPersistent.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  createAdminClient.mockReturnValue(FAKE_CLIENT)
  createSupabaseObservabilityPort.mockReturnValue(FAKE_PORT)
  createObservabilityStore.mockReturnValue({ summary, recent, feedbackSummary })
  summary.mockResolvedValue(SUMMARY)
  recent.mockResolvedValue(RECENT)
  feedbackSummary.mockResolvedValue(FEEDBACK)
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  getProfile.mockResolvedValue({ data: { role: "admin" }, error: null })
})

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe("GET /api/admin/ai-observability", () => {
  it("refuses a cross-origin caller before the rate limit or any read", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get("", { origin: "https://evil.com" }))

    expect(response.status).toBe(403)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(createObservabilityStore).not.toHaveBeenCalled()
  })

  it("answers 429 when the rate limit denies, before any store is built", async () => {
    rateLimitPersistent.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(429)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
  })

  it("answers 401 for an anonymous session and never builds a store", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
  })

  it("answers 403 for a signed-in non-admin", async () => {
    getProfile.mockResolvedValue({ data: { role: "user" }, error: null })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(403)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 500 when the profile read itself fails", async () => {
    getProfile.mockResolvedValue({ data: null, error: new Error("profiles read failed") })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(500)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("refuses a wrong Bearer secret with no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get("", { authorization: "Bearer wrong-secret" }))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("never accepts the secret from a query string", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get(`?secret=${SECRET}`))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 400 for an unparseable `since` without building a store", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get("?since=not-a-date"))

    expect(response.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
  })

  it("answers 400 for an empty `until` and for an epoch outside Date's range", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    expect((await GET(get("?until="))).status).toBe(400)
    expect((await GET(get("?since=99999999999999999"))).status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers { summary, recent, feedback } for an admin and passes the default window", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      summary: SUMMARY,
      recent: RECENT,
      feedback: FEEDBACK,
    })

    // Negative control for constraint 11: the route used the mocked factory, so
    // no live service-role client exists anywhere in this run.
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(createSupabaseObservabilityPort).toHaveBeenCalledWith(FAKE_CLIENT)
    expect(createObservabilityStore).toHaveBeenCalledWith({
      port: FAKE_PORT,
      now: expect.any(Function),
    })

    // Both edges omitted: the store owns the default and the clamp.
    expect(summary).toHaveBeenCalledWith({ sinceMs: undefined, untilMs: undefined })
    expect(recent).toHaveBeenCalledWith()
    expect(feedbackSummary).toHaveBeenCalledWith({ sinceMs: undefined, untilMs: undefined })
  })

  it("pins one clock for the whole request so both windows are the same", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    await GET(get())

    // `summary` and `feedbackSummary` resolve their windows independently, so a
    // clock read per call could straddle a millisecond and have the body report
    // two different windows. The injected clock must therefore be fixed.
    const { now } = createObservabilityStore.mock.calls[0][0] as { now: () => number }
    expect(now()).toBe(now())
  })

  it("parses ISO and epoch edges and passes them through unchanged", async () => {
    const sinceIso = "2026-01-01T00:00:00.000Z"
    const untilMs = 1_735_689_600_000
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(
      get(`?since=${encodeURIComponent(sinceIso)}&until=${untilMs}`)
    )

    expect(response.status).toBe(200)
    expect(summary).toHaveBeenCalledWith({ sinceMs: Date.parse(sinceIso), untilMs })
    expect(feedbackSummary).toHaveBeenCalledWith({ sinceMs: Date.parse(sinceIso), untilMs })
  })

  it("does not clamp an over-wide window in the route; the store owns the bound", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get("?since=0&until=1735689600000"))

    expect(response.status).toBe(200)
    expect(summary).toHaveBeenCalledWith({ sinceMs: 0, untilMs: 1_735_689_600_000 })
  })

  it("answers the cron secret path with the same shape and skips the session", async () => {
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      summary: SUMMARY,
      recent: RECENT,
      feedback: FEEDBACK,
    })
    expect(getUser).not.toHaveBeenCalled()
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(createSupabaseObservabilityPort).toHaveBeenCalledWith(FAKE_CLIENT)
  })

  it("answers 500 with a clear message when the service-role key is missing", async () => {
    createAdminClient.mockReturnValue(null)
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "Missing Supabase service role env vars",
    })
    expect(summary).not.toHaveBeenCalled()
  })

  it("answers 500 carrying the store's message when a read fails", async () => {
    summary.mockRejectedValue(
      new Error('[ai-observability] summary: relation "public.ai_request_log" does not exist')
    )
    const { GET } = await import("@/app/api/admin/ai-observability/route")

    const response = await GET(get())

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain(
      "[ai-observability] summary:"
    )
  })
})
