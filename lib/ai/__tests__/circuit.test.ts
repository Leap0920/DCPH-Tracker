import { describe, expect, it } from "vitest"
import {
  initialTargetState,
  isAvailable,
  recordFailure,
  recordSuccess,
} from "@/lib/ai/circuit"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

describe("isAvailable", () => {
  it("is available with no prior state", () => {
    expect(isAvailable(initialTargetState("groq:x"), NOW)).toBe(true)
  })

  it("is unavailable while the circuit is open, available once it closes", () => {
    const state = { ...initialTargetState("groq:x"), openUntil: NOW + 30_000 }
    expect(isAvailable(state, NOW)).toBe(false)
    expect(isAvailable(state, NOW + 30_001)).toBe(true)
  })
})

describe("recordFailure", () => {
  it("counts consecutive failures and opens the circuit", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0
    )
    expect(state.consecutiveFailures).toBe(1)
    expect(state.openUntil).toBe(NOW + 1_000)
    expect(state.lastFailureKind).toBe("server_error")
  })

  it("grows the cooldown exponentially as failures accumulate", () => {
    let state = initialTargetState("groq:x")
    const delays: number[] = []
    for (let i = 0; i < 4; i++) {
      state = recordFailure(
        state,
        { kind: "server_error", cooldownMs: 1_000, retryNext: true },
        NOW,
        () => 0
      )
      delays.push((state.openUntil ?? NOW) - NOW)
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it("caps the exponential growth", () => {
    let state = initialTargetState("groq:x")
    for (let i = 0; i < 20; i++) {
      state = recordFailure(
        state,
        { kind: "server_error", cooldownMs: 1_000, retryNext: true },
        NOW,
        () => 0
      )
    }
    expect((state.openUntil ?? NOW) - NOW).toBe(15 * 60 * 1000)
  })

  it("does not grow the cooldown for a misconfiguration", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "misconfigured", cooldownMs: 86_400_000, retryNext: true },
      NOW,
      () => 0
    )
    expect((state.openUntil ?? NOW) - NOW).toBe(86_400_000)
  })

  it("applies jitter deterministically from the injected random source", () => {
    const noJitter = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0
    )
    const fullJitter = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0.99
    )
    expect((noJitter.openUntil ?? NOW) - NOW).toBe(1_000)
    expect((fullJitter.openUntil ?? NOW) - NOW).toBeGreaterThan(1_000)
    expect((fullJitter.openUntil ?? NOW) - NOW).toBeLessThanOrEqual(1_500)
  })

  it("leaves the circuit closed when the cooldown is zero", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "empty_output", cooldownMs: 0, retryNext: true },
      NOW,
      () => 0
    )
    expect(state.openUntil).toBeNull()
    expect(isAvailable(state, NOW)).toBe(true)
  })
})

describe("recordSuccess", () => {
  it("clears failures and closes the circuit", () => {
    const failed = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 60_000, retryNext: true },
      NOW,
      () => 0
    )
    const state = recordSuccess(failed, NOW)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.openUntil).toBeNull()
    expect(state.successCount).toBe(1)
    expect(state.lastUsedAt).toBe(NOW)
  })
})
