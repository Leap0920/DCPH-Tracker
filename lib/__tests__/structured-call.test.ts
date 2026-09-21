import { describe, expect, it } from "vitest"
import { toStructuredCall } from "@/lib/ai/structured-call"
import type { CompleteArgs, CompleteResult, Gateway } from "@/lib/ai/gateway"
import type { ProviderTarget } from "@/lib/ai/targets"

function target(id: string, supportsJsonSchema: boolean): ProviderTarget {
  return {
    id,
    provider: supportsJsonSchema ? "cerebras" : "groq",
    model: id.split(":")[1],
    url: "https://example.test/v1/chat/completions",
    apiKey: "k",
    tier: "answer",
    supportsJsonSchema,
    emitsReasoningChannel: false,
    maxOutputTokens: 2048,
    dailyRequestBudget: 100,
  }
}

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } }
const MESSAGES = [{ role: "user" as const, content: "extract" }]
const CAPABLE = [target("cerebras:x", true)]
const INCAPABLE = [target("groq:a", false)]

/** Records what the adapter asked the gateway for; never touches a provider. */
function fakeGateway(result: Partial<CompleteResult> = {}): { gateway: Gateway; calls: CompleteArgs[] } {
  const calls: CompleteArgs[] = []
  return {
    calls,
    gateway: {
      async streamChat() {
        throw new Error("streamChat is not part of this adapter")
      },
      async complete(args) {
        calls.push(args)
        return {
          ok: true,
          targetId: "cerebras:x",
          attempts: [],
          text: '{"ok":true}',
          finishReason: "stop",
          rateLimited: false,
          aborted: false,
          ...result,
        }
      },
    },
  }
}

describe("toStructuredCall", () => {
  it("asks for a JSON schema in strict mode when a bound target enforces one", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, { targets: CAPABLE, signal: new AbortController().signal })

    const response = await call({ schema: SCHEMA, mode: "strict", messages: MESSAGES })

    expect(calls[0].responseFormat).toEqual({ type: "json_schema", schema: SCHEMA })
    expect(calls[0].messages).toEqual(MESSAGES)
    expect(calls[0].targets).toBe(CAPABLE)
    expect(response).toEqual({ text: '{"ok":true}', finishReason: "stop" })
  })

  it("degrades strict mode to json_object when no bound target enforces a schema", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, { targets: INCAPABLE, signal: new AbortController().signal })

    await call({ schema: SCHEMA, mode: "strict", messages: MESSAGES })

    expect(calls[0].responseFormat).toEqual({ type: "json_object" })
  })

  it("passes json_object mode through", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, { targets: CAPABLE, signal: new AbortController().signal })

    await call({ schema: null, mode: "json_object", messages: MESSAGES })

    expect(calls[0].responseFormat).toEqual({ type: "json_object" })
  })

  it("raises the output budget for a truncation retry and keeps the original format", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, {
      targets: CAPABLE,
      signal: new AbortController().signal,
      maxOutputTokens: 400,
    })

    await call({ schema: SCHEMA, mode: "strict", messages: MESSAGES })
    await call({ schema: SCHEMA, mode: "retry_truncated", messages: MESSAGES })

    expect(calls[0].maxOutputTokens).toBe(400)
    // The whole point of the retry: the budget the first attempt ran out of.
    expect(calls[1].maxOutputTokens).toBe(600)
    expect(calls[1].responseFormat).toEqual({ type: "json_schema", schema: SCHEMA })
  })

  it("honours a custom truncation factor and never exceeds the registry ceiling", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, {
      targets: CAPABLE,
      signal: new AbortController().signal,
      maxOutputTokens: 2000,
      onTruncationFactor: 2,
    })

    await call({ schema: SCHEMA, mode: "retry_truncated", messages: MESSAGES })

    expect(calls[0].maxOutputTokens).toBe(2048)
  })

  it("keeps json_object for a truncation retry whose original had no schema", async () => {
    const { gateway, calls } = fakeGateway()
    const call = toStructuredCall(gateway, { targets: CAPABLE, signal: new AbortController().signal })

    await call({ schema: null, mode: "retry_truncated", messages: MESSAGES })

    expect(calls[0].responseFormat).toEqual({ type: "json_object" })
  })

  it("reports a failed call as empty so the repair ladder handles it, without retrying", async () => {
    const { gateway, calls } = fakeGateway({ ok: false, text: "not json at all", finishReason: null })
    const call = toStructuredCall(gateway, { targets: CAPABLE, signal: new AbortController().signal })

    const response = await call({ schema: SCHEMA, mode: "strict", messages: MESSAGES })

    expect(response).toEqual({ text: "", finishReason: null })
    expect(calls).toHaveLength(1)
  })
})
