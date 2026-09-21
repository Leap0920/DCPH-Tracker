import { describe, expect, it } from "vitest"
import { createQuotaTracker, type QuotaClient } from "@/lib/ai/quota"

function fakeClient(result: { allowed: boolean; retry_after_seconds: number } | null) {
  const calls: { p_key: string; p_limit: number; p_window_seconds: number }[] = []
  const client: QuotaClient = {
    rpc: async (_fn, args) => {
      calls.push(args)
      return { data: result, error: null }
    },
  }
  return { client, calls }
}

describe("createQuotaTracker", () => {
  it("allows a request and records it against a daily window", async () => {
    const { client, calls } = fakeClient({ allowed: true, retry_after_seconds: 0 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      p_key: "ai:quota:groq:a",
      p_limit: 14_000,
      p_window_seconds: 86_400,
    })
  })

  it("denies once the provider budget is spent", async () => {
    const { client } = fakeClient({ allowed: false, retry_after_seconds: 120 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(false)
  })

  it("fails open when there is no client", async () => {
    const quota = createQuotaTracker({ client: null })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
  })

  it("fails open when the RPC errors", async () => {
    const client: QuotaClient = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    }
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
  })

  it("does not call the store for a target with no declared budget", async () => {
    const { client, calls } = fakeClient({ allowed: false, retry_after_seconds: 0 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 0)).resolves.toBe(true)
    expect(calls).toHaveLength(0)
  })
})
