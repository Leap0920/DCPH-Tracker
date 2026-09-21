import type { FailureDecision, FailureKind } from "@/lib/ai/failure"

export interface TargetState {
  targetId: string
  consecutiveFailures: number
  /** Epoch ms until which this target must be skipped. Null = closed. */
  openUntil: number | null
  lastFailureKind: FailureKind | null
  lastStatus: number | null
  lastError: string | null
  lastUsedAt: number | null
  successCount: number
  failureCount: number
}

const MAX_COOLDOWN_MS = 15 * 60 * 1000
const JITTER_RATIO = 0.5

/** Repeated transient failures back off exponentially; a misconfiguration
 * keeps its own (much longer, fixed) cooldown rather than doubling. */
const NON_GROWING_KINDS: ReadonlySet<FailureKind> = new Set(["misconfigured", "empty_output"])

export function initialTargetState(targetId: string): TargetState {
  return {
    targetId,
    consecutiveFailures: 0,
    openUntil: null,
    lastFailureKind: null,
    lastStatus: null,
    lastError: null,
    lastUsedAt: null,
    successCount: 0,
    failureCount: 0,
  }
}

export function isAvailable(state: TargetState, now: number): boolean {
  return state.openUntil === null || state.openUntil <= now
}

/**
 * Backoff with jitter.
 *
 * `random` is injected so tests can pin the value — an exponential backoff that
 * cannot be asserted deterministically tends to go untested, and an untested
 * backoff is how a provider fleet ends up hammering an API in lockstep.
 */
export function backoffMs(
  baseMs: number,
  consecutiveFailures: number,
  random: () => number = Math.random
): number {
  const exponent = Math.max(0, consecutiveFailures - 1)
  const raw = Math.min(baseMs * 2 ** exponent, MAX_COOLDOWN_MS)
  return Math.min(Math.round(raw * (1 + JITTER_RATIO * random())), MAX_COOLDOWN_MS)
}

export interface FailureRecordInput {
  kind: FailureKind
  status?: number | null
  error?: string | null
}

export function recordFailure(
  state: TargetState,
  decision: FailureDecision,
  now: number,
  random: () => number = Math.random,
  detail: FailureRecordInput = { kind: decision.kind }
): TargetState {
  const consecutiveFailures = state.consecutiveFailures + 1

  const cooldown = NON_GROWING_KINDS.has(decision.kind)
    ? decision.cooldownMs
    : backoffMs(decision.cooldownMs, consecutiveFailures, random)

  return {
    ...state,
    consecutiveFailures,
    openUntil: cooldown > 0 ? now + cooldown : null,
    lastFailureKind: decision.kind,
    lastStatus: detail.status ?? null,
    lastError: detail.error?.slice(0, 300) ?? null,
    lastUsedAt: now,
    failureCount: state.failureCount + 1,
  }
}

export function recordSuccess(state: TargetState, now: number): TargetState {
  return {
    ...state,
    consecutiveFailures: 0,
    openUntil: null,
    lastUsedAt: now,
    successCount: state.successCount + 1,
  }
}
