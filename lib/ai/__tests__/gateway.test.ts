import { describe, expect, it } from "vitest"
import { createGateway } from "@/lib/ai/gateway"
import { initialTargetState } from "@/lib/ai/circuit"
import type { ProviderHealth } from "@/lib/ai/provider-health"
import type { QuotaTracker } from "@/lib/ai/quota"
import type { ProviderTarget } from "@/lib/ai/targets"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

function target(id: string): ProviderTarget {
  return {
    id,
    provider: "groq",
    model: id.split(":")[1],
    url: "https://example.test/v1/chat/completions",
    apiKey: "k",
    tier: "answer",
    supportsJsonSchema: false,
    emitsReasoningChannel: true,
    maxOutputTokens: 512,
    dailyRequestBudget: 100,
  }
}

function sse(...deltas: string[]): string {
  return deltas
    .map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}\n\n`)
    .join("")
}

function streamingResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { status: init.status ?? 200, headers: init.headers }
  )
}

/**
 * Inert stores for the tests that are about streaming rather than about health
 * or quota.
 *
 * Without them `createGateway` builds the REAL stores, and vitest loads
 * `.env.local`, so those tests would be talking to the live project:
 * `quota.consume` would spend real budget through the `rate_limit_hit` RPC, and
 * `health.load` would query `ai_provider_state`, which this plan deliberately
 * has not applied remotely. A unit test must not spend a real budget, and must
 * not depend on a remote round trip to pass. Tests that need specific store
 * behaviour pass their own fake and override these.
 */
function inertStores(): { health: ProviderHealth; quota: QuotaTracker } {
  return {
    health: {
      async load(ids) {
        return new Map(ids.map((id) => [id, initialTargetState(id)]))
      },
      isAvailable(state, at) {
        return state.openUntil === null || state.openUntil <= at
      },
      async recordFailure() {},
      async recordSuccess() {},
    },
    quota: {
      async consume() {
        return true
      },
    },
  }
}

function createTestGateway(
  deps: Parameters<typeof createGateway>[0] = {}
): ReturnType<typeof createGateway> {
  return createGateway({ ...inertStores(), ...deps })
}

describe("createGateway", () => {
  it("streams from the first healthy target and records success", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => streamingResponse(sse("Hello", " world")),
    })
    const chunks: string[] = []
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => chunks.push(text),
    })
    expect(chunks.join("")).toBe("Hello world")
    expect(result.ok).toBe(true)
    expect(result.targetId).toBe("groq:a")
    expect(result.midStreamFailure).toBe(false)
  })

  it("fails over to the next target on 429 and honours Retry-After", async () => {
    let call = 0
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "45" },
          })
        }
        return streamingResponse(sse("second"))
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "rate_limited" })
  })

  it("reports failure when every target fails, and never throws", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => new Response("nope", { status: 429 }),
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.rateLimited).toBe(true)
    expect(result.textChars).toBe(0)
  })

  it("skips a target whose circuit is open", async () => {
    const fetchImpl = async () => streamingResponse(sse("hi"))
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl,
      health: {
        async load() {
          const map = new Map()
          map.set("groq:a", {
            targetId: "groq:a",
            consecutiveFailures: 3,
            openUntil: NOW + 60_000,
            lastFailureKind: "server_error" as const,
            lastStatus: 500,
            lastError: null,
            lastUsedAt: NOW,
            successCount: 0,
            failureCount: 3,
          })
          map.set("groq:b", {
            targetId: "groq:b",
            consecutiveFailures: 0,
            openUntil: null,
            lastFailureKind: null,
            lastStatus: null,
            lastError: null,
            lastUsedAt: null,
            successCount: 0,
            failureCount: 0,
          })
          return map
        },
        isAvailable(state, at) {
          return state.openUntil === null || state.openUntil <= at
        },
        async recordFailure() {},
        async recordSuccess() {},
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "circuit_open" })
  })

  it("flags a mid-stream failure but keeps the partial answer", async () => {
    const encoder = new TextEncoder()
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            pull(controller) {
              // Erroring a stream discards anything still queued, so the fault
              // must arrive only after the first chunk has been read — which
              // is what a connection dropping mid-answer looks like.
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        ),
    })
    const chunks: string[] = []
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => chunks.push(text),
    })
    expect(chunks.join("")).toBe("The victim was")
    expect(result.midStreamFailure).toBe(true)
    // Partial text exists, so failover would duplicate content; the UI offers
    // regenerate instead. Marking it complete is the bug being fixed.
    expect(result.truncated).toBe(true)
  })

  it("does not count a 200 response with no content as success", async () => {
    let call = 0
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return streamingResponse('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
        }
        return streamingResponse(sse("real answer"))
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "empty_output" })
  })

  it("passes through the reasoning channel separately", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () =>
        streamingResponse(
          'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\ndata: {"choices":[{"delta":{"content":"Answer"}}]}\n\n'
        ),
    })
    const reasoning: string[] = []
    const deltas: string[] = []
    await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      onReasoning: (text) => reasoning.push(text),
    })
    expect(deltas.join("")).toBe("Answer")
    expect(reasoning.join("")).toBe("hmm")
  })

  it("stops cleanly when the client aborts", async () => {
    const controller = new AbortController()
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        controller.abort()
        const error = new Error("aborted")
        error.name = "AbortError"
        throw error
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: controller.signal,
      onDelta: () => {},
    })
    expect(result.aborted).toBe(true)
    expect(result.ok).toBe(false)
  })

  it("skips a target whose daily budget is spent", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => streamingResponse(sse("hi")),
      quota: { async consume() { return false } },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "quota_exhausted" })
  })
})
