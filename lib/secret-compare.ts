import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Constant-time comparison for shared secrets presented to route handlers
 * (the cron `Authorization: Bearer` header, the admin `x-admin-secret`).
 *
 * `provided === expected` leaks the secret's length and, byte by byte, how
 * much of a guess is correct — measurable over enough requests. Both sides
 * are hashed to a fixed-width digest first, so the comparison is constant
 * time *and* the length is not observable.
 *
 * Fails closed: a missing value on either side is never a match.
 */
export function secretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false

  const a = createHash("sha256").update(provided).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}
