import { describe, expect, it } from "vitest"
import { secretMatches } from "../secret-compare"

describe("secretMatches", () => {
  it("accepts an exact match", () => {
    expect(secretMatches("s3cret-value", "s3cret-value")).toBe(true)
    expect(secretMatches("Bearer abc123", "Bearer abc123")).toBe(true)
  })

  it("rejects a wrong value of the same length", () => {
    expect(secretMatches("s3cret-valuX", "s3cret-value")).toBe(false)
  })

  it("rejects a correct prefix and a correct suffix", () => {
    expect(secretMatches("s3cret", "s3cret-value")).toBe(false)
    expect(secretMatches("value", "s3cret-value")).toBe(false)
  })

  it("rejects a wrong value of a different length", () => {
    // The digest step makes the compare length-blind; a shorter or longer
    // guess must still be rejected rather than throwing.
    expect(secretMatches("s", "s3cret-value")).toBe(false)
    expect(secretMatches("s3cret-value-and-more", "s3cret-value")).toBe(false)
  })

  it("fails closed when either side is missing or empty", () => {
    expect(secretMatches(null, "s3cret-value")).toBe(false)
    expect(secretMatches(undefined, "s3cret-value")).toBe(false)
    expect(secretMatches("", "s3cret-value")).toBe(false)
    expect(secretMatches("s3cret-value", undefined)).toBe(false)
    expect(secretMatches("s3cret-value", "")).toBe(false)
    expect(secretMatches(null, null)).toBe(false)
  })

  it("accepts a long random secret", () => {
    const secret = "Qk3n8vT2xR7pL9wZ1mC4sB6yH0jF5dGaE2uI8oP3tN7rV1cX"
    expect(secretMatches(secret, secret)).toBe(true)
    expect(secretMatches(`${secret}!`, secret)).toBe(false)
  })
})
