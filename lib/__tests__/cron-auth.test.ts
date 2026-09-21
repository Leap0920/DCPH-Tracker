/**
 * The shared cron-secret comparison.
 *
 * Pure: no client, no network, no clock. These tests pin the semantics the two
 * routes that used to hold private copies relied on — a Bearer prefix, an exact
 * match, and a `false` for every malformed or absent input — so the extraction
 * cannot quietly loosen the only guard on the cron endpoints.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cronSecret, headerMatchesSecret } from "@/lib/cron-auth"

const SECRET = "s3cret-cron-value"

const originalCronSecret = process.env.CRON_SECRET

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalCronSecret
})

describe("headerMatchesSecret", () => {
  it("accepts the exact `Bearer <secret>` header", () => {
    expect(headerMatchesSecret(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it("rejects a wrong secret", () => {
    expect(headerMatchesSecret("Bearer wrong-secret", SECRET)).toBe(false)
  })

  it("rejects the bare secret without the Bearer prefix", () => {
    // The header is an authorization scheme, not the value alone; accepting the
    // bare secret would make a different, weaker contract than the one Vercel
    // sends.
    expect(headerMatchesSecret(SECRET, SECRET)).toBe(false)
  })

  it("rejects a missing header and a missing secret", () => {
    expect(headerMatchesSecret(null, SECRET)).toBe(false)
    expect(headerMatchesSecret(`Bearer ${SECRET}`, undefined)).toBe(false)
    expect(headerMatchesSecret(null, undefined)).toBe(false)
    expect(headerMatchesSecret("", SECRET)).toBe(false)
    expect(headerMatchesSecret(`Bearer ${SECRET}`, "")).toBe(false)
  })

  it("rejects a superstring of the expected header", () => {
    // A prefix/suffix match would let `Bearer <secret>extra` through.
    expect(headerMatchesSecret(`Bearer ${SECRET}extra`, SECRET)).toBe(false)
    expect(headerMatchesSecret(`Bearer ${SECRET} `, SECRET)).toBe(false)
    expect(headerMatchesSecret(`bearer ${SECRET}`, SECRET)).toBe(false)
  })

  it("does not throw on inputs of any length", () => {
    // Both sides are hashed to fixed-width digests first, so timingSafeEqual
    // never sees mismatched lengths and cannot leak the secret's length by
    // throwing.
    expect(headerMatchesSecret("x".repeat(10_000), SECRET)).toBe(false)
    expect(headerMatchesSecret(`Bearer ${SECRET}`, "y".repeat(10_000))).toBe(false)
  })
})

describe("cronSecret", () => {
  it("reads the secret from the environment at call time", () => {
    process.env.CRON_SECRET = SECRET
    expect(cronSecret()).toBe(SECRET)
  })

  it("answers undefined when the secret is unset", () => {
    delete process.env.CRON_SECRET
    expect(cronSecret()).toBeUndefined()
  })
})
