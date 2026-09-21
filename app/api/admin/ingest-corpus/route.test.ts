// app/api/admin/ingest-corpus/route.test.ts
//
// Constraint 11: `.env.local` holds a real SUPABASE_SERVICE_ROLE_KEY, so a test
// that let the route build its own admin client would write to the live
// project's corpus. Every collaborator is mocked here, and the happy-path test
// asserts `createAdminClient` was the mock -- that assertion is the negative
// control proving no real client was ever constructed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const collectCorpus = vi.fn()
vi.mock("@/lib/ai/corpus/collect", () => ({
  collectCorpus: (...args: unknown[]) => collectCorpus(...args),
}))

const ingestCorpus = vi.fn()
vi.mock("@/lib/ai/corpus/ingest", () => ({
  ingestCorpus: (...args: unknown[]) => ingestCorpus(...args),
}))

const SECRET = "test-secret"

const originalCronSecret = process.env.CRON_SECRET
const originalAdminTaskSecret = process.env.ADMIN_TASK_SECRET

/** The client handed to both collaborators; never a real Supabase client. */
const FAKE_CLIENT = { fake: "admin-client" }
const DOCUMENTS = [{ id: "episode:1" }, { id: "episode:2" }]
const REPORT = {
  total: 2,
  inserted: 2,
  updated: 0,
  unchanged: 0,
  upserted: 2,
  ms: 3,
}

function post(query = "", headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/admin/ingest-corpus${query}`, {
    method: "POST",
    headers,
  })
}

function get(query = "", headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/admin/ingest-corpus${query}`, {
    method: "GET",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // ADMIN_TASK_SECRET takes precedence in the route, so a stray real value
  // would shadow the CRON_SECRET these tests control.
  delete process.env.ADMIN_TASK_SECRET
  process.env.CRON_SECRET = SECRET
  createAdminClient.mockReturnValue(FAKE_CLIENT)
  collectCorpus.mockResolvedValue(DOCUMENTS)
  ingestCorpus.mockResolvedValue(REPORT)
})

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
  if (originalAdminTaskSecret === undefined) delete process.env.ADMIN_TASK_SECRET
  else process.env.ADMIN_TASK_SECRET = originalAdminTaskSecret
})

describe("POST /api/admin/ingest-corpus", () => {
  it("rejects a request without the secret header before touching the database", async () => {
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(collectCorpus).not.toHaveBeenCalled()
    expect(ingestCorpus).not.toHaveBeenCalled()
  })

  it("rejects a wrong secret with 401", async () => {
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("", { "x-admin-secret": "wrong-secret" }))
    expect(response.status).toBe(401)
    expect(collectCorpus).not.toHaveBeenCalled()
  })

  it("collects and ingests the corpus for the correct secret", async () => {
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("", { "x-admin-secret": SECRET }))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.docs).toBe(DOCUMENTS.length)
    expect(body.dryRun).toBe(false)
    expect(body.report).toEqual(REPORT)
    expect(body.ms).toBeGreaterThanOrEqual(0)

    // Negative control for constraint 11: the route used the mocked factory,
    // so no live service-role client exists anywhere in this run.
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(collectCorpus).toHaveBeenCalledWith(FAKE_CLIENT)
    expect(ingestCorpus).toHaveBeenCalledWith({
      client: FAKE_CLIENT,
      documents: DOCUMENTS,
      dryRun: false,
    })
  })

  it("passes ?dryRun=1 through to the ingest", async () => {
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("?dryRun=1", { "x-admin-secret": SECRET }))
    expect(response.status).toBe(200)
    expect((await response.json()).dryRun).toBe(true)

    const arg = ingestCorpus.mock.calls[0][0]
    expect(arg.dryRun).toBe(true)
    expect(arg.documents).toEqual(DOCUMENTS)
  })

  it("returns 500 with the missing-env message when no admin client can be built", async () => {
    createAdminClient.mockReturnValue(null)
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("", { "x-admin-secret": SECRET }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: "Missing Supabase service role env vars",
    })
    expect(collectCorpus).not.toHaveBeenCalled()
  })

  it("returns 500 carrying the message when collecting fails", async () => {
    collectCorpus.mockRejectedValue(new Error("reading content_entries failed"))
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("", { "x-admin-secret": SECRET }))
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain("reading content_entries failed")
    expect(ingestCorpus).not.toHaveBeenCalled()
  })

  it("returns 500 carrying the message when ingesting fails", async () => {
    ingestCorpus.mockRejectedValue(new Error("upserting ai_documents failed"))
    const { POST } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await POST(post("", { "x-admin-secret": SECRET }))
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain("upserting ai_documents failed")
  })

  it("declares the 300s ceiling the collection walk needs", async () => {
    const { maxDuration } = await import("@/app/api/admin/ingest-corpus/route")
    expect(maxDuration).toBe(300)
  })
})

describe("GET /api/admin/ingest-corpus", () => {
  it("rejects a request without the Bearer secret before touching the database", async () => {
    const { GET } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await GET(get())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(collectCorpus).not.toHaveBeenCalled()
    expect(ingestCorpus).not.toHaveBeenCalled()
  })

  it("rejects the POST header and a wrong Bearer secret", async () => {
    const { GET } = await import("@/app/api/admin/ingest-corpus/route")

    // The GET door is the cron's, so the x-admin-secret POST uses must not open
    // it, and neither must a wrong value.
    expect((await GET(get("", { "x-admin-secret": SECRET }))).status).toBe(401)
    expect((await GET(get("", { authorization: "Bearer wrong-secret" }))).status).toBe(401)
    expect((await GET(get(`?secret=${SECRET}`))).status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("runs the same ingest for the cron secret", async () => {
    const { GET } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.docs).toBe(DOCUMENTS.length)
    expect(body.dryRun).toBe(false)
    expect(body.report).toEqual(REPORT)

    // Negative control for constraint 11, as in the POST tests: the route used
    // the mocked factory, so no live service-role client exists in this run.
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(collectCorpus).toHaveBeenCalledWith(FAKE_CLIENT)
    expect(ingestCorpus).toHaveBeenCalledWith({
      client: FAKE_CLIENT,
      documents: DOCUMENTS,
      dryRun: false,
    })
  })

  it("passes ?dryRun=1 through to the ingest", async () => {
    const { GET } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await GET(get("?dryRun=1", { authorization: `Bearer ${SECRET}` }))
    expect(response.status).toBe(200)
    expect((await response.json()).dryRun).toBe(true)
    expect(ingestCorpus.mock.calls[0][0].dryRun).toBe(true)
  })

  it("answers 500 with the missing-env message when no admin client can be built", async () => {
    createAdminClient.mockReturnValue(null)
    const { GET } = await import("@/app/api/admin/ingest-corpus/route")

    const response = await GET(get("", { authorization: `Bearer ${SECRET}` }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: "Missing Supabase service role env vars",
    })
    expect(collectCorpus).not.toHaveBeenCalled()
  })
})
