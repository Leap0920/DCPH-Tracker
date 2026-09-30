import { afterEach, describe, expect, it, vi } from "vitest"
import { randomId } from "@/lib/utils"

/**
 * Regression cover for `crypto.randomUUID is not a function`.
 *
 * `randomUUID` only exists in secure contexts, so a plain-HTTP origin (LAN dev
 * server) or an older Safari crashed the hero stats, chat and comments. The
 * fallback has to keep producing a valid v4 UUID so ids stay well-formed.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("randomId", () => {
  it("uses crypto.randomUUID when the environment exposes it", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    })
    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555")
  })

  it("assembles a v4 UUID from getRandomValues when randomUUID is unavailable", () => {
    // What an insecure origin exposes: getRandomValues, but no randomUUID.
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(0xab),
    })
    const id = randomId()
    expect(id).toBe("abababab-abab-4bab-abab-abababababab")
    expect(id).toMatch(UUID_V4)
  })

  it("still returns a fresh v4 UUID when no crypto API is available", () => {
    vi.stubGlobal("crypto", {})
    const first = randomId()
    expect(first).toMatch(UUID_V4)
    expect(randomId()).not.toBe(first)
  })
})
