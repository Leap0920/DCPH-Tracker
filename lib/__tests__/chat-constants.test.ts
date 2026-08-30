import { describe, expect, it } from "vitest"
import { MAX_MESSAGE_LENGTH } from "@/lib/chat-constants"

describe("MAX_MESSAGE_LENGTH", () => {
  it("is the documented server-authoritative cap", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(2000)
  })

  it("is a positive integer", () => {
    expect(typeof MAX_MESSAGE_LENGTH).toBe("number")
    expect(Number.isInteger(MAX_MESSAGE_LENGTH)).toBe(true)
    expect(MAX_MESSAGE_LENGTH).toBeGreaterThan(0)
  })
})