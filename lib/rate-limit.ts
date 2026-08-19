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
 * Zero-dependency in-memory FIXED-window rate limiter.
 *
 * SCOPE WARNING: on Vercel this is per-lambda-instance and resets on cold
 * start, so it is a cheap first line of defence only. Anything that must
 * hold across instances (auth, abuse-sensitive writes) must go through
 * rateLimitPersistent() in lib/rate-limit-db.ts.
 *
 * Fixed window, not sliding: up to 2x `limit` is possible across a window
 * boundary. Acceptable for the burst-absorption role this plays.
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

  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart > windowMs) buckets.delete(k)
    }
    // Hard bound: if every bucket is still live, evict oldest-first.
    // Without this the map grows without limit under distributed load.
    if (buckets.size >= MAX_BUCKETS) {
      const excess = buckets.size - Math.floor(MAX_BUCKETS * 0.9)
      const oldest = [...buckets.entries()]
        .sort((a, b) => a[1].windowStart - b[1].windowStart)
        .slice(0, excess)
      for (const [k] of oldest) buckets.delete(k)
    }
  }

  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.windowStart + windowMs - now) / 1000)
      ),
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Client IP, preferring headers the platform sets over ones the client can
 * forge. `x-vercel-forwarded-for` is written by Vercel's edge and cannot be
 * spoofed; plain `x-forwarded-for` is client-supplied on other hosts.
 *
 * NextRequest.ip was removed in Next.js 15, so headers are the only option
 * without pulling in @vercel/functions.
 */
export function clientIp(request: NextRequest): string {
  const vercel = request.headers.get("x-vercel-forwarded-for")
  if (vercel) return vercel.split(",")[0].trim()

  const real = request.headers.get("x-real-ip")
  if (real) return real.trim()

  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()

  return "unknown"
}

/** Route + IP key. */
export function authRateLimitKey(request: NextRequest): string {
  return `${request.nextUrl.pathname}:ip:${clientIp(request)}`
}

/**
 * Route + identifier key (email, username, user id).
 *
 * Check this ALONGSIDE the IP key: IP-only limiting misses credential
 * stuffing spread across many source addresses, and over-blocks users
 * behind shared NAT. The identifier is lowercased and length-capped so a
 * huge input can't bloat the key space.
 */
export function identifierRateLimitKey(
  request: NextRequest,
  identifier: string
): string {
  const normalized = identifier.trim().toLowerCase().slice(0, 200)
  return `${request.nextUrl.pathname}:id:${normalized}`
}