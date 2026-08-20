import type { NextRequest } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { ok, fail, tooManyRequests, handleApiError } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
} from "@/lib/queries/notifications"

/**
 * In-app notification bell API.
 *
 * RLS-safe: every query runs through the logged-in user's server client
 * (own-rows-only policies on `notifications`). The admin/service-role client
 * is deliberately NOT used — notification rows are written by the SECURITY
 * DEFINER triggers in supabase/migration-notifications.sql, never by app code.
 *
 * Defence ordering, in cost order:
 *  1. same-origin check      — header compare, free
 *  2. in-memory IP burst cap — no DB round-trip, guards the *unauthenticated*
 *     surface so a flood can't force a Postgres write per request
 *  3. auth                   — 401 before any persistent counter is touched
 *  4. persistent limit keyed by USER ID, not IP. This endpoint is polled by
 *     the client, so an IP key would over-block shared NAT while a user key
 *     is unreachable by normal polling.
 */

/** Pre-auth, per-instance burst cap. Generous: it only exists to stop floods. */
const BURST = { limit: 240, windowMs: 60_000 } as const

export async function GET(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const burst = rateLimit(`notifications:burst:${authRateLimitKey(request)}`, BURST)
    if (!burst.allowed) {
      return tooManyRequests(burst.retryAfterSeconds)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    const rl = await rateLimitPersistent(`notifications:get:user:${user.id}`, {
      limit: 60,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) {
      return tooManyRequests(rl.retryAfterSeconds)
    }

    const [items, unreadCount] = await Promise.all([
      getNotifications(user.id),
      getUnreadCount(user.id),
    ])

    return ok({ items, unreadCount })
  } catch (error) {
    return handleApiError(error, "notifications")
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return fail(403, "Forbidden")
    }

    const burst = rateLimit(`notifications:burst:${authRateLimitKey(request)}`, BURST)
    if (!burst.allowed) {
      return tooManyRequests(burst.retryAfterSeconds)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    const rl = await rateLimitPersistent(`notifications:post:user:${user.id}`, {
      limit: 20,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) {
      return tooManyRequests(rl.retryAfterSeconds)
    }

    await markAllRead(user.id)

    return ok({ success: true })
  } catch (error) {
    return handleApiError(error, "notifications")
  }
}