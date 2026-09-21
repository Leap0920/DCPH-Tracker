import { describe, expect, it } from "vitest"
import type {
  Conversation,
  ConversationPatch,
  TranscriptPort,
  TranscriptTurn,
} from "@/lib/ai/conversations/port"
import {
  createTranscriptStore,
  MAX_TITLE_CHARS,
  RECENT_CONVERSATION_MS,
  summaryRange,
  titleFromFirstUserTurn,
  VERBATIM_WINDOW,
  verbatimRange,
} from "@/lib/ai/conversations/store"

/**
 * The store is the policy layer above the port: ownership, the attach window,
 * the verbatim range and the title rule. Nothing here constructs a client or a
 * clock — the port is a recording fake and time is injected (constraint 11) —
 * so these tests pin the calls the store makes, not just the values it returns.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

const CONVERSATION: Conversation = {
  id: CONVERSATION_ID,
  userId: USER_ID,
  title: "Who is Haibara?",
  summary: "They talked about Haibara.",
  summarizedThrough: 8,
  messageCount: 12,
  lastMessageAt: NOW - 60_000,
  archivedAt: null,
}

const TURNS: TranscriptTurn[] = [
  { id: "m11", role: "user", content: "eleventh", createdAt: NOW - 2000 },
  { id: "m12", role: "assistant", content: "twelfth", createdAt: NOW - 1000 },
]

interface RecordedCall {
  method: keyof TranscriptPort
  args: unknown[]
}

interface FakeScript {
  /** What `conversationOwnedBy` finds; null is both "unknown" and "not yours". */
  conversation?: Conversation | null
  /** What `recentConversation` finds inside the attach window. */
  recent?: Conversation | null
  /** The row `createConversation` returns. */
  created?: Conversation
  messages?: TranscriptTurn[]
  conversations?: Conversation[]
  /** The one method that rejects with a dropped connection. */
  reject?: keyof TranscriptPort
}

/**
 * A recording stand-in for the port. Every method logs its arguments first, so a
 * test can assert the order of the store's calls as well as the ownership id
 * that rode along with each one.
 */
function createFakePort(script: FakeScript = {}): { port: TranscriptPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []

  function record(method: keyof TranscriptPort, args: unknown[]): void {
    calls.push({ method, args })
  }

  function guard(method: keyof TranscriptPort): void {
    if (script.reject === method) throw new Error(`${method} failed`)
  }

  const port: TranscriptPort = {
    async conversationOwnedBy(userId, conversationId) {
      record("conversationOwnedBy", [userId, conversationId])
      guard("conversationOwnedBy")
      return script.conversation ?? null
    },
    async recentConversation(userId, since) {
      record("recentConversation", [userId, since])
      guard("recentConversation")
      return script.recent ?? null
    },
    async createConversation(row, now) {
      record("createConversation", [row, now])
      guard("createConversation")
      return script.created ?? { ...CONVERSATION, userId: row.userId, title: row.title }
    },
    async updateConversation(userId, id, patch) {
      record("updateConversation", [userId, id, patch])
      guard("updateConversation")
    },
    async lastMessages(userId, conversationId, limit) {
      record("lastMessages", [userId, conversationId, limit])
      guard("lastMessages")
      return script.messages ?? []
    },
    async messagesRange(userId, conversationId, from, to) {
      record("messagesRange", [userId, conversationId, from, to])
      guard("messagesRange")
      return []
    },
    async appendMessages(userId, conversationId, turns, now) {
      record("appendMessages", [userId, conversationId, turns, now])
      guard("appendMessages")
    },
    async listConversations(userId, limit) {
      record("listConversations", [userId, limit])
      guard("listConversations")
      return script.conversations ?? []
    },
    async searchMessages(userId, query, limit) {
      record("searchMessages", [userId, query, limit])
      guard("searchMessages")
      return []
    },
  }

  return { port, calls }
}

/** The store under test, with one fixed clock for every test. */
function storeWith(script: FakeScript = {}) {
  const { port, calls } = createFakePort(script)
  return { store: createTranscriptStore({ port, now: () => NOW }), calls }
}

function methods(calls: RecordedCall[]): (keyof TranscriptPort)[] {
  return calls.map((call) => call.method)
}

describe("verbatimRange", () => {
  it("returns the last VERBATIM_WINDOW messages and never a negative start", () => {
    expect(verbatimRange(20)).toEqual({ from: 12, to: 20 })
    expect(verbatimRange(VERBATIM_WINDOW)).toEqual({ from: 0, to: 8 })
    expect(verbatimRange(3)).toEqual({ from: 0, to: 3 })
    expect(verbatimRange(0)).toEqual({ from: 0, to: 0 })
  })
})

