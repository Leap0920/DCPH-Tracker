// lib/ai/__tests__/request-log.test.ts
import { describe, expect, it } from "vitest"
import { logRequest, MAX_LOGGED_TOOLS, type RequestLogClient } from "@/lib/ai/request-log"

function fakeClient() {
  const inserted: Record<string, unknown>[] = []
  const client: RequestLogClient = {
    from: () => ({
      insert: async (values: Record<string, unknown>) => {
        inserted.push(values)
        return { error: null }
      },
    }),
  }
  return { client, inserted }
}

describe("logRequest", () => {
  it("inserts a row with the latency breakdown", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      {
        userId: "u1",
        targetId: "groq:a",
        outcome: "ok",
        planMs: 210,
        retrieveMs: 480,
        ttftMs: 900,
        totalMs: 3200,
        attempts: [{ targetId: "groq:a", outcome: "ok" }],
        docCount: 8,
        cacheHit: false,
        degradedReason: null,
      },
      { client }
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      user_id: "u1",
      target_id: "groq:a",
      outcome: "ok",
      plan_ms: 210,
      retrieve_ms: 480,
      ttft_ms: 900,
      total_ms: 3200,
      doc_count: 8,
      cache_hit: false,
      degraded_reason: null,
    })
    expect(inserted[0].attempts).toEqual([{ targetId: "groq:a", outcome: "ok" }])
  })

  it("does not throw when no client is configured", async () => {
    await expect(
      logRequest({ outcome: "error", attempts: [] }, { client: null })
    ).resolves.toBeUndefined()
  })

  it("swallows store errors", async () => {
    const client: RequestLogClient = {
      from: () => ({
        insert: async () => ({ error: { message: "boom" } }),
      }),
    }
    await expect(logRequest({ outcome: "error", attempts: [] }, { client })).resolves.toBeUndefined()
  })

  it("records a degraded reason when retrieval was cut short", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      { outcome: "ok", attempts: [], degradedReason: "retrieval_budget_exceeded" },
      { client }
    )
    expect(inserted[0].degraded_reason).toBe("retrieval_budget_exceeded")
  })

  it("records the pipeline's plan source, tools and citation verdict", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      {
        outcome: "ok",
        attempts: [],
        planSource: "router",
        tools: ["lookup_character", "next_unwatched"],
        citationsValid: true,
      },
      { client }
    )
    expect(inserted[0]).toMatchObject({
      plan_source: "router",
      citations_valid: true,
    })
    expect(inserted[0].tools).toEqual(["lookup_character", "next_unwatched"])
  })

  it("keeps an empty tool list and a false verdict out of the null default", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      { outcome: "ok", attempts: [], tools: [], citationsValid: false },
      { client }
    )
    // Both are real answers: a falsy check would record them as "not measured",
    // which in the log reads exactly like a row written before the pipeline.
    expect(inserted[0].tools).toEqual([])
    expect(inserted[0].citations_valid).toBe(false)
  })

  it("records null for the pipeline fields a v1 request never produced", async () => {
    const { client, inserted } = fakeClient()
    await logRequest({ outcome: "ok", attempts: [] }, { client })
    expect(inserted[0]).toMatchObject({
      plan_source: null,
      tools: null,
      citations_valid: null,
    })
  })

  it("caps the recorded tool list, keeping the dispatched order", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      {
        outcome: "ok",
        attempts: [],
        tools: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"],
      },
      { client }
    )
    expect(MAX_LOGGED_TOOLS).toBe(8)
    expect(inserted[0].tools).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"])
  })

  it("still resolves when the store rejects a pipeline row", async () => {
    const client: RequestLogClient = {
      from: () => ({
        insert: async () => {
          throw new Error("boom")
        },
      }),
    }
    await expect(
      logRequest(
        {
          outcome: "error",
          attempts: [],
          planSource: "fallback",
          tools: ["lookup_character"],
          citationsValid: false,
        },
        { client }
      )
    ).resolves.toBeUndefined()
  })
})
