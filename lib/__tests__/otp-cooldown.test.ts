import { describe, expect, it } from "vitest"
import {
  cooldownFromRetryAfter,
  formatCooldown,
  otpSendBlocked,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_RESEND_COOLDOWN_MAX_SECONDS,
} from "../otp-cooldown"

describe("cooldownFromRetryAfter", () => {
  it("uses Retry-After when the server sends one", () => {
    expect(cooldownFromRetryAfter("90")).toBe(90)
    expect(cooldownFromRetryAfter("1")).toBe(1)
  })

  it("falls back to GoTrue's own window when the header is absent or junk", () => {
    for (const header of [null, undefined, "", "not-a-number", "0", "-30", "NaN"]) {
      expect(cooldownFromRetryAfter(header), `header ${JSON.stringify(header)}`).toBe(
        OTP_RESEND_COOLDOWN_SECONDS
      )
    }
  })

  it("never lets a server hint disable the buttons for longer than the cap", () => {
    // The per-network refusal sends Retry-After: 1800. Honouring it verbatim
    // would leave the send button dead for half an hour with no way to retry,
    // so the countdown is clamped — this is the bound that keeps a long
    // server-side window from turning into a stuck UI.
    expect(cooldownFromRetryAfter("1800")).toBe(OTP_RESEND_COOLDOWN_MAX_SECONDS)
    expect(cooldownFromRetryAfter("300")).toBe(300)
    expect(cooldownFromRetryAfter("301")).toBe(OTP_RESEND_COOLDOWN_MAX_SECONDS)
  })

  it("truncates a fractional hint instead of producing a fractional countdown", () => {
    expect(cooldownFromRetryAfter("1.9")).toBe(1)
  })

  it("honours a caller-supplied fallback and cap", () => {
    expect(cooldownFromRetryAfter(null, 5, 10)).toBe(5)
    expect(cooldownFromRetryAfter("600", 5, 10)).toBe(10)
  })
})

describe("formatCooldown", () => {
  it("counts seconds under a minute and whole minutes above it", () => {
    expect(formatCooldown(1)).toBe("1s")
    expect(formatCooldown(59)).toBe("59s")
    expect(formatCooldown(60)).toBe("1m")
    expect(formatCooldown(61)).toBe("2m")
    expect(formatCooldown(300)).toBe("5m")
  })
})

describe("otpSendBlocked", () => {
  it("blocks while the request is in flight", () => {
    expect(otpSendBlocked({ loading: true, cooldownSeconds: 0 })).toBe(true)
  })

  it("blocks for the whole cooldown, which is what the send button was missing", () => {
    // The original bug: the send button honoured only `loading`, so a user who
    // had just been refused with a 429 could tap straight back into the
    // limiter while the resend link was counting down.
    expect(otpSendBlocked({ loading: false, cooldownSeconds: 1 })).toBe(true)
    expect(otpSendBlocked({ loading: false, cooldownSeconds: 300 })).toBe(true)
  })

  it("lets the user send again once the countdown is over", () => {
    expect(otpSendBlocked({ loading: false, cooldownSeconds: 0 })).toBe(false)
  })
})