describe("summaryRange", () => {
  it("covers the gap between the summary and the window, and is null when that gap is empty", () => {
    expect(summaryRange(20, 8)).toEqual({ from: 8, to: 12 })
    // At ten messages the window still shows everything the summary has not
    // covered, and a range with nothing in it must not cost a model call.
    expect(summaryRange(10, 8)).toBeNull()
    expect(summaryRange(8, 8)).toBeNull()
    expect(summaryRange(4, 0)).toBeNull()
  })
})

describe("titleFromFirstUserTurn", () => {
  it("collapses whitespace, caps at MAX_TITLE_CHARS with an ellipsis, and is empty for nothing", () => {
    expect(titleFromFirstUserTurn("  Who\n\n is\tHaibara?  ")).toBe("Who is Haibara?")
    // The kept text is exactly the cap; the ellipsis marks the truncation
    // rather than counting against it, and an exact-length title is not touched.
    expect(titleFromFirstUserTurn("a".repeat(MAX_TITLE_CHARS + 20))).toBe(
      "a".repeat(MAX_TITLE_CHARS) + "…"
    )
    expect(titleFromFirstUserTurn("a".repeat(MAX_TITLE_CHARS))).toBe("a".repeat(MAX_TITLE_CHARS))
    // "" is the caller's cue to store null: an untitled conversation is not one
    // whose title is an empty string.
    expect(titleFromFirstUserTurn("   \n\t ")).toBe("")
  })
})

describe("resolve with a conversationId", () => {
  it("returns the conversation when the scoped read finds it, and creates nothing", async () => {
    const { store, calls } = storeWith({ conversation: CONVERSATION })

    await expect(store.resolve({ userId: USER_ID, conversationId: CONVERSATION_ID })).resolves.toEqual({
      conversation: CONVERSATION,
      created: false,
    })

    expect(calls).toEqual([{ method: "conversationOwnedBy", args: [USER_ID, CONVERSATION_ID] }])
  })

  it("gives an unknown id and another user's id the same answer, and creates neither", async () => {
    // `conversationOwnedBy` cannot tell the two apart, so the store must not
    // either: a distinguishable answer would report whether someone else's id
    // exists, and creating a conversation would let a tampered id start a new
    // thread the caller then owns (rule 1).
    const unknown = storeWith({ conversation: null })
    await expect(unknown.store.resolve({ userId: USER_ID, conversationId: "no-such-id" })).resolves.toBeNull()

    const foreign = storeWith({ conversation: null })
    await expect(foreign.store.resolve({ userId: OTHER_USER_ID, conversationId: CONVERSATION_ID })).resolves.toBeNull()

    expect(methods(unknown.calls)).toEqual(["conversationOwnedBy"])
    expect(methods(foreign.calls)).toEqual(["conversationOwnedBy"])
  })
})

describe("resolve without an id", () => {
  it("attaches to the user's most recent conversation inside the 30-minute window", async () => {
    const { store, calls } = storeWith({ recent: CONVERSATION })

    await expect(store.resolve({ userId: USER_ID })).resolves.toEqual({
      conversation: CONVERSATION,
      created: false,
    })

    expect(calls).toEqual([{ method: "recentConversation", args: [USER_ID, NOW - RECENT_CONVERSATION_MS] }])
  })

  it("creates an untitled conversation, treating an explicit null like an absent id", async () => {
    const created = { ...CONVERSATION, title: null, summary: null, messageCount: 0 }
    const { store, calls } = storeWith({ recent: null, created })

    await expect(store.resolve({ userId: USER_ID, conversationId: null })).resolves.toEqual({
      conversation: created,
      created: true,
    })

    expect(calls).toEqual([
      { method: "recentConversation", args: [USER_ID, NOW - RECENT_CONVERSATION_MS] },
      { method: "createConversation", args: [{ userId: USER_ID, title: null }, NOW] },
    ])
  })
})

