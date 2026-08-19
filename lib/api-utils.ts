import { NextResponse } from "next/server"

/**
 * Shared API response helpers.
 *
 * Guarantees that NO internal detail (Supabase/Postgres error messages,
 * stack traces, object shapes) leaks to API clients. All server-side error
 * context is logged server-side only.
 */

const NO_STORE = { "Cache-Control": "private, no-store" }

/** Successful JSON response: { success: true, data }. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json(
    { success: true, data },
    { ...init, headers: { ...NO_STORE, ...(init?.headers ?? {}) } }
  )
}

/** Error JSON response with a deliberately generic message. */
export function fail(status: number, message: string): Response {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
}

/** 429 with a Retry-After hint. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) },
    }
  )
}

/**
 * 500 handler: logs the real error server-side, returns a generic message.
 * Never echoes error.message (may contain Supabase/Postgres internals or PII).
 */
export function handleApiError(err: unknown, context: string): Response {
  console.error(`[api][${context}]`, err)
  return fail(500, "Internal server error")
}

/* ------------------------------------------------------------------ *
 * Profile field allowlists (fail-closed)
 *
 * ALLOWLIST, not denylist: a column added to `profiles` by a future
 * migration is invisible to API consumers until it is deliberately added
 * here. The old denylist auto-exposed every new column.
 * ------------------------------------------------------------------ */

/**
 * Fields safe to expose for ANY profile to ANY authenticated caller.
 * user_id is included deliberately: it's a random UUID needed for joins
 * and carries no personal information.
 */
export const PUBLIC_PROFILE_FIELDS = [
  "user_id",
  "username",
  "display_name",
  "avatar_url",
] as const

/** Additional fields a user may see on their OWN profile. */
export const SELF_PROFILE_FIELDS = [
  ...PUBLIC_PROFILE_FIELDS,
  "email",
  "bio",
  "birthday",
  "role",
  "status",
  "created_at",
  "updated_at",
] as const

/** Fields only an admin moderation view may see. */
export const ADMIN_PROFILE_FIELDS = [
  ...SELF_PROFILE_FIELDS,
  "ban_reason",
  "banned_at",
  "suspended_until",
] as const

/**
 * Single source of truth for the `select()` string, derived from the
 * allowlist so the query and the sanitizer cannot drift apart.
 */
export const PUBLIC_PROFILE_COLUMNS = PUBLIC_PROFILE_FIELDS.join(", ")
export const SELF_PROFILE_COLUMNS = SELF_PROFILE_FIELDS.join(", ")

function pick(
  row: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in row) out[field] = row[field]
  }
  return out
}

/** Public view of a profile. Anything not explicitly allowlisted is dropped. */
export function sanitizeProfile(
  profile: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!profile || typeof profile !== "object") return null
  return pick(profile, PUBLIC_PROFILE_FIELDS)
}

/** Self view — only ever return this when caller id === profile user_id. */
export function sanitizeOwnProfile(
  profile: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!profile || typeof profile !== "object") return null
  return pick(profile, SELF_PROFILE_FIELDS)
}

/** Admin moderation view — gate behind a verified admin role check. */
export function sanitizeProfileForAdmin(
  profile: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!profile || typeof profile !== "object") return null
  return pick(profile, ADMIN_PROFILE_FIELDS)
}

export function sanitizeProfiles(
  profiles: Record<string, unknown>[] | null | undefined
): Record<string, unknown>[] {
  if (!Array.isArray(profiles)) return []
  return profiles
    .map(sanitizeProfile)
    .filter((p): p is Record<string, unknown> => p !== null)
}