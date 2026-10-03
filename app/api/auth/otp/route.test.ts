import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * The route only reads `request.headers`, `request.nextUrl.pathname` and
 * `request.json()`, so the fakes here stay structural — the same approach
 * lib/__tests__/rate-limit.test.ts takes.
 */
const { rateLimitPersistent, createClient, isSameOrigin } = vi.hoisted(() => ({
  rateLimitPersistent: vi.fn(),
  createClient: vi.fn(),
  isSameOrigin: vi.fn(() => true),
}))

vi.mock("@/lib/rate-limit-db", () => ({ rateLimitPersistent }))
vi.mock("@/utils/supabase/server", () => ({ createClient }))
vi.mock("@/lib/origin-check", () => ({ isSameOrigin }))

const { POST } = await import("./route")

type LimitAnswer = { allowed: boolean; retryAfterSeconds: number }

const ALLOWED: LimitAnswer = { allowed: true, retryAfterSeconds: 0 }

/** Answers the per-IP call and the per-address call independently. */
function answerLimits(ip: LimitAnswer, email: LimitAnswer) {
  rateLimitPersistent.mockImplementation(async (key: string) =>
    key.includes(":ip:") ? ip : email
  )
}

function fakeSupabase(otpError: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
    auth: { signInWithOtp: async () => ({ error: otpError }) },
  }
}

let ipSeed = 0
function makeRequest(body: unknown, ip?: string): NextRequest {
  ipSeed += 1
  return {
    // A distinct address per request keeps the route's in-memory burst guard
    // from carrying state between tests.
    headers: new Headers({ "x-vercel-forwarded-for": ip ?? `203.0.113.${ipSeed}` }),
    nextUrl: { pathname: "/api/auth/otp" },
    json: async () => body,
  } as unknown as NextRequest
}

const SIGNUP = {
  email: "detective@example.com",
  mode: "signup",
  displayName: "Detective",
}

beforeEach(() => {
  rateLimitPersistent.mockReset()
  createClient.mockReset()
  isSameOrigin.mockReset()
  isSameOrigin.mockReturnValue(true)
  answerLimits(ALLOWED, ALLOWED)
  createClient.mockResolvedValue(fakeSupabase())
})

describe("POST /api/auth/otp — ceilings", () => {
  it("allows a signup request under both ceilings", async () => {
    const res = await POST(makeRequest(SIGNUP))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it("keeps the per-IP ceiling generous, because one address is shared", async () => {
    await POST(makeRequest(SIGNUP))

    const ipCall = rateLimitPersistent.mock.calls.find(([key]) =>
      String(key).includes(":ip:")
    )
    expect(ipCall?.[1]).toMatchObject({ limit: 60, windowMs: 60 * 60 * 1000 })
  })

  it("keeps the per-address ceiling as the per-user quota", async () => {
    await POST(makeRequest(SIGNUP))

    const emailCall = rateLimitPersistent.mock.calls.find(([key]) =>
      String(key).includes(":id:")
    )
    expect(emailCall?.[1]).toMatchObject({ limit: 10, windowMs: 60 * 60 * 1000 })
  })

  it("never spends the network's budget on a malformed address", async () => {
    const res = await POST(makeRequest({ email: "not-an-address", mode: "signup" }))

    expect(res.status).toBe(400)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin POST before any limit is charged", async () => {
    isSameOrigin.mockReturnValue(false)

    const res = await POST(makeRequest(SIGNUP))

    expect(res.status).toBe(403)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
  })
})

describe("POST /api/auth/otp — refusals say what to do", () => {
  it("names the network and the wait when the IP ceiling is spent", async () => {
    answerLimits({ allowed: false, retryAfterSeconds: 1800 }, ALLOWED)

    const res = await POST(makeRequest(SIGNUP))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("1800")
    expect(body.error).toContain("network")
    expect(body.error).toContain("30 minutes")
  })

  it("names the address and the wait when the per-user ceiling is spent", async () => {
    answerLimits(ALLOWED, { allowed: false, retryAfterSeconds: 900 })

    const res = await POST(makeRequest(SIGNUP))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("900")
    expect(body.error).toContain(SIGNUP.email)
    expect(body.error).toContain("15 minutes")
  })

  it("turns GoTrue's per-address window into a 429 with the wait", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        message: "For security purposes, you can only request this once every 60 seconds",
      })
    )

    const res = await POST(makeRequest(SIGNUP))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
    expect(body.error).not.toContain("For security purposes")
    expect(body.error).toContain("about a minute")
  })

  it("turns a provider email-rate-limit refusal into a 429 too", async () => {
    createClient.mockResolvedValue(fakeSupabase({ message: "Email rate limit exceeded" }))

    const res = await POST(makeRequest(SIGNUP))

    expect(res.status).toBe(429)
  })

  it("keeps a non-rate-limit provider message as a 400", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ message: "Signups not allowed for this instance" })
    )

    const res = await POST(makeRequest(SIGNUP))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe("Signups not allowed for this instance")
  })
})
