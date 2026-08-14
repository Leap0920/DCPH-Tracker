import type { NextRequest } from "next/server"

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

interface Bucket {
  count: number
  windowStart: number
}

/**
 * Zero-dependency in-memory sliding-window rate limiter.
 *
 * Each route+client key gets a fixed-window bucket: once `limit` requests
 * are used inside `windowMs`, further requests are denied until the window
 * rolls over. Keys are derived from the client IP so attackers can't rotate
 * users to bypass the limit.
 *
 * NOTE: buckets live in server memory only — acceptable for a single
 * instance. Move to Upstash/Redis if the app scales to multiple regions.
 */
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

export function rateLimit(
  key: string,
  opts: { limit?: number; windowMs?: number } = {}
): RateLimitResult {
  const limit = opts.limit ?? 10
  const windowMs = opts.windowMs ?? 5 * 60 * 1000
  const now = Date.now()

  // Opportunistic cleanup: drop expired buckets once the map grows large,
  // so a distributed brute-force can't exhaust server memory.
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart > windowMs) buckets.delete(k)
    }
  }

  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count > limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + windowMs - now) / 1000)
    )
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Derives a stable rate-limit key from a request: route + client IP.
 * Uses the first entry of x-forwarded-for (set by Vercel/Next when behind
 * a proxy), falling back to x-real-ip, then "unknown".
 */
export function authRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : request.headers.get("x-real-ip") ?? "unknown"
  return `${request.nextUrl.pathname}:${ip}`
}