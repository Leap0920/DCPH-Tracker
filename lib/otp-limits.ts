/**
 * The OTP route's hourly ceilings, and the guard that keeps a bad override out
 * of them.
 *
 * `rate_limit_hit()` raises on a limit below 1, and the OTP route fails closed —
 * so an unusable limit is not "unlimited", it is every signup on that route
 * turning into a 429. That is the failure this module exists to make
 * impossible: `usableLimit` is the only way a limit may come from the
 * environment, and `usableLimit(parsed, fallback) >= 1` is stated in LAWS.bend
 * and proved in PROOF.bend (the gate is `bend PROOF.bend`).
 */

/**
 * The guard: a value the limiter can actually use, else the default.
 *
 * `Number.isFinite` rejects both NaN (text that is not a number) and Infinity;
 * `> 0` rejects zero and negatives. Every rejected value falls back.
 */
export function usableLimit(parsed: number, fallback: number): number {
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Reads a positive-integer override, falling back to the default on anything
 * unusable — an unset var, an empty string, text, zero, a negative.
 */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  return usableLimit(Number.parseInt(raw, 10), fallback)
}

/** The defaults; the same two literals appear in LAWS.bend. */
export const OTP_IP_HOURLY_LIMIT_DEFAULT = 60
export const OTP_EMAIL_HOURLY_LIMIT_DEFAULT = 10

/**
 * Hourly ceilings, overridable per deployment without a code change
 * (OTP_IP_HOURLY_LIMIT, OTP_EMAIL_HOURLY_LIMIT).
 *
 * The IP ceiling is an abuse cap, NOT a per-user quota, and it is the one that
 * has to be generous. In the Philippines a single public address is routinely
 * shared by a whole household, a boarding house, a computer shop or a mobile
 * carrier's NAT, so an IP-keyed ceiling is really a ceiling on every user
 * behind that address — and it is the only limit here that gets tighter as the
 * user base grows. It was 10/hour, and the live rate_limits table showed three
 * addresses sitting at 9-13 hits inside one hour: real people were being told
 * "Too many requests" while signing up from a network somebody else had partly
 * used. The per-address ceiling below is the actual per-user quota; this one
 * only has to stop a single host from spraying many addresses.
 */
export const OTP_IP_HOURLY_LIMIT = positiveIntEnv(
  "OTP_IP_HOURLY_LIMIT",
  OTP_IP_HOURLY_LIMIT_DEFAULT
)
export const OTP_EMAIL_HOURLY_LIMIT = positiveIntEnv(
  "OTP_EMAIL_HOURLY_LIMIT",
  OTP_EMAIL_HOURLY_LIMIT_DEFAULT
)

/** How long GoTrue makes one address wait between codes for it. */
export const UPSTREAM_RESEND_WINDOW_SECONDS = 60

/** Dev floors: a local run is never blocked by the production numbers. */
export const OTP_IP_DEV_FLOOR = 50
export const OTP_EMAIL_DEV_FLOOR = 30

/**
 * The dev ceiling: the floor is a floor, not a replacement. A configured
 * override above it still wins, and a dev server is never given a smaller
 * ceiling than the deployment it is meant to be testing.
 */
export function devFloor(limit: number, floor: number): number {
  return Math.max(floor, limit)
}

/** Human wait hint for a 429 body: "about a minute" / "about 42 minutes". */
export function waitHint(retryAfterSeconds: number): string {
  const minutes = Math.ceil(Math.max(1, retryAfterSeconds) / 60)
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`
}
