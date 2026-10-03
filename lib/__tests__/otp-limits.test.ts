import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  OTP_EMAIL_HOURLY_LIMIT_DEFAULT,
  OTP_IP_HOURLY_LIMIT_DEFAULT,
  devFloor,
  positiveIntEnv,
  usableLimit,
  waitHint,
} from "@/lib/otp-limits"
// The shim gsd-bend's sampled engine executes. LAWS.bend is checked against
// THIS, not against lib/otp-limits.ts, so the two are asserted equal below —
// without that, a green gate would say nothing about the code that ships.
import { OtpLimits } from "../../src/rate_limit_spec.mjs"

/** Every shape an override can reach the guard in. */
const PARSED = [0, 1, 2, 10, 60, -1, -60, 1.5, 1e6, NaN, Infinity, -Infinity]
const FALLBACKS = [60, 10]

describe("usableLimit — the guard proved in LAWS.bend", () => {
  it("never returns a limit the limiter cannot use", () => {
    for (const parsed of PARSED) {
      for (const fallback of FALLBACKS) {
        expect(usableLimit(parsed, fallback)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("keeps a usable override and falls back on everything else", () => {
    expect(usableLimit(12, 60)).toBe(12)
    expect(usableLimit(1, 60)).toBe(1)
    expect(usableLimit(0, 60)).toBe(60)
    expect(usableLimit(-5, 60)).toBe(60)
    expect(usableLimit(NaN, 60)).toBe(60)
    expect(usableLimit(Infinity, 60)).toBe(60)
  })

  it("agrees with the shim the proofs are checked against", () => {
    for (const parsed of PARSED) {
      for (const fallback of FALLBACKS) {
        expect(OtpLimits.usable_limit(parsed, fallback)).toBe(
          usableLimit(parsed, fallback)
        )
      }
    }
  })
})

describe("positiveIntEnv — the only way a limit comes from the environment", () => {
  const NAME = "OTP_TEST_HOURLY_LIMIT"
  afterEach(() => {
    delete process.env[NAME]
  })

  it("falls back on unset, empty and unusable values", () => {
    delete process.env[NAME]
    expect(positiveIntEnv(NAME, 60)).toBe(60)
    for (const raw of ["", " ", "abc", "0", "-5", "NaN", "1.5x"]) {
      process.env[NAME] = raw
      const limit = positiveIntEnv(NAME, 60)
      expect(limit).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(limit)).toBe(true)
    }
  })

  it("keeps a usable override", () => {
    process.env[NAME] = "12"
    expect(positiveIntEnv(NAME, 60)).toBe(12)
    process.env[NAME] = " 12 "
    expect(positiveIntEnv(NAME, 60)).toBe(12)
    // parseInt stops at the first non-digit, so this is 1, not 1000 — still usable.
    process.env[NAME] = "1e3"
    expect(positiveIntEnv(NAME, 60)).toBe(1)
  })
})

describe("the two ceilings — the relationship the incident turned on", () => {
  it("keeps the network ceiling at or above the per-address ceiling", () => {
    expect(OTP_IP_HOURLY_LIMIT_DEFAULT).toBeGreaterThanOrEqual(
      OTP_EMAIL_HOURLY_LIMIT_DEFAULT
    )
  })

  it("agrees with the shim on the dev floor", () => {
    for (const limit of [0, 1, 10, 30, 50, 60, 120]) {
      for (const floor of [0, 30, 50]) {
        expect(OtpLimits.dev_floor(limit, floor)).toBe(devFloor(limit, floor))
        // A floor, not a replacement: a configured override above it wins.
        expect(devFloor(limit, floor)).toBeGreaterThanOrEqual(limit)
      }
    }
  })
})

describe("waitHint — the wait a 429 body promises", () => {
  it("never promises a wait shorter than a minute", () => {
    for (const seconds of [0, 1, 30, 59, 60, 61, 120, 3599, 3600, 86400, -5]) {
      expect(waitHint(seconds)).toMatch(/^about (a minute|\d+ minutes)$/)
    }
  })

  it("names the minute it means", () => {
    expect(waitHint(1)).toBe("about a minute")
    expect(waitHint(60)).toBe("about a minute")
    expect(waitHint(61)).toBe("about 2 minutes")
    expect(waitHint(2520)).toBe("about 42 minutes")
  })
})

describe(".env.example — where operators learn these knobs exist", () => {
  const root = process.cwd()
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8")
  const source = fs.readFileSync(path.join(root, "lib/otp-limits.ts"), "utf8")

  // Read the knob names out of the module rather than listing them here: a list
  // goes stale the moment someone adds a third knob.
  const read = [...source.matchAll(/positiveIntEnv\(\s*"([A-Z0-9_]+)"/g)].map(
    (match) => match[1]
  )
  const shipped: Record<string, number> = {
    OTP_IP_HOURLY_LIMIT: OTP_IP_HOURLY_LIMIT_DEFAULT,
    OTP_EMAIL_HOURLY_LIMIT: OTP_EMAIL_HOURLY_LIMIT_DEFAULT,
  }

  it("parsed the module's knobs out of its source", () => {
    expect(example.length).toBeGreaterThan(0)
    expect(read).toEqual(["OTP_IP_HOURLY_LIMIT", "OTP_EMAIL_HOURLY_LIMIT"])
  })

  it("documents every knob, at the value the code defaults to", () => {
    for (const name of read) {
      const documented = example.match(new RegExp(`^${name}=(.+)$`, "m"))
      expect(
        documented,
        `${name} is read by lib/otp-limits.ts but missing from .env.example`
      ).not.toBeNull()
      // Catches a knob added without docs AND a default changed in one place
      // only, which is how the documented value silently becomes a lie.
      expect(documented?.[1].trim()).toBe(String(shipped[name]))
    }
  })
})
