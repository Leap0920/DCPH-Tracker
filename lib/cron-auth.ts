// lib/cron-auth.ts
//
// The one place a `CRON_SECRET` is compared. Every route a Vercel cron calls
// goes through here: Vercel injects `Authorization: Bearer $CRON_SECRET` when
// that env var is set, so a cron route authenticates with this helper rather
// than growing a private copy of the comparison that can drift (Task 5 moved
// the original out of app/api/sync/route.ts byte for byte; that route's
// behaviour is the regression proof the move changed nothing).
import crypto from "crypto"

/**
 * Constant-time comparison of `Authorization: Bearer <secret>` against the
 * configured CRON_SECRET. Never accepts the secret via query string — that
 * would leak it into Vercel/access logs.
 */
export function headerMatchesSecret(
  authorization: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authorization) return false
  // Compare fixed-width digests so the secret's length never leaks.
  const a = crypto.createHash("sha256").update(authorization).digest()
  const b = crypto.createHash("sha256").update(`Bearer ${secret}`).digest()
  return crypto.timingSafeEqual(a, b)
}

/**
 * The cron secret, read at request time rather than at module load so a
 * rotation takes effect without a redeploy. `undefined` when unset, which
 * `headerMatchesSecret` treats as "no secret is configured" and answers false
 * for — an unset secret must never mean "everything matches".
 */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET
}
