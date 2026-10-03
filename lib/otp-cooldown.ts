/**
 * Client-side send/resend gating for the signup OTP flow.
 *
 * Lives outside the component so the numbers can be checked without a DOM —
 * this repo has no jsdom/component-test setup, and a cooldown that only exists
 * inside a React component is a cooldown nothing can test.
 *
 * Why it exists at all: GoTrue refuses a second code for the same address
 * inside 60 seconds, and the server's own per-network ceiling refuses the
 * shared address entirely once it is spent. Both refusals arrive as a 429 with
 * a Retry-After; without a client-side floor the user's next tap is guaranteed
 * to be refused again, which is how a single household turns into a retry
 * storm against the limiter.
 */

/** GoTrue's per-address window, and the floor for any 429 without a hint. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** Cap the countdown, even when the server asks for longer. */
export const OTP_RESEND_COOLDOWN_MAX_SECONDS = 300

/**
 * Retry-After (seconds, as a header string) turned into a countdown, clamped
 * to [1, max]. Anything missing, unparseable or non-positive falls back to
 * `fallback`, so a malformed header can never disable the buttons for a
 * negative or infinite time.
 */
export function cooldownFromRetryAfter(
  retryAfter: string | null | undefined,
  fallback: number = OTP_RESEND_COOLDOWN_SECONDS,
  max: number = OTP_RESEND_COOLDOWN_MAX_SECONDS
): number {
  const parsed = Number.parseInt(retryAfter ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.max(parsed, 1), max)
}

/** "47s" under a minute, "5m" above it. */
export function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.ceil(seconds / 60)}m`
}

/**
 * Whether the OTP buttons must stay disabled.
 *
 * The send button and the resend link share this rule on purpose: the original
 * bug was the send button honouring only `loading`, so a user refused with 429
 * could immediately tap it again while the resend link was counting down.
 */
export function otpSendBlocked(state: {
  loading: boolean
  cooldownSeconds: number
}): boolean {
  return state.loading || state.cooldownSeconds > 0
}
