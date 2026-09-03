import { describe, expect, it } from "vitest"
import { REQUEST_TIMEOUT_MS, withTimeout } from "@/lib/request-timeout"

describe("withTimeout — request-path DB timeout", () => {
  it("resolves a fast promise with its value", async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42)
  })

  it("rejects a never-resolving promise after the budget", async () => {
    const never = new Promise<never>(() => {})
    await expect(withTimeout(never, 20)).rejects.toThrow("timeout after 20ms")
  })

  it("rejects a slow thenable (Supabase-style) after the budget", async () => {
    const slowThenable: PromiseLike<string> = {
      then: ((resolve: (v: string) => void) => {
        setTimeout(() => resolve("late"), 500)
        return undefined as unknown as Promise<string>
      }) as Promise<string>["then"],
    }
    await expect(withTimeout(slowThenable, 20)).rejects.toThrow("timeout after 20ms")
  })

  it("uses the shared 2s budget by default", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(2_000)
  })

  it("propagates the inner rejection when it loses the race", async () => {
    await expect(withTimeout(Promise.reject(new Error("db boom")), 50)).rejects.toThrow(
      "db boom"
    )
  })
})