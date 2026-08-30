import "server-only"
import type { NextRequest } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { fail, tooManyRequests } from "@/lib/api-utils"
import { isSameOrigin } from "@/lib/origin-check"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { logger } from "@/lib/logger"

/**
 * Shared plumbing for the two destructive account endpoints:
 *   POST /api/account/reset-progress
 *   POST /api/account/delete
 *
 * Both need the same six-step gate and both need to reach tables that are
 * deliberately unreachable from the browser. Keeping it here means the two
 * routes cannot drift apart on ordering, and neither route has to re-derive
 * the defence-in-depth ladder.
 */

/** Pre-auth, per-instance burst cap. Cheap: header compare + a Map lookup. */
const BURST = { limit: 10, windowMs: 60_000 } as const

export type AccountMutationActor = {
  /** The signed-in user, resolved from the session cookie. Never from the body. */
  user: User
  /** Session-scoped client. Respects RLS — the default choice for user data. */
  supabase: SupabaseClient<Database>
  /** Service-role client, or null when SUPABASE_SERVICE_ROLE_KEY is unset. */
  admin: SupabaseClient<Database> | null
}

export type AccountMutationResult =
  | { allowed: false; response: Response }
  | ({ allowed: true } & AccountMutationActor)

/**
 * Runs the shared defence ladder for an account mutation and returns either a
 * ready-to-return `Response` denial or the resolved actor.
 *
 * Ordering is deliberate, cheapest gate first:
 *   1. same-origin      — header compare, free
 *   2. in-memory burst  — no DB round-trip, absorbs floods before any I/O
 *   3. session auth     — 401 before a persistent counter is written
 *   4. persistent quota — keyed by USER id, not IP (NAT sharing is common here)
 *
 * The per-user quota is intentionally tight and slow to refill: these endpoints
 * destroy data, and a user only ever needs one successful call.
 */
export async function authorizeAccountMutation(
  request: NextRequest,
  opts: { scope: string; limit: number; windowMs: number }
): Promise<AccountMutationResult> {
  if (!isSameOrigin(request)) {
    return { allowed: false, response: fail(403, "Forbidden") }
  }

  const burst = rateLimit(
    `account:${opts.scope}:burst:${authRateLimitKey(request)}`,
    BURST
  )
  if (!burst.allowed) {
    return { allowed: false, response: tooManyRequests(burst.retryAfterSeconds) }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { allowed: false, response: fail(401, "Unauthorized") }
  }

  // failClosed: false — a limiter outage must not brick a user's ability to
  // delete their own account. The in-memory burst above still applies.
  const rl = await rateLimitPersistent(
    `account:${opts.scope}:user:${user.id}`,
    { limit: opts.limit, windowMs: opts.windowMs, failClosed: false }
  )
  if (!rl.allowed) {
    return { allowed: false, response: tooManyRequests(rl.retryAfterSeconds) }
  }

  return { allowed: true, user, supabase, admin: createAdminClient() }
}

/** Reads the confirmation phrase out of a JSON body. Never throws. */
export async function readConfirmPhrase(
  request: NextRequest
): Promise<string> {
  try {
    const body = (await request.json()) as { confirm?: unknown } | null
    return typeof body?.confirm === "string" ? body.confirm : ""
  } catch {
    return ""
  }
}

/**
 * Tables holding per-user rows that are swept after the auth user is deleted.
 *
 * Every one of these already declares `references auth.users(id) on delete
 * cascade`, so the sweep is a safety net for a future table that forgets the
 * clause — not the primary mechanism. Order is irrelevant; Postgres cascades
 * them all in one transaction.
 */
export const ACCOUNT_SWEEP_TABLES = [
  "watch_events",
  "watch_status",
  "episode_comments",
  "chat_messages",
  "user_badges",
  "notifications",
  "active_sessions",
  "profiles",
] as const

type DeletedRow = { id: string }
type PostgrestErrorLike = { code?: string; message?: string }

/**
 * Minimal structural view of the admin client for `DELETE ... RETURNING id`.
 *
 * Declared locally (same trick as lib/rate-limit-db.ts) because several of
 * these tables — watch_events, active_sessions — are missing from the
 * generated `Database` types until `supabase gen types` is re-run, and a cast
 * here is cheaper than hand-maintaining a types file.
 */
type UntypedDeleteClient = {
  from(table: string): {
    delete(): {
      eq(column: string, value: string): {
        select(columns: string): Promise<{
          data: DeletedRow[] | null
          error: PostgrestErrorLike | null
        }>
      }
    }
  }
}

/**
 * True when a PostgREST/Postgres error means "this table does not exist" — i.e.
 * an optional migration has not been applied yet. Callers treat those as zero
 * deleted rows rather than a failure, so one unapplied migration cannot brick
 * account deletion.
 */
export function isMissingRelationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const e = error as PostgrestErrorLike
  if (e.code === "42P01" || e.code === "PGRST205") return true
  return /does not exist|could not find the table/i.test(e.message ?? "")
}

/**
 * Deletes every row in `table` whose user_id = userId and returns how many went.
 *
 * MUST be called with the service-role client. Two of the sweep targets
 * (watch_events) revoke DELETE from `authenticated` outright, so an RLS policy
 * alone is not enough — this is the only path that can clear them.
 *
 * Throws on genuine failures; returns 0 for a missing table.
 */
export async function deleteRowsForUser(
  admin: SupabaseClient<Database>,
  table: string,
  userId: string
): Promise<number> {
  const client = admin as unknown as UntypedDeleteClient
  const { data, error } = await client
    .from(table)
    .delete()
    .eq("user_id", userId)
    .select("id")

  if (error) {
    if (isMissingRelationError(error)) {
      logger.warn("account_data.missing_table_skipped", { table })
      return 0
    }
    throw error
  }

  return data?.length ?? 0
}

/**
 * Removes the user's avatar objects from the `avatars` bucket.
 *
 * Storage is NOT cascade-deleted with the auth user, so this has to run
 * explicitly — and it has to run BEFORE the auth delete, because a remaining
 * row in storage.objects owned by the user can make GoTrue's delete fail on a
 * foreign-key violation.
 *
 * Best-effort by design: an orphaned JPEG is an annoyance, not a reason to
 * refuse an account deletion.
 */
export async function removeAvatarFolder(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const bucket = admin.storage.from("avatars")
  const { data: files, error: listError } = await bucket.list(userId, {
    limit: 100,
  })

  if (listError) {
    logger.warn("account_data.avatar_list_failed", {
      error: listError.message,
    })
    return 0
  }

  // `list` also returns folder placeholders; those have no name to build a
  // path from, and removing them would 404 the batch.
  const paths = (files ?? [])
    .map((file) => file.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => `${userId}/${name}`)

  if (paths.length === 0) return 0

  const { error } = await bucket.remove(paths)
  if (error) {
    logger.warn("account_data.avatar_remove_failed", { error: error.message })
    return 0
  }

  return paths.length
}
