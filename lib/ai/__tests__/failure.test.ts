import { describe, expect, it } from "vitest"
import { classifyFailure } from "@/lib/ai/failure"

describe("classifyFailure", () => {
  it("treats auth and not-found errors as misconfiguration, not transient", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const decision = classifyFailure({ status })
      expect(decision.kind).toBe("misconfigured")
      // A long cooldown is the whole point: a bad model name must not be
      // retried on every subsequent request forever.
      expect(decision.cooldownMs).toBe(24 * 60 * 60 * 1000)
      expect(decision.retryNext).toBe(true)
    }
  })

  it("honours Retry-After on a 429", () => {
    const decision = classifyFailure({ status: 429, retryAfterSeconds: 90 })
    expect(decision.kind).toBe("rate_limited")
    expect(decision.cooldownMs).toBe(90_000)
  })

  it("falls back to 60s on a 429 with no Retry-After", () => {
    expect(classifyFailure({ status: 429 }).cooldownMs).toBe(60_000)
  })

  it("ignores an absurd Retry-After and clamps it", () => {
    expect(classifyFailure({ status: 429, retryAfterSeconds: 999_999 }).cooldownMs).toBe(
      60 * 60 * 1000
    )
  })

  it("classifies server errors and timeouts as transient", () => {
    expect(classifyFailure({ status: 500 }).kind).toBe("server_error")
    expect(classifyFailure({ status: 503 }).kind).toBe("server_error")
    expect(classifyFailure({ status: 504 }).kind).toBe("timeout")
  })

  it("classifies an aborted request as a timeout", () => {
    const error = new Error("aborted")
    error.name = "AbortError"
    expect(classifyFailure({ error }).kind).toBe("timeout")
  })

  it("classifies an unknown thrown value as a network error", () => {
    expect(classifyFailure({ error: new TypeError("fetch failed") }).kind).toBe("network")
    expect(classifyFailure({}).kind).toBe("network")
  })

  it("flags an empty-output finish reason as its own kind", () => {
    const decision = classifyFailure({ status: 200, finishReason: "length", textChars: 0 })
    expect(decision.kind).toBe("empty_output")
    expect(decision.cooldownMs).toBe(0)
  })

  it("does not flag a truncated but non-empty response as empty output", () => {
    expect(classifyFailure({ status: 200, finishReason: "length", textChars: 120 }).kind).toBe(
      "server_error"
    )
  })
})
