import { afterEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import {
  authRateLimitKey,
  clientIp,
  identifierRateLimitKey,
  rateLimit,
} from "@/lib/rate-limit"

/**
 * rate-limit.ts only reads `request.headers` and `request.nextUrl.pathname`,
 * and imports NextRequest as a TYPE only. A minimal stand-in keeps this suite
 * free of any runtime dependency on next/server.
 */
function makeRequest(
  headers: Record<string, string> = {},
  pathname = "/api/test"
): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: { pathname },
  } as unknown as NextRequest
}

describe("rateLimit — fixed window counting", () => {
  it("allows exactly `limit` calls, then denies", () => {
    const key = "rl-basic-limit-3"

    expect(rateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true)
    expect(rateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true)
    expect(rateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true)

    const denied = rateLimit(key, { limit: 3, windowMs: 60_000 })
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it("returns retryAfterSeconds 0 while allowed", () => {
    expect(rateLimit("rl-allowed-shape", { limit: 2, windowMs: 60_000 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it("stays denied for every call after the limit is exceeded", () => {
    const key = "rl-stays-denied"
    rateLimit(key, { limit: 1, windowMs: 60_000 })

    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit(key, { limit: 1, windowMs: 60_000 }).allowed).toBe(false)
    }
  })

  it("defaults to limit 10 / window 5 minutes", () => {
    const key = "rl-defaults"

    for (let i = 0; i < 10; i += 1) {
      expect(rateLimit(key).allowed).toBe(true)
    }

    const denied = rateLimit(key)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(300)
  })

  it("keeps buckets independent per key", () => {
    const a = "rl-independent-a"
    const b = "rl-independent-b"

    expect(rateLimit(a, { limit: 1, windowMs: 60_000 }).allowed).toBe(true)
    expect(rateLimit(a, { limit: 1, windowMs: 60_000 }).allowed).toBe(false)

    // b is untouched by a's exhaustion.
    expect(rateLimit(b, { limit: 1, windowMs: 60_000 }).allowed).toBe(true)
  })
})

describe("rateLimit — window expiry", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts a fresh window once windowMs has elapsed", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))

    const key = "rl-window-expiry"
    const opts = { limit: 1, windowMs: 1000 }

    expect(rateLimit(key, opts).allowed).toBe(true)
    expect(rateLimit(key, opts).allowed).toBe(false)

    // Implementation uses `now - windowStart > windowMs`, so step past it.
    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"))

    expect(rateLimit(key, opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it("reports a retryAfterSeconds that shrinks as the window drains", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))

    const key = "rl-retry-after-math"
    const opts = { limit: 1, windowMs: 10_000 }

    rateLimit(key, opts)
    expect(rateLimit(key, opts).retryAfterSeconds).toBe(10)

    vi.setSystemTime(new Date("2026-01-01T00:00:09.500Z"))
    expect(rateLimit(key, opts).retryAfterSeconds).toBe(1)
  })
})

describe("clientIp — header precedence", () => {
  it("prefers x-vercel-forwarded-for over spoofable headers", () => {
    const request = makeRequest({
      "x-vercel-forwarded-for": "203.0.113.1",
      "x-real-ip": "198.51.100.9",
      "x-forwarded-for": "1.2.3.4",
    })
    expect(clientIp(request)).toBe("203.0.113.1")
  })

  it("falls back to x-real-ip when the Vercel header is absent", () => {
    const request = makeRequest({
      "x-real-ip": "198.51.100.9",
      "x-forwarded-for": "1.2.3.4",
    })
    expect(clientIp(request)).toBe("198.51.100.9")
  })

  it("falls back to x-forwarded-for last", () => {
    expect(clientIp(makeRequest({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4")
  })

  it("returns \"unknown\" when no IP header is present", () => {
    expect(clientIp(makeRequest())).toBe("unknown")
  })

  it("takes the first entry of a comma-separated chain", () => {
    expect(
      clientIp(makeRequest({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }))
    ).toBe("203.0.113.7")

    expect(
      clientIp(makeRequest({ "x-vercel-forwarded-for": "203.0.113.7,70.41.3.18" }))
    ).toBe("203.0.113.7")
  })

  it("trims surrounding whitespace", () => {
    expect(clientIp(makeRequest({ "x-real-ip": "  198.51.100.9  " }))).toBe("198.51.100.9")
    expect(clientIp(makeRequest({ "x-forwarded-for": "  1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4")
  })
})

describe("authRateLimitKey", () => {
  it("combines route pathname and client IP", () => {
    const request = makeRequest({ "x-real-ip": "198.51.100.9" }, "/api/auth/login")
    expect(authRateLimitKey(request)).toBe("/api/auth/login:ip:198.51.100.9")
  })

  it("uses \"unknown\" when the IP cannot be determined", () => {
    expect(authRateLimitKey(makeRequest({}, "/api/auth/login"))).toBe(
      "/api/auth/login:ip:unknown"
    )
  })

  it("produces different keys for different routes with the same IP", () => {
    const headers = { "x-real-ip": "198.51.100.9" }
    expect(authRateLimitKey(makeRequest(headers, "/api/auth/login"))).not.toBe(
      authRateLimitKey(makeRequest(headers, "/api/auth/signup"))
    )
  })
})

describe("identifierRateLimitKey", () => {
  it("includes the route and the identifier", () => {
    const request = makeRequest({}, "/api/auth/login")
    expect(identifierRateLimitKey(request, "user@example.com")).toBe(
      "/api/auth/login:id:user@example.com"
    )
  })

  it("trims and lowercases the identifier so casing cannot split the bucket", () => {
    const request = makeRequest({}, "/api/auth/login")
    expect(identifierRateLimitKey(request, "  USER@Example.COM  ")).toBe(
      "/api/auth/login:id:user@example.com"
    )
    expect(identifierRateLimitKey(request, "User@Example.com")).toBe(
      identifierRateLimitKey(request, "user@example.com")
    )
  })

  it("caps the identifier at 200 characters to bound the key space", () => {
    const request = makeRequest({}, "/api/auth/login")
    const key = identifierRateLimitKey(request, "a".repeat(250))

    expect(key).toBe(`/api/auth/login:id:${"a".repeat(200)}`)
    expect(key.length).toBe("/api/auth/login:id:".length + 200)
  })

  it("is namespaced separately from the IP key", () => {
    const request = makeRequest({ "x-real-ip": "198.51.100.9" }, "/api/auth/login")
    expect(identifierRateLimitKey(request, "198.51.100.9")).not.toBe(
      authRateLimitKey(request)
    )
  })
})