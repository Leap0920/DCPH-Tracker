import { describe, expect, it } from "vitest"
import { createProviderHealth, type HealthClient } from "@/lib/ai/provider-health"
import { initialTargetState } from "@/lib/ai/circuit"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

/** Minimal fake of the admin Supabase client, covering only what the store calls. */
function fakeClient(rows: Record<string, unknown>[] = []): {
  client: HealthClient
  upserts: Record<string, unknown>[]
} {
  const upserts: Record<string, unknown>[] = []
  const client: HealthClient = {
    from() {
      return {
        select() {
          return {
            in: async () => ({ data: rows, error: null }),
          }
        },
        upsert: async (values: Record<string, unknown>) => {
          upserts.push(values)
          return { error: null }
        },
      }
    },
  }
  return { client, upserts }
}

describe("createProviderHealth", () => {
  it("reports every target available when the store has no rows", async () => {
    const { client } = fakeClient()
    const health = createProviderHealth({ client, now: () => NOW })
    const states = await health.load(["groq:a", "gemini:b"])
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(true)
  })

  it("restores a cooled-down target from stored state", async () => {
    const { client } = fakeClient([
      { target: "groq:a", consecutive_failures: 3, open_until: new Date(NOW + 60_000).toISOString() },
    ])
    const health = createProviderHealth({ client, now: () => NOW })
    const states = await health.load(["groq:a"])
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(false)
    expect(states.get("groq:a")!.consecutiveFailures).toBe(3)
  })

  it("persists a failure as an upsert keyed on the target", async () => {
    const { client, upserts } = fakeClient()
    const health = createProviderHealth({ client, now: () => NOW })
    const state = initialTargetState("groq:a")
    await health.recordFailure(state, { kind: "server_error", cooldownMs: 1_000, retryNext: true })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].target).toBe("groq:a")
    expect(upserts[0].consecutive_failures).toBe(1)
  })

  it("keeps working in memory when no client is configured", async () => {
    const health = createProviderHealth({ client: null, now: () => NOW })
    const state = initialTargetState("groq:a")
    await health.recordFailure(state, { kind: "misconfigured", cooldownMs: 86_400_000, retryNext: true })
    const states = await health.load(["groq:a"])
    // Availability beats observability: with no service-role key the gateway
    // must still serve chat, so state lives in the process instead.
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(false)
  })

  it("does not throw when the store errors", async () => {
    const failing: HealthClient = {
      from() {
        return {
          select() {
            return {
              in: async () => ({ data: null, error: { message: "boom" } }),
            }
          },
          upsert: async () => ({ error: { message: "boom" } }),
        }
      },
    }
    const health = createProviderHealth({ client: failing, now: () => NOW })
    await expect(health.load(["groq:a"])).resolves.toBeInstanceOf(Map)
    await expect(
      health.recordFailure(initialTargetState("groq:a"), {
        kind: "server_error",
        cooldownMs: 1_000,
        retryNext: true,
      })
    ).resolves.toBeUndefined()
  })
})
