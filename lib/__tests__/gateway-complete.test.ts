import { describe, expect, it } from "vitest"
import { createGateway, type ChatMessage, type CompleteArgs } from "@/lib/ai/gateway"
import { initialTargetState, type TargetState } from "@/lib/ai/circuit"
import type { FailureKind } from "@/lib/ai/failure"
import type { ProviderHealth } from "@/lib/ai/provider-health"
import type { QuotaTracker } from "@/lib/ai/quota"
import type { ProviderTarget } from "@/lib/ai/targets"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

function target(id: string, overrides: Partial<ProviderTarget> = {}): ProviderTarget {
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
    ...overrides,
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

/** One OpenAI-shaped non-streaming completion. */
function completion(text: string, finishReason = "stop"): Response {
  return jsonResponse({ choices: [{ message: { content: text }, finish_reason: finishReason }] })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

interface CapturedRequest {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

type Respond = (call: number, request: CapturedRequest) => Response | Promise<Response>

/**
 * Records what the gateway actually put on the wire. `complete` sends no
 * response unless this fake supplies one, so a test that needs a specific
 * provider reply builds it here rather than mocking the gateway itself.
 */
function capturingFetch(respond: Respond): { calls: CapturedRequest[]; fetchImpl: typeof fetch } {
  const calls: CapturedRequest[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const captured: CapturedRequest = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    }
    calls.push(captured)
    return respond(calls.length, captured)
  }
  return { calls, fetchImpl }
}

/** Inert stores for the tests that are about the request, not about health or
 * quota. The reasoning is the one spelled out in
 * `lib/ai/__tests__/gateway.test.ts`: without them `createGateway` builds the
 * real stores, vitest loads `.env.local`, and a unit test ends up spending live
 * budget against a project this plan has not applied remotely. */
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

/**
 * Inert stores plus a record of what reached them, for the tests that assert
 * the circuit and the budget rather than the wire format.
 */
function recordingStores(): {
  health: ProviderHealth
  quota: QuotaTracker
  failures: { targetId: string; kind: FailureKind; cooldownMs: number; status?: number | null }[]
  successes: string[]
  quotaCalls: string[]
} {
  const failures: { targetId: string; kind: FailureKind; cooldownMs: number; status?: number | null }[] = []
  const successes: string[] = []
  const quotaCalls: string[] = []

  return {
    health: {
      async load(ids) {
        return new Map(ids.map((id) => [id, initialTargetState(id)]))
      },
      isAvailable(state, at) {
        return state.openUntil === null || state.openUntil <= at
      },
      async recordFailure(state, decision, status = null) {
        failures.push({ targetId: state.targetId, kind: decision.kind, cooldownMs: decision.cooldownMs, status })
      },
      async recordSuccess(state) {
        successes.push(state.targetId)
      },
    },
    quota: {
      async consume(id) {
        quotaCalls.push(id)
        return true
      },
    },
    failures,
    successes,
    quotaCalls,
  }
}

describe("gateway.complete", () => {
  it("posts a non-streaming request with the target's credential and provider headers", async () => {
    const { calls, fetchImpl } = capturingFetch(() => completion("hi"))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [
        target("openrouter:x", {
          provider: "openrouter",
          headers: { "HTTP-Referer": "https://dcphtracker.app", "X-Title": "DCPH Tracker" },
        }),
      ],
      signal: new AbortController().signal,
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    const [{ url, init, body }] = calls
    expect(url).toBe("https://example.test/v1/chat/completions")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer k")
    expect(headers["HTTP-Referer"]).toBe("https://dcphtracker.app")
    expect(headers["X-Title"]).toBe("DCPH Tracker")
    expect(body.stream).toBe(false)
    expect(body.model).toBe("x")
    expect(body.messages).toEqual([{ role: "user", content: "hi" }])
    // The target's own ceiling is the fallback, exactly as streamChat uses it.
    expect(body.max_tokens).toBe(512)
    expect(body.temperature).toBe(0.1)
  })

  it("sends a JSON schema to a target that advertises constrained decoding", async () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } }
    const { calls, fetchImpl } = capturingFetch(() => completion('{"ok":true}'))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("cerebras:x", { provider: "cerebras", supportsJsonSchema: true })],
      signal: new AbortController().signal,
      responseFormat: { type: "json_schema", schema },
    })

    expect(calls[0].body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", schema, strict: true },
    })
  })

  it("degrades a JSON schema to json_object on a target without constrained decoding", async () => {
    const { calls, fetchImpl } = capturingFetch(() => completion('{"ok":true}'))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      responseFormat: { type: "json_schema", schema: { type: "object" } },
    })

    expect(calls[0].body.response_format).toEqual({ type: "json_object" })
  })

  it("passes json_object through unchanged", async () => {
    const { calls, fetchImpl } = capturingFetch(() => completion('{"ok":true}'))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      responseFormat: { type: "json_object" },
    })

    expect(calls[0].body.response_format).toEqual({ type: "json_object" })
  })

  it("omits response_format when the caller asks for none", async () => {
    const { calls, fetchImpl } = capturingFetch(() => completion("hi"))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    const args: CompleteArgs = {
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
    }

    await gateway.complete(args)
    await gateway.complete({ ...args, responseFormat: null })

    expect(calls).toHaveLength(2)
    expect(calls[0].body).not.toHaveProperty("response_format")
    expect(calls[1].body).not.toHaveProperty("response_format")
  })

  it("reads the text and the provider's finish reason", async () => {
    const stores = recordingStores()
    const { fetchImpl } = capturingFetch(() => completion('{"ok":true}', "length"))
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ ok: true, targetId: "groq:a", text: '{"ok":true}', finishReason: "length" })
    expect(stores.successes).toEqual(["groq:a"])
  })

  it("reports an absent finish reason as unknown, never as stop", async () => {
    // The provider omitted the key entirely, which is what an unknown
    // terminating signal looks like on the wire.
    const { fetchImpl } = capturingFetch(() => jsonResponse({ choices: [{ message: { content: "hi" } }] }))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
    })

    expect(result.finishReason).toBeNull()
  })

  it("does not count a 200 with no content as success", async () => {
    const stores = recordingStores()
    let call = 0
    const { fetchImpl } = capturingFetch(() => {
      call += 1
      return call === 1 ? completion("", "length") : completion("real answer")
    })
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
    })

    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "empty_output" })
    expect(stores.successes).toEqual(["groq:b"])
  })

  it("marks a 429 rate limited, honours Retry-After and carries on", async () => {
    const stores = recordingStores()
    const { calls, fetchImpl } = capturingFetch((call) =>
      call === 1
        ? new Response("slow down", { status: 429, headers: { "Retry-After": "45" } })
        : new Response("still slow", { status: 429 })
    )
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
    })

    expect(calls).toHaveLength(2)
    expect(result).toMatchObject({ ok: false, rateLimited: true, text: "" })
    expect(result.attempts.map((a) => a.outcome)).toEqual(["rate_limited", "rate_limited"])
    // The header reaches the cooldown: 45s, not the 60s default.
    expect(stores.failures[0]).toMatchObject({ targetId: "groq:a", kind: "rate_limited", cooldownMs: 45_000 })
    expect(stores.failures[1]).toMatchObject({ targetId: "groq:b", cooldownMs: 60_000 })
  })

  it("records a 5xx and a connection error against the circuit, and never throws", async () => {
    const stores = recordingStores()
    const { fetchImpl } = capturingFetch((call) => {
      if (call === 1) return new Response("boom", { status: 502 })
      throw new TypeError("fetch failed")
    })
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ ok: false, targetId: null, text: "", finishReason: null, aborted: false })
    expect(result.attempts.map((a) => a.outcome)).toEqual(["server_error", "network"])
    expect(stores.failures.map((f) => f.kind)).toEqual(["server_error", "network"])
  })

  it("gives up on a target that exceeds requestTimeoutMs and moves on", async () => {
    const stores = recordingStores()
    const aborted: boolean[] = []
    const { fetchImpl } = capturingFetch((call, request) => {
      if (call !== 1) return completion("second")
      return new Promise<Response>((_, reject) => {
        const signal = request.init.signal as AbortSignal
        signal.addEventListener("abort", () => {
          aborted.push(true)
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      })
    })
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      requestTimeoutMs: 5,
    })

    expect(aborted).toEqual([true])
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "timeout" })
  })

  it("returns aborted without a request when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const { calls, fetchImpl } = capturingFetch(() => completion("hi"))
    const gateway = createTestGateway({ now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: controller.signal,
    })

    expect(calls).toHaveLength(0)
    expect(result).toMatchObject({ ok: false, aborted: true, targetId: null, text: "" })
    expect(result.attempts).toEqual([])
  })

  it("reports an abort that lands mid-call as an abort, not a provider failure", async () => {
    const stores = recordingStores()
    const controller = new AbortController()
    const { fetchImpl } = capturingFetch(() => {
      controller.abort()
      const error = new Error("aborted")
      error.name = "AbortError"
      throw error
    })
    const gateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: controller.signal,
    })

    expect(result).toMatchObject({ ok: false, aborted: true, text: "" })
    expect(stores.failures).toEqual([])
  })

  it("charges the daily quota once per attempt, exactly as the streaming path does", async () => {
    const stores = recordingStores()
    const streamQuota: string[] = []
    const targets = [target("groq:a"), target("groq:b")]
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }]
    const signal = new AbortController().signal

    const { calls: completeCalls, fetchImpl: completeFetch } = capturingFetch((call, request) => {
      expect(request.body.stream).toBe(false)
      return call === 1 ? new Response("boom", { status: 500 }) : completion("answer")
    })
    const completeGateway = createTestGateway({ ...stores, now: () => NOW, fetchImpl: completeFetch })
    await completeGateway.complete({ messages, targets, signal })

    let streamCall = 0
    const streamGateway = createTestGateway({
      now: () => NOW,
      health: stores.health,
      quota: {
        async consume(id) {
          streamQuota.push(id)
          return true
        },
      },
      fetchImpl: async (_input, init) => {
        expect((JSON.parse(String(init?.body)) as { stream: boolean }).stream).toBe(true)
        streamCall += 1
        return streamCall === 1 ? new Response("boom", { status: 500 }) : streamingResponse(sse("answer"))
      },
    })
    await streamGateway.streamChat({ messages, targets, signal, onDelta: () => {} })

    expect(completeCalls).toHaveLength(2)
    // A failed attempt still spent its budget, and the second target is charged
    // only after the first one failed.
    expect(stores.quotaCalls).toEqual(["groq:a", "groq:b"])
    expect(streamQuota).toEqual(stores.quotaCalls)
  })

  it("skips a target whose circuit is open", async () => {
    const { calls, fetchImpl } = capturingFetch(() => completion("hi"))
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl,
      health: {
        async load() {
          const open: TargetState = { ...initialTargetState("groq:a"), consecutiveFailures: 3, openUntil: NOW + 60_000 }
          return new Map([
            ["groq:a", open],
            ["groq:b", initialTargetState("groq:b")],
          ])
        },
        isAvailable(state, at) {
          return state.openUntil === null || state.openUntil <= at
        },
        async recordFailure() {},
        async recordSuccess() {},
      },
    })
    const result = await gateway.complete({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
    })

    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "circuit_open" })
    expect(calls).toHaveLength(1)
  })
})
