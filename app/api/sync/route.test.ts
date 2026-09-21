// app/api/sync/route.test.ts
//
// Constraint 11: `.env.local` holds a real SUPABASE_SERVICE_ROLE_KEY, so a test
// that let the route build its own admin client would write to the live
// project's content_entries. Every collaborator is mocked here, and the
// delegated-cron tests assert `createAdminClient` was the mock -- that
// assertion is the negative control proving no real Supabase client was ever
// constructed.
//
// `@/lib/kitsu` is deliberately left real: GET's session path and the airing
// branch POST delegates to never reach it (it is seed-mode only), so mocking it
// would be mocking more than this file's paths need.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const rateLimitPersistent = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({
  rateLimitPersistent: (...args: unknown[]) => rateLimitPersistent(...args),
}))

const getUser = vi.fn()
const createClient = vi.fn()
vi.mock("@/utils/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

// The three modules the airing branch actually calls (see syncAiring):
//   getNextAiringEpisode()          -- lib/anilist
//   getAllEpisodes(), getAnimeFull() -- lib/jikan
//   resolveDcwImagesBatch(), pickImageUrl() -- lib/dcw-images
const getAllEpisodes = vi.fn()
const getAnimeFull = vi.fn()
vi.mock("@/lib/jikan", () => ({
  getAllEpisodes: (...args: unknown[]) => getAllEpisodes(...args),
  getAnimeFull: (...args: unknown[]) => getAnimeFull(...args),
  DETECTIVE_CONAN_MAL_ID: 235,
}))

const getNextAiringEpisode = vi.fn()
vi.mock("@/lib/anilist", () => ({
  getNextAiringEpisode: (...args: unknown[]) => getNextAiringEpisode(...args),
}))

const pickImageUrl = vi.fn()
const resolveDcwImagesBatch = vi.fn()
vi.mock("@/lib/dcw-images", () => ({
  pickImageUrl: (...args: unknown[]) => pickImageUrl(...args),
  resolveDcwImagesBatch: (...args: unknown[]) => resolveDcwImagesBatch(...args),
}))

const SECRET = "test-secret"
const USER_ID = "11111111-1111-4111-8111-111111111111"

/** What the status body's four `count: "exact"` reads return, per type. */
const COUNTS: Record<string, number> = { episode: 12, movie: 3, special: 2, ova: 1 }

/** Set per test so the mocked `profiles` read can answer admin or not. */
let profileRole: string | null = "admin"

interface QueryState {
  table: string
  eqArgs: [string, unknown][]
  selectOptions?: Record<string, unknown>
}

interface FakeQueryBuilder {
  select: (columns?: string, options?: Record<string, unknown>) => FakeQueryBuilder
  eq: (column: string, value: unknown) => FakeQueryBuilder
  in: (column: string, values: unknown[]) => FakeQueryBuilder
  order: (column: string, options?: unknown) => FakeQueryBuilder
  limit: (count: number) => FakeQueryBuilder
  range: (from: number, to: number) => FakeQueryBuilder
  single: () => FakeQueryBuilder
  insert: (rows: unknown) => Promise<{ error: null }>
  then: (resolve: (value: unknown) => unknown) => void
}

/**
 * The shape a query resolves to, keyed on what the route asked for rather than
 * on call order: `profiles` answers the role, a `count: "exact"` head read
 * answers the tally, and everything else is a pagination walk that an empty
 * page ends (so the airing branch starts from dbMax 0).
 */
function resolveQuery(state: QueryState): unknown {
  if (state.table === "profiles") {
    return { data: { role: profileRole }, error: null }
  }
  if (state.selectOptions?.count) {
    const type = state.eqArgs.find(([column]) => column === "type")?.[1]
    return { count: COUNTS[String(type)] ?? 0 }
  }
  return { data: [], error: null }
}

/** Thenable chainable stub: every builder method returns itself and awaits. */
function makeQuery(state: QueryState): FakeQueryBuilder {
  const query: FakeQueryBuilder = {
    select: (_columns, options) => {
      state.selectOptions = options
      return query
    },
    eq: (column, value) => {
      state.eqArgs.push([column, value])
      return query
    },
    in: () => query,
    order: () => query,
    limit: () => query,
    range: () => query,
    single: () => query,
    insert: async () => ({ error: null }),
    then: (resolve) => resolve(resolveQuery(state)),
  }
  return query
}

function makeServerClient() {
  return {
    auth: { getUser },
    from: (table: string) => makeQuery({ table, eqArgs: [] }),
  }
}

/**
 * The client the mocked `createAdminClient` hands back. It carries the same
 * query surface as the server client because POST's cron path writes through
 * it (`writeClient = admin`), and it is never a real Supabase client.
 */
let adminClient: ReturnType<typeof makeServerClient>

const originalCronSecret = process.env.CRON_SECRET

/**
 * A request shaped enough for the route: `headers` for isSameOrigin and the
 * cron check, and `nextUrl` for POST's searchParams (a plain `Request` has no
 * `nextUrl`). The defaults are a same-origin call, which is what the session
 * path and a same-origin POST see.
 */
function get(query = "", headers: Record<string, string> = {}): NextRequest {
  const url = `http://localhost/api/sync${query}`
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({ host: "localhost", origin: "http://localhost", ...headers }),
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  profileRole = "admin"
  rateLimitPersistent.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  createClient.mockResolvedValue(makeServerClient())
  adminClient = makeServerClient()
  createAdminClient.mockReturnValue(adminClient)
  getNextAiringEpisode.mockResolvedValue({ episode: 2, airingAt: 0, timeUntilAiring: 0 })
  getAllEpisodes.mockResolvedValue([
    { mal_id: 1, title: "Episode 1", aired: "2024-01-01T00:00:00+00:00" },
  ])
  getAnimeFull.mockResolvedValue({
    data: { images: { jpg: { large_image_url: "https://img/series.jpg" } } },
  })
  pickImageUrl.mockReturnValue({ url: "https://img/ep.jpg", source: "upstream" })
  resolveDcwImagesBatch.mockResolvedValue([])
})

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe("GET /api/sync", () => {
  it("answers 401 for a session-less GET with no secret, without delegating", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    // No delegation: POST's rate limit and admin client are never reached.
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
    expect(getAllEpisodes).not.toHaveBeenCalled()
  })

  it("answers 401 for a wrong Bearer secret and falls through to the session path", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airing", { authorization: "Bearer wrong-secret" }))

    expect(response.status).toBe(401)
    // A wrong secret must not open POST's door, rate limit included.
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
  })

  it("delegates to POST for the cron secret and answers the airing branch's shape", async () => {
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airing", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.mode).toBe("airing")
    expect(body.results).toHaveLength(1)
    expect(body.results[0].type).toBe("airing")
    expect(body.results[0].totalFetched).toBe(1)
    expect(body.results[0].inserted).toBe(1)
    expect(body.results[0].skipped).toBe(0)
    // Not the status body: the delegation, not the session path, answered.
    expect(body.episodes).toBeUndefined()
    expect(body.message).toBeUndefined()

    // POST's own guards ran and the session path was skipped entirely.
    expect(rateLimitPersistent).toHaveBeenCalledTimes(1)
    expect(getUser).not.toHaveBeenCalled()
    // Negative control for constraint 11: the route used the mocked factory, so
    // no live service-role client exists anywhere in this run.
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    expect(getNextAiringEpisode).toHaveBeenCalledTimes(1)
    expect(getAllEpisodes).toHaveBeenCalledTimes(1)
  })

  it("delegates a cron call that sends no Origin header at all", async () => {
    const { GET } = await import("@/app/api/sync/route")
    const url = "http://localhost/api/sync?mode=airing"
    const request = {
      url,
      nextUrl: new URL(url),
      headers: new Headers({ host: "localhost", authorization: `Bearer ${SECRET}` }),
    } as unknown as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect((await response.json()).mode).toBe("airing")
  })

  it("answers the four counts for an admin session with no secret", async () => {
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      episodes: 12,
      movies: 3,
      specials: 2,
      ovas: 1,
      total: 18,
      message: "POST to sync. mode=seed|airing.",
    })
    // The status path never builds a service-role client or syncs anything.
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(getAllEpisodes).not.toHaveBeenCalled()
  })

  it("never accepts the secret from a query string", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get(`?secret=${SECRET}`))

    expect(response.status).toBe(401)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("does not treat ?mode=airing as authorization", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airing"))

    expect(response.status).toBe(401)
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
  })

  it("treats an unset CRON_SECRET as no secret, not as a match", async () => {
    delete process.env.CRON_SECRET
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("", { authorization: "Bearer undefined" }))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("refuses a cross-origin cron call before the rate limit or any sync work", async () => {
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(
      get("?mode=airing", { authorization: `Bearer ${SECRET}`, origin: "https://evil.com" })
    )

    expect(response.status).toBe(403)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(getUser).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
  })

  it("answers 429 when POST's rate limit denies, before any sync work", async () => {
    rateLimitPersistent.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airing", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(429)
    expect(getUser).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
  })

  it("answers 400 for a mistyped mode rather than silently running the seed", async () => {
    // Every unrecognized mode used to fall through to the two full paginated
    // pulls, so a mistyped cron path cost an expensive sync instead of an error.
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airng", { authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Unknown mode. Expected one of: all, seed, airing.",
    })
    // The refusal must come before any work, not after a partial pull.
    expect(getNextAiringEpisode).not.toHaveBeenCalled()
    expect(getAllEpisodes).not.toHaveBeenCalled()
  })

  it("validates the mode after the guards, so an unauthenticated caller still gets 401", async () => {
    // The vocabulary is not secret, but an anonymous caller has no business
    // learning it: auth first, then the parameter.
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import("@/app/api/sync/route")

    const response = await GET(get("?mode=airng"))

    expect(response.status).toBe(401)
  })
})
