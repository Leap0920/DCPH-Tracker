export type FailureKind =
  /** Bad credential or model name. Not transient — stop trying it for a long time. */
  | "misconfigured"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  /** HTTP 200, but the model produced nothing usable. */
  | "empty_output"

export interface FailureDecision {
  kind: FailureKind
  /** How long to keep this target out of rotation. 0 means do not cool it down. */
  cooldownMs: number
  /** Whether trying the next target immediately is worthwhile. */
  retryNext: boolean
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A Retry-After longer than this is treated as a misreported value. */
const MAX_RETRY_AFTER_MS = HOUR_MS
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000

export interface FailureInput {
  /** HTTP status, when a response was received at all. */
  status?: number
  retryAfterSeconds?: number | null
  /** The thrown value, for cases where no response arrived. */
  error?: unknown
  /** From the SSE stream, when the request otherwise succeeded. */
  finishReason?: string | null
  /** Characters of usable content the attempt produced. */
  textChars?: number
}

function parseRetryAfter(seconds: number | null | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_RATE_LIMIT_COOLDOWN_MS
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

export function classifyFailure(input: FailureInput): FailureDecision {
  const { status, error, finishReason, textChars } = input

  // Checked before the status branches: the transport succeeded, so the status
  // is 200 and would otherwise be read as a success.
  if (status === 200 && finishReason === "length" && (textChars ?? 0) === 0) {
    return { kind: "empty_output", cooldownMs: 0, retryNext: true }
  }

  if (typeof status === "number") {
    if (status === 429) {
      return {
        kind: "rate_limited",
        cooldownMs: parseRetryAfter(input.retryAfterSeconds),
        retryNext: true,
      }
    }
    if (status === 408 || status === 504) {
      return { kind: "timeout", cooldownMs: 30_000, retryNext: true }
    }
    if (status >= 500) {
      return { kind: "server_error", cooldownMs: 30_000, retryNext: true }
    }
    if (status >= 400) {
      return { kind: "misconfigured", cooldownMs: DAY_MS, retryNext: true }
    }
    return { kind: "server_error", cooldownMs: 30_000, retryNext: true }
  }

  const name = (error as { name?: string } | undefined)?.name
  if (name === "AbortError" || name === "TimeoutError") {
    return { kind: "timeout", cooldownMs: 30_000, retryNext: true }
  }

  return { kind: "network", cooldownMs: 30_000, retryNext: true }
}
