import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"
import { rateLimit as rateLimitLocal, type RateLimitResult } from "./rate-limit"

/**
 * Shape of one row returned by public.rate_limit_hit.
 *
 * Mirrors the migration's RETURNS clause exactly:
 *   returns table (allowed boolean, retry_after_seconds integer)
 */
type RateLimitHitRow = {
  allowed: boolean
  retry_after_seconds: number
}

/** PostgrestError-compatible error shape (structural, no runtime import). */
type RateLimitRpcError = {
  message: string
  details?: string | null
  hint?: string | null
  code?: string
}

/**
 * Minimal structural view of the admin client, covering only the one RPC this
 * module calls. Declared locally so the module compiles whether or not
 * rate_limit_hit is present in the generated Supabase `Database` types
 * (generated types omit it until `supabase gen types` is re-run).
 */
type RateLimitRpcClient = {
  rpc(
    fn: "rate_limit_hit",
    args: { p_key: string; p_limit: number; p_window_seconds: number }
  ): Promise<{
    data: RateLimitHitRow[] | RateLimitHitRow | null
    error: RateLimitRpcError | null
  }>
}

/**
 * Cross-instance rate limit, backed by Postgres.
 *
 * Layered on purpose:
 *  1. Local in-memory check first — an already-exhausted bucket is denied
 *     with zero DB cost, absorbing the cheap bulk of an attack.
 *  2. Postgres RPC for the authoritative, cross-instance count.
 *
 * failClosed: use `true` for auth and other abuse-sensitive endpoints, where
 * denying during an outage is preferable to letting a brute force through.
 * Default is fail-open (availability) with a local-only fallback.
 */
export async function rateLimitPersistent(
  key: string,
  opts: { limit?: number; windowMs?: number; failClosed?: boolean } = {}
): Promise<RateLimitResult> {
  const limit = opts.limit ?? 10
  const windowMs = opts.windowMs ?? 5 * 60 * 1000

  const local = rateLimitLocal(key, { limit, windowMs })
  if (!local.allowed) return local

  const admin = createAdminClient()
  if (!admin) {
    if (opts.failClosed) {
      console.error("[rate-limit] no service-role key; failing closed")
      return { allowed: false, retryAfterSeconds: 60 }
    }
    return local
  }

  try {
    const rpcClient = admin as unknown as RateLimitRpcClient

    const { data, error } = await rpcClient.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.ceil(windowMs / 1000),
    })

    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) {
      throw error ?? new Error("rate_limit_hit returned no row")
    }

    return {
      allowed: Boolean(row.allowed),
      retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
    }
  } catch (err) {
    console.error("[rate-limit] persistent store unavailable", err)
    return opts.failClosed
      ? { allowed: false, retryAfterSeconds: 30 }
      : local
  }
}
