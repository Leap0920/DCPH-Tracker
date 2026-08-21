import { describe, expect, it } from "vitest"
import { MAX_COMMENT_LENGTH } from "@/lib/comment-constants"
import { MAX_MESSAGE_LENGTH } from "@/lib/chat-constants"
import { redactForbiddenWords } from "@/lib/profanity"

describe("MAX_COMMENT_LENGTH", () => {
  it("is the documented server-authoritative cap", () => {
    expect(MAX_COMMENT_LENGTH).toBe(2000)
  })

  it("is a positive integer", () => {
    expect(typeof MAX_COMMENT_LENGTH).toBe("number")
    expect(Number.isInteger(MAX_COMMENT_LENGTH)).toBe(true)
    expect(MAX_COMMENT_LENGTH).toBeGreaterThan(0)
  })

  it("matches the chat cap — both surfaces accept the same length", () => {
    expect(MAX_COMMENT_LENGTH).toBe(MAX_MESSAGE_LENGTH)
  })
})

describe("comment redaction invariants", () => {
  it("never lengthens a body, so the route's length check still holds", () => {
    // /api/comments checks length BEFORE redacting. If redaction could grow the
    // string, a body at exactly the cap could exceed it on the way to Postgres.
    const bodies = [
      "putangina",
      "walang kwenta",
      "gago gago gago gago",
      "f*ck",
      "시발",
      "a".repeat(MAX_COMMENT_LENGTH),
    ]
    for (const body of bodies) {
      expect(redactForbiddenWords(body).length).toBeLessThanOrEqual(body.length)
    }
  })

  it("is idempotent, so redacting on send AND on read is safe", () => {
    // The client masks before POSTing, the route masks before inserting, and
    // fetchEpisodeComments masks on read — three passes over the same text.
    const bodies = [
      "gago ka talaga",
      "Best episode. leche flan tho",
      "clean comment about Shinichi",
    ]
    for (const body of bodies) {
      const once = redactForbiddenWords(body)
      expect(redactForbiddenWords(redactForbiddenWords(once))).toBe(once)
    }
  })

  it("handles a full-length comment without pathological slowdown", () => {
    const long = `${"detective conan ".repeat(120)} gago`
    const started = Date.now()
    expect(redactForbiddenWords(long)).toContain("***")
    expect(Date.now() - started).toBeLessThan(500)
  })
})
