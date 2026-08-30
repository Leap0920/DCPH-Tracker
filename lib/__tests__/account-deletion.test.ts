import { describe, expect, it } from "vitest"
import { DELETE_CONFIRM_PHRASE, isDeleteConfirmed } from "@/lib/account-deletion"

describe("isDeleteConfirmed", () => {
  it("accepts the exact phrase", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_PHRASE)).toBe(true)
  })

  it("is case-insensitive and whitespace-tolerant", () => {
    for (const input of ["delete", "Delete", " DELETE ", "\tdelete\n"]) {
      expect(isDeleteConfirmed(input)).toBe(true)
    }
  })

  it("rejects empty, partial and padded input", () => {
    for (const input of [
      "",
      " ",
      "DELET",
      "DELETEE",
      "DELETE NOW",
      "DELETE MY ACCOUNT",
      "reset",
    ]) {
      expect(isDeleteConfirmed(input)).toBe(false)
    }
  })

  it("is not satisfied by the reset phrase", () => {
    // Both gates live on the same page; confusing one for the other must not
    // authorise a deletion.
    expect(isDeleteConfirmed("RESET")).toBe(false)
  })
})
