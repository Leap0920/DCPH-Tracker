import { describe, expect, it } from "vitest"
import { MAX_MESSAGE_LENGTH, CHAT_RETENTION_HOURS } from "@/lib/chat-constants"

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

describe("CHAT_RETENTION_HOURS", () => {
  it("matches the pg_cron purge interval documented in supabase/migration-chat-purge-12h.sql", () => {
    expect(CHAT_RETENTION_HOURS).toBe(12)
  })

  it("is a positive integer", () => {
    expect(Number.isInteger(CHAT_RETENTION_HOURS)).toBe(true)
    expect(CHAT_RETENTION_HOURS).toBeGreaterThan(0)
  })
})