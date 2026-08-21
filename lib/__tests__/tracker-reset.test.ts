import { describe, expect, it } from "vitest"
import { RESET_CONFIRM_PHRASE, isResetConfirmed } from "@/lib/tracker-reset"

describe("isResetConfirmed", () => {
  it("accepts the exact phrase", () => {
    expect(isResetConfirmed(RESET_CONFIRM_PHRASE)).toBe(true)
  })

  it("is case-insensitive and whitespace-tolerant", () => {
    for (const input of ["reset", "Reset", " RESET ", "\treset\n"]) {
      expect(isResetConfirmed(input)).toBe(true)
    }
  })

  it("rejects empty and partial input", () => {
    for (const input of ["", " ", "RESE", "RESETT", "RESET NOW", "delete"]) {
      expect(isResetConfirmed(input)).toBe(false)
    }
  })

  it("rejects input that merely contains the phrase", () => {
    expect(isResetConfirmed("please RESET my tracker")).toBe(false)
  })
})
