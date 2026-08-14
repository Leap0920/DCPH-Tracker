import { NextResponse } from "next/server"

/**
 * Shared API response helpers.
 *
 * Purpose: guarantee that NO internal detail (Supabase/Postgres error
 * messages, stack traces, object shapes) ever leaks to API clients.
 * All server-side error context is logged server-side only.
 */

/** Successful JSON response: { success: true, data }. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json({ success: true, data }, init)
}

/** Error JSON response with a deliberately generic message. */
export function fail(status: number, message: string): Response {
  return NextResponse.json({ error: message }, { status })
}

/**
 * 500 handler: logs the real error server-side and returns a generic
 * message. Never echoes `error.message` (may contain Supabase/Postgres
 * internals or PII).
 */
export function handleApiError(err: unknown, context: string): Response {
  console.error(`[api][${context}]`, err)
  return fail(500, "Internal server error")
}

/**
 * Canonical safe column list for profile rows that leave the server.
 * user_id is a random UUID and is needed for joins; it is NOT exposed in
 * public API payloads (see stripProfilePii).
 */
export const PUBLIC_PROFILE_COLUMNS =
  "user_id, username, display_name, avatar_url" as const

/** PII / sensitive keys that must never appear in an API response. */
const HIDDEN_PROFILE_KEYS = new Set([
  "email",
  "birthday",
  "bio",
  "status",
  "ban_reason",
  "banned_at",
  "suspended_until",
  "created_at",
  "updated_at",
])

/**
 * Returns a new object containing only safe profile fields. Any key not
 * in the denylist is kept (e.g. username, display_name, avatar_url, role
 * when the caller legitimately needs it). Mutates nothing.
 */
export function sanitizeProfile<T extends Record<string, unknown>>(
  profile: T
): Record<string, unknown> {
  if (!profile || typeof profile !== "object") return profile
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(profile)) {
    if (!HIDDEN_PROFILE_KEYS.has(key)) out[key] = value
  }
  return out
}