describe("appendUserTurn", () => {
  it("appends the turn, then bumps the count and titles a brand-new conversation", async () => {
    const fresh = { ...CONVERSATION, title: null, summary: null, messageCount: 0, lastMessageAt: NOW - 1000 }
    const { store, calls } = storeWith({ conversation: fresh })

    await store.appendUserTurn({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      content: "  Who is Haibara?  ",
    })

    // The content is stored verbatim — only the title is normalised — and the
    // count/timestamp patch follows the append rather than preceding it.
    expect(calls).toEqual([
      { method: "conversationOwnedBy", args: [USER_ID, CONVERSATION_ID] },
      {
        method: "appendMessages",
        args: [USER_ID, CONVERSATION_ID, [{ role: "user", content: "  Who is Haibara?  " }], NOW],
      },
      {
        method: "updateConversation",
        args: [USER_ID, CONVERSATION_ID, { messageCount: 1, lastMessageAt: NOW, title: "Who is Haibara?" }],
      },
    ])
  })

  it("stores null, not an empty string, when the first turn is only whitespace", async () => {
    const { store, calls } = storeWith({
      conversation: { ...CONVERSATION, title: null, messageCount: 0 },
    })

    await store.appendUserTurn({ userId: USER_ID, conversationId: CONVERSATION_ID, content: "   " })

    expect(calls.at(-1)?.args[2]).toEqual({ messageCount: 1, lastMessageAt: NOW, title: null })
  })

  it("leaves the title alone once the conversation has messages", async () => {
    const { store, calls } = storeWith({ conversation: { ...CONVERSATION, title: null, messageCount: 4 } })

    await store.appendUserTurn({ userId: USER_ID, conversationId: CONVERSATION_ID, content: "next question" })

    const patch = calls.at(-1)?.args[2] as ConversationPatch
    // The key is absent, not `undefined`: a later turn must not rewrite the
    // title the first user turn established.
    expect(patch).toEqual({ messageCount: 5, lastMessageAt: NOW })
    expect("title" in patch).toBe(false)
  })

  it("leaves an existing title alone", async () => {
    const { store, calls } = storeWith({
      conversation: { ...CONVERSATION, title: "Episode 5", messageCount: 0 },
    })

    await store.appendUserTurn({ userId: USER_ID, conversationId: CONVERSATION_ID, content: "hi" })

    const patch = calls.at(-1)?.args[2] as ConversationPatch
    expect(patch).toEqual({ messageCount: 1, lastMessageAt: NOW })
    expect("title" in patch).toBe(false)
  })

  it("refuses a conversation the caller does not own, and writes nothing", async () => {
    const { store, calls } = storeWith({ conversation: null })

    await expect(
      store.appendUserTurn({ userId: OTHER_USER_ID, conversationId: CONVERSATION_ID, content: "hi" })
    ).resolves.toBeUndefined()

    // The ownership read is what stops a message write from being aimed at
    // another user's conversation: `ai_messages` has no user_id of its own (D1).
    expect(methods(calls)).toEqual(["conversationOwnedBy"])
  })
})

describe("loadWindow", () => {
  it("returns the stored summary and the last VERBATIM_WINDOW turns", async () => {
    const { store, calls } = storeWith({ conversation: CONVERSATION, messages: TURNS })

    await expect(store.loadWindow(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      summary: "They talked about Haibara.",
      turns: TURNS,
    })

    expect(calls).toEqual([
      { method: "conversationOwnedBy", args: [USER_ID, CONVERSATION_ID] },
      { method: "lastMessages", args: [USER_ID, CONVERSATION_ID, VERBATIM_WINDOW] },
    ])
  })

  it("degrades instead of throwing when a port call rejects", async () => {
    const { store } = storeWith({ conversation: CONVERSATION, reject: "lastMessages" })

    // The route's fallback signal (constraint 14): a broken database and an
    // empty conversation must not look the same, and an exception here would
    // cost an answer the client's own history could still have given.
    await expect(store.loadWindow(USER_ID, CONVERSATION_ID)).resolves.toEqual({ degraded: true })
  })

  it("degrades for a conversation that is not the caller's, rather than return an empty window", async () => {
    const { store, calls } = storeWith({ conversation: null })

    await expect(store.loadWindow(USER_ID, CONVERSATION_ID)).resolves.toEqual({ degraded: true })
    expect(methods(calls)).toEqual(["conversationOwnedBy"])
  })
})

describe("transcript", () => {
  it("reads the tail for the owner, defaulting to 200 messages", async () => {
    const { store, calls } = storeWith({ conversation: CONVERSATION, messages: TURNS })

    await expect(store.transcript(USER_ID, CONVERSATION_ID)).resolves.toEqual(TURNS)
    await store.transcript(USER_ID, CONVERSATION_ID, 5)

    expect(calls).toEqual([
      { method: "conversationOwnedBy", args: [USER_ID, CONVERSATION_ID] },
      { method: "lastMessages", args: [USER_ID, CONVERSATION_ID, 200] },
      { method: "conversationOwnedBy", args: [USER_ID, CONVERSATION_ID] },
      { method: "lastMessages", args: [USER_ID, CONVERSATION_ID, 5] },
    ])
  })

  it("returns null for a conversation that is not the caller's and reads no messages", async () => {
    const { store, calls } = storeWith({ conversation: null })

    await expect(store.transcript(USER_ID, CONVERSATION_ID)).resolves.toBeNull()

    // The refusal comes before any message read, because that read is the one
    // that would cross users.
    expect(methods(calls)).toEqual(["conversationOwnedBy"])
  })
})

describe("list", () => {
  it("delegates to the port with the user's id, defaulting to 30 conversations", async () => {
    const { store, calls } = storeWith({ conversations: [CONVERSATION] })

    await expect(store.list(USER_ID)).resolves.toEqual([CONVERSATION])
    await store.list(USER_ID, 5)

    expect(calls).toEqual([
      { method: "listConversations", args: [USER_ID, 30] },
      { method: "listConversations", args: [USER_ID, 5] },
    ])
  })
})
