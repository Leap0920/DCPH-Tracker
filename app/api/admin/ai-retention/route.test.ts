// app/api/admin/ai-retention/route.test.ts
//
// Constraint 11: `.env.local` holds a real SUPABASE_SERVICE_ROLE_KEY, so a test
// that let the route build its own admin client could delete the live project's
// request log. Every collaborator is mocked, and the happy-path test asserts
// that `createAdminClient` was the mock -- that assertion is the negative
// control proving no real Supabase client was ever constructed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const retention = vi.fn()
const createObservabilityStore = vi.fn()
const createSupabaseObservabilityPort = vi.fn()
vi.mock("@/lib/ai/observability/store", () => ({
  createObservabilityStore: (...args: unknown[]) => createObservabilityStore(...args),
  createSupabaseObservabilityPort: (...args: unknown[]) =>
    createSupabaseObservabilityPort(...args),
}))

const SECRET = "test-secret"

/** The client handed to the port; never a real Supabase client. */
const FAKE_CLIENT = { fake: "admin-client" }
const FAKE_PORT = { fake: "port" }

const CUTOFF_MS = Date.parse("2026-06-21T12:00:00.000Z")
const REPORT = {
  retentionDays: 90,
  cutoffMs: CUTOFF_MS,
  dryRun: true,
  removed: 200,
  batches: 1,
  exhausted: false,
}

const originalCronSecret = process.env.CRON_SECRET

/**
 * A request shaped enough for the route: `headers` for isSameOrigin, `nextUrl`
 * and `url` for the `dry_run` parameter.
 */
function get(query = "", headers: Record<string, string> = {}): NextRequest {
  const url = `http://localhost/api/admin/ai-retention${query}`
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ host: "localhost", origin: "http://localhost", ...headers }),
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  createAdminClient.mockReturnValue(FAKE_CLIENT)
  createSupabaseObservabilityPort.mockReturnValue(FAKE_PORT)
  createObservabilityStore.mockReturnValue({ retention })
  retention.mockResolvedValue(REPORT)
})

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe("GET /api/admin/ai-retention", () => {
  it("refuses a cross-origin caller before any client is built", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("", { origin: "https://evil.com" }))

    expect(response.status).toBe(403)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(createObservabilityStore).not.toHaveBeenCalled()
  })

  it("answers 401 without the secret header and never touches the database", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get())

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(retention).not.toHaveBeenCalled()
  })

  it("answers 401 for a wrong secret", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("", { authorization: "Bearer wrong-secret" }))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("never accepts the secret from a query string", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get(`?secret=${SECRET}`))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("has no session path: an admin cookie cannot delete rows", async () => {
    // The route imports no session client at all, so any cookie a request
    // carries is irrelevant. This pins the absence, not a status code.
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("?dry_run=false", { cookie: "sb-access-token=admin" }))

    expect(response.status).toBe(401)
    expect(retention).not.toHaveBeenCalled()
  })

  it("defaults to a dry run for the cron secret path", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: true,
      ...REPORT,
      cutoff: new Date(CUTOFF_MS).toISOString(),
    })

    // Negative control for constraint 11: the route used the mocked factory, so
    // no live service-role client exists anywhere in this run.
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(createSupabaseObservabilityPort).toHaveBeenCalledWith(FAKE_CLIENT)
    expect(retention).toHaveBeenCalledWith({ dryRun: true })
  })

  it("arms the delete only for ?dry_run=false", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(
      get("?dry_run=false", { authorization: `Bearer ${SECRET}` })
    )

    expect(response.status).toBe(200)
    expect(retention).toHaveBeenCalledWith({ dryRun: false })
  })

  it("keeps every other dry_run value dry", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    for (const value of ["true", "1", "yes", "", "FALSE"]) {
      retention.mockClear()
      await GET(get(`?dry_run=${value}`, { authorization: `Bearer ${SECRET}` }))
      expect(retention).toHaveBeenCalledWith({ dryRun: true })
    }
  })

  it("pins one clock for the whole request", async () => {
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    await GET(get("", { authorization: `Bearer ${SECRET}` }))

    const { now } = createObservabilityStore.mock.calls[0][0] as { now: () => number }
    expect(now()).toBe(now())
  })

  it("answers 500 with a clear message when the service-role key is missing", async () => {
    createAdminClient.mockReturnValue(null)
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Missing Supabase service role env vars" })
    expect(retention).not.toHaveBeenCalled()
  })

  it("answers 500 carrying the store's message when the sweep fails", async () => {
    retention.mockRejectedValue(
      new Error('[ai-observability] listExpiredIds: relation "public.ai_request_log" does not exist')
    )
    const { GET } = await import("@/app/api/admin/ai-retention/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain(
      "[ai-observability] listExpiredIds:"
    )
  })

  it("declares the nodejs runtime and the 60s ceiling", async () => {
    const { maxDuration, runtime } = await import("@/app/api/admin/ai-retention/route")
    expect(maxDuration).toBe(60)
    expect(runtime).toBe("nodejs")
  })
})
