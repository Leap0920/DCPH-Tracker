import { describe, expect, it } from "vitest"
import { mergeChatMessages, ECHO_WINDOW_MS } from "@/lib/chat-merge"
import type { ChatMessage } from "@/lib/queries/client/chat"

const ROOM = "11111111-1111-1111-1111-111111111111"
const BASE = Date.parse("2026-08-21T08:00:00.000Z")

function msg(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    room_id: ROOM,
    user_id: "user-1",
    content: `content-${id}`,
    created_at: new Date(BASE).toISOString(),
    profiles: null,
    ...overrides,
  }
}

function at(offsetMs: number) {
  return new Date(BASE + offsetMs).toISOString()
}

describe("mergeChatMessages", () => {
  it("returns the incoming page when the cache is empty", () => {
    const incoming = [msg("b", { created_at: at(1000) }), msg("a")]
    expect(mergeChatMessages([], incoming).map((m) => m.id)).toEqual(["b", "a"])
  })

  it("keeps newest-first order across both sources", () => {
    const previous = [msg("old", { created_at: at(-60_000) })]
    const incoming = [msg("new", { created_at: at(60_000) }), msg("mid")]
    expect(mergeChatMessages(previous, incoming).map((m) => m.id)).toEqual([
      "new",
      "mid",
      "old",
    ])
  })

  it("lets the incoming row win on conflict (server content and profile)", () => {
    const previous = [msg("a", { content: "stale", profiles: null })]
    const incoming = [
      msg("a", {
        content: "fresh",
        profiles: { username: "u", display_name: "U", avatar_url: null },
      }),
    ]
    const merged = mergeChatMessages(previous, incoming)
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe("fresh")
    expect(merged[0].profiles?.username).toBe("u")
  })

  it("preserves pages pulled in by Load earlier", () => {
    // Older pages are outside the latest-100 window, so a poll never returns
    // them; a wholesale replace would throw them away.
    const previous = [
      msg("recent", { created_at: at(0) }),
      msg("older", { created_at: at(-3_600_000) }),
      msg("oldest", { created_at: at(-7_200_000) }),
    ]
    const incoming = [msg("recent", { created_at: at(0) })]
    expect(mergeChatMessages(previous, incoming).map((m) => m.id)).toEqual([
      "recent",
      "older",
      "oldest",
    ])
  })

  it("keeps an in-flight optimistic message at the front", () => {
    const previous = [
      msg("temp-1", { content: "hello", created_at: at(5_000) }),
      msg("a"),
    ]
    const merged = mergeChatMessages(previous, [msg("a")])
    expect(merged.map((m) => m.id)).toEqual(["temp-1", "a"])
  })

  it("drops an optimistic message once its real row lands", () => {
    const previous = [msg("temp-1", { content: "hello", created_at: at(5_000) })]
    const incoming = [msg("real-1", { content: "hello", created_at: at(5_200) })]
    expect(mergeChatMessages(previous, incoming).map((m) => m.id)).toEqual([
      "real-1",
    ])
  })

  it("does not let one real row claim two identical optimistic messages", () => {
    const previous = [
      msg("temp-2", { content: "ok", created_at: at(6_000) }),
      msg("temp-1", { content: "ok", created_at: at(5_000) }),
    ]
    const incoming = [msg("real-1", { content: "ok", created_at: at(5_100) })]
    const merged = mergeChatMessages(previous, incoming)
    // One temp resolved, the other still pending — the second "ok" is not lost.
    expect(merged).toHaveLength(2)
    expect(merged.filter((m) => m.id.startsWith("temp-"))).toHaveLength(1)
  })

  it("does not match an optimistic message to an old row with the same text", () => {
    const previous = [msg("temp-1", { content: "ok", created_at: at(0) })]
    const incoming = [
      msg("real-old", { content: "ok", created_at: at(-ECHO_WINDOW_MS - 1000) }),
    ]
    expect(mergeChatMessages(previous, incoming).map((m) => m.id)).toEqual([
      "temp-1",
      "real-old",
    ])
  })

  it("does not match optimistic messages from a different author", () => {
    const previous = [
      msg("temp-1", { content: "ok", user_id: "me", created_at: at(0) }),
    ]
    const incoming = [
      msg("real-1", { content: "ok", user_id: "someone-else", created_at: at(0) }),
    ]
    expect(mergeChatMessages(previous, incoming)).toHaveLength(2)
  })

  it("never resurrects a tombstoned message from either source", () => {
    const removed = new Set(["gone"])
    const previous = [msg("gone"), msg("stays")]
    const incoming = [msg("gone"), msg("also-stays", { created_at: at(1000) })]
    const merged = mergeChatMessages(previous, incoming, removed)
    expect(merged.map((m) => m.id)).not.toContain("gone")
    expect(merged.map((m) => m.id).sort()).toEqual(["also-stays", "stays"])
  })

  it("is stable when nothing changed", () => {
    const rows = [msg("b", { created_at: at(1000) }), msg("a")]
    const once = mergeChatMessages(rows, rows)
    const twice = mergeChatMessages(once, rows)
    expect(twice.map((m) => m.id)).toEqual(once.map((m) => m.id))
  })

  it("breaks identical-timestamp ties deterministically", () => {
    const a = mergeChatMessages([], [msg("aaa"), msg("bbb")]).map((m) => m.id)
    const b = mergeChatMessages([], [msg("bbb"), msg("aaa")]).map((m) => m.id)
    expect(a).toEqual(b)
  })
})
