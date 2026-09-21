import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/lib/ai/gateway"
import type {
  Conversation,
  ConversationPatch,
  TranscriptPort,
  TranscriptTurn,
} from "@/lib/ai/conversations/port"
import { createTranscriptStore, VERBATIM_WINDOW } from "@/lib/ai/conversations/store"
import {
  buildSummaryMessages,
  clampSummary,
  createSummarizer,
  needsSummary,
  SUMMARY_CATCHUP_ROUNDS,
  SUMMARY_MAX_CHARS,
  SUMMARY_TRIGGER,
  type SummarizeFn,
} from "@/lib/ai/conversations/summary"

/**
 * The summariser is policy over the port: ownership, the window that keeps it
 * from summarising what the model still sees verbatim, the bounded catch-up
 * loop and the write. Everything is injected — the port is a recording fake,
 * the model is a stub, the clock never ticks (constraint 11) — so these tests
 * pin the calls it makes and the messages it builds, not just its answers.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

/** A 100-message transcript whose ids make a skipped message visible. */
const TRANSCRIPT: TranscriptTurn[] = Array.from({ length: 100 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  content: `message ${index}`,
  createdAt: NOW + index,
}))

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    userId: USER_ID,
    title: "Who is Haibara?",
    summary: null,
    summarizedThrough: 0,
    messageCount: 24,
    lastMessageAt: NOW,
    archivedAt: null,
    ...overrides,
  }
}

function sequence(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, offset) => from + offset)
}

interface RecordedCall {
  method: keyof TranscriptPort
  args: unknown[]
}

interface FakeScript {
  /** The conversation the ownership read finds; null is both "unknown" and "not yours". */
  conversation?: Conversation | null
  /** The one method that rejects with a dropped connection. */
  reject?: keyof TranscriptPort
}

/**
 * A recording stand-in for the port that also behaves like the answer: it keeps
 * the conversation row, so a write is visible to the next read. That is what
 * makes "the left-over tail is picked up next turn" testable without a second
 * script.
 */
function createFakePort(script: FakeScript = {}): {
  port: TranscriptPort
  calls: RecordedCall[]
  stored: Conversation | null
} {
  const calls: RecordedCall[] = []
  const stored: Conversation | null = script.conversation ?? null

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
      return stored
    },
    async recentConversation(userId, since) {
      record("recentConversation", [userId, since])
      guard("recentConversation")
      return null
    },
    async createConversation(row, now) {
      record("createConversation", [row, now])
      guard("createConversation")
      return conversation({ userId: row.userId, title: row.title, messageCount: 0 })
    },
    async updateConversation(userId, id, patch) {
      record("updateConversation", [userId, id, patch])
      guard("updateConversation")
      if (stored !== null && stored.id === id) Object.assign(stored, patch)
    },
    async lastMessages(userId, conversationId, limit) {
      record("lastMessages", [userId, conversationId, limit])
      guard("lastMessages")
      return []
    },
    async messagesRange(userId, conversationId, from, to) {
      record("messagesRange", [userId, conversationId, from, to])
      guard("messagesRange")
      // The slice an adapter would return for [from, to); a range that skipped a
      // row shows up as a missing id in the stub's input.
      return TRANSCRIPT.slice(from, to)
    },
    async appendMessages(userId, conversationId, turns, now) {
      record("appendMessages", [userId, conversationId, turns, now])
      guard("appendMessages")
    },
    async listConversations(userId, limit) {
      record("listConversations", [userId, limit])
      guard("listConversations")
      return []
    },
    async searchMessages(userId, query, limit) {
      record("searchMessages", [userId, query, limit])
      guard("searchMessages")
      return []
    },
  }

  return { port, calls, stored }
}

/**
 * A stand-in for the model. The last reply repeats, so a test only lists the
 * changes it cares about; an exhausted list and an explicit `null` both mean
 * "the provider failed", which is the `SummarizeFn` contract.
 */
function createFakeSummarize(replies: (string | null)[]): {
  summarize: SummarizeFn
  seen: ChatMessage[][]
} {
  const seen: ChatMessage[][] = []
  const summarize: SummarizeFn = async (messages) => {
    seen.push(messages)
    if (replies.length === 0) return null
    return replies[Math.min(seen.length - 1, replies.length - 1)]
  }
  return { summarize, seen }
}

function summarizerWith(script: FakeScript, replies: (string | null)[]) {
  const { port, calls, stored } = createFakePort(script)
  const { summarize, seen } = createFakeSummarize(replies)
  const logs: string[] = []
  const summarizer = createSummarizer({
    store: createTranscriptStore({ port, now: () => NOW }),
    port,
    summarize,
    now: () => NOW,
    log: (message) => logs.push(message),
  })
  return { summarizer, calls, seen, logs, stored }
}

function methods(calls: RecordedCall[]): (keyof TranscriptPort)[] {
  return calls.map((call) => call.method)
}

function rangesRequested(calls: RecordedCall[]): number[][] {
  return calls
    .filter((call) => call.method === "messagesRange")
    .map((call) => call.args.slice(2) as number[])
}

function updates(calls: RecordedCall[]): unknown[][] {
  return calls.filter((call) => call.method === "updateConversation").map((call) => call.args)
}

function marks(calls: RecordedCall[]): number[] {
  return updates(calls).map((args) => (args[2] as ConversationPatch).summarizedThrough as number)
}

function summaryWritten(calls: RecordedCall[], index: number): string {
  return (updates(calls)[index][2] as ConversationPatch).summary as string
}

/** The transcript indices a summarise call was shown, in the order it saw them. */
function turnIndices(messages: ChatMessage[]): number[] {
  const user = messages.find((message) => message.role === "user")
  return [...(user?.content ?? "").matchAll(/message (\d+)/g)].map((match) => Number(match[1]))
}

describe("needsSummary", () => {
  it("is due once SUMMARY_TRIGGER messages sit outside the window", () => {
    // 24 messages, 8 already summarised: exactly 8 are outside the 8-message
    // window, which is the threshold and therefore due.
    expect(needsSummary(24, 8)).toBe(true)
    expect(needsSummary(VERBATIM_WINDOW + SUMMARY_TRIGGER, 0)).toBe(true)
    expect(needsSummary(100, 0)).toBe(true)
    // One message short, and a mark already at the window's edge.
    expect(needsSummary(23, 8)).toBe(false)
    expect(needsSummary(100, 92)).toBe(false)
  })

  it("never summarises what the verbatim window still shows", () => {
    expect(needsSummary(VERBATIM_WINDOW, 0)).toBe(false)
    expect(needsSummary(VERBATIM_WINDOW - 3, 0)).toBe(false)
    expect(needsSummary(15, 0)).toBe(false)
  })
})

describe("buildSummaryMessages", () => {
  const turns: TranscriptTurn[] = [
    { id: "m1", role: "user", content: "Who is Haibara?", createdAt: NOW },
    { id: "m2", role: "assistant", content: "She is a scientist.", createdAt: NOW + 1 },
  ]

  it("asks for a rolling Detective Conan summary that invents nothing and stays inside the cap", () => {
    const messages = buildSummaryMessages({ previousSummary: null, turns })

    expect(messages.map((message) => message.role)).toEqual(["system", "user"])
    expect(messages[0].content).toMatch(/detective conan/i)
    expect(messages[0].content).toContain(String(SUMMARY_MAX_CHARS))
    expect(messages[0].content).toMatch(/never invent|do not invent/i)
    expect(messages[0].content).toMatch(/preference/i)
    expect(messages[0].content).toMatch(/question/i)
  })

  it("puts the labelled previous summary ahead of the new turns, in order", () => {
    const content = buildSummaryMessages({
      previousSummary: "They discussed Haibara.",
      turns,
    })[1].content

    expect(content).toMatch(/previous summary/i)
    expect(content).toContain("They discussed Haibara.")
    expect(content.indexOf("They discussed Haibara.")).toBeLessThan(
      content.indexOf("user: Who is Haibara?")
    )
    expect(content.indexOf("user: Who is Haibara?")).toBeLessThan(
      content.indexOf("assistant: She is a scientist.")
    )
  })

  it("omits the previous-summary label when there is none", () => {
    const content = buildSummaryMessages({ previousSummary: null, turns })[1].content

    expect(content).not.toMatch(/previous summary/i)
    expect(content).toContain("user: Who is Haibara?")
    expect(content).toContain("assistant: She is a scientist.")
  })

  it("renders a system turn by its role rather than dropping it", () => {
    const content = buildSummaryMessages({
      previousSummary: null,
      turns: [{ id: "m0", role: "system", content: "stay in character", createdAt: NOW }],
    })[1].content

    expect(content).toContain("system: stay in character")
  })
})

describe("clampSummary", () => {
  it("collapses whitespace and returns text inside the cap unchanged", () => {
    expect(clampSummary("  Haibara\n\nis\tnot   the culprit.  ")).toBe("Haibara is not the culprit.")

    const exact = "x".repeat(SUMMARY_MAX_CHARS)
    expect(clampSummary(exact)).toBe(exact)
    expect(clampSummary(exact)).not.toContain("…")
  })

  it("cuts on a word boundary and marks the cut with an ellipsis", () => {
    const words = Array.from({ length: 400 }, (_, index) => `word${index}`).join(" ")
    const clamped = clampSummary(words)
    const kept = clamped.slice(0, -1)

    expect(clamped.endsWith("…")).toBe(true)
    // The ellipsis is the marker, not part of the cap, and the kept text stops
    // where a space does — no half word reaches the model next turn.
    expect(kept.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
    expect(kept.length).toBeGreaterThan(0)
    expect(words.startsWith(`${kept} `)).toBe(true)
  })

  it("cuts at the cap when a single word is longer than it", () => {
    const word = "x".repeat(SUMMARY_MAX_CHARS + 500)
    expect(clampSummary(word)).toBe(`${"x".repeat(SUMMARY_MAX_CHARS)}…`)
  })
})

describe("maybeSummarize", () => {
  it("does nothing and calls no model while the region is still inside the window", async () => {
    const { summarizer, calls, seen } = summarizerWith(
      { conversation: conversation({ messageCount: 12, summarizedThrough: 8 }) },
      ["never"]
    )

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "not_due",
    })

    expect(seen).toHaveLength(0)
    expect(methods(calls)).toEqual(["conversationOwnedBy"])
  })

  it("refuses a conversation the caller does not own before reading a single message", async () => {
    const { summarizer, calls, seen } = summarizerWith({ conversation: null }, ["never"])

    await expect(summarizer.maybeSummarize(OTHER_USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 0,
      reason: "not_found",
    })

    // `ai_messages` has no user_id (D1), so a message read before the ownership
    // check is a cross-user read.
    expect(seen).toHaveLength(0)
    expect(methods(calls)).toEqual(["conversationOwnedBy"])
  })

  it("reads the region from its start and writes the summary with the advanced mark in one update", async () => {
    const { summarizer, calls } = summarizerWith(
      { conversation: conversation({ messageCount: 24, summarizedThrough: 8, summary: "Earlier." }) },
      ["A new digest."]
    )

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: true,
      summarizedThrough: 16,
    })

    // The read starts at the summary's edge, not at the newest 40 messages: a
    // region too long for one call loses nothing, it only takes another turn.
    expect(rangesRequested(calls)).toEqual([[8, 16]])
    expect(updates(calls)).toEqual([
      [USER_ID, CONVERSATION_ID, { summary: "A new digest.", summarizedThrough: 16 }],
    ])
  })

  it("stops after SUMMARY_CATCHUP_ROUNDS chunks, requests contiguous ranges and skips no message", async () => {
    const { summarizer, calls, seen } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 0 }) },
      ["first", "second"]
    )

    // The region is [0, 92); two rounds of 40 read [0, 80) and the tail waits
    // for the next turn rather than being dropped or read out of order.
    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: true,
      summarizedThrough: 80,
    })

    expect(rangesRequested(calls)).toEqual([
      [0, 40],
      [40, 80],
    ])
    expect(marks(calls)).toEqual([40, 80])
    expect(seen).toHaveLength(SUMMARY_CATCHUP_ROUNDS)
    expect(turnIndices(seen[0])).toEqual(sequence(0, 40))
    expect(turnIndices(seen[1])).toEqual(sequence(40, 80))
  })

  it("picks the left-over tail up on the next call and finishes the region", async () => {
    const { summarizer, calls, seen, stored } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 0 }) },
      ["first", "second", "third"]
    )

    await summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)
    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: true,
      summarizedThrough: 92,
    })

    expect(rangesRequested(calls)).toEqual([
      [0, 40],
      [40, 80],
      [80, 92],
    ])
    expect(turnIndices(seen[2])).toEqual(sequence(80, 92))
    expect(stored?.summarizedThrough).toBe(92)
  })

  it("gives each round what the previous round wrote, so the summary stays rolling", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `word${index}`).join(" ")
    const { summarizer, calls, seen } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 0 }) },
      [long, "second digest"]
    )

    await summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)

    const written = summaryWritten(calls, 0)
    // The second round starts from the stored text, clamped: what the model
    // carries forward is exactly what the database now holds.
    expect(written.endsWith("…")).toBe(true)
    expect(written.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 1)
    expect(seen[1][1].content).toMatch(/previous summary/i)
    expect(seen[1][1].content).toContain(written)
  })

  it("stops at a failed completion and reports the round it did finish", async () => {
    const { summarizer, calls } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 0 }) },
      ["first", null]
    )

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 40,
      reason: "summarize_failed",
    })

    // The first round is real progress; the failed second round writes nothing,
    // so the next turn re-reads [40, 92).
    expect(marks(calls)).toEqual([40])
  })

  it("treats a blank completion as empty and writes nothing", async () => {
    const { summarizer, calls } = summarizerWith(
      { conversation: conversation({ messageCount: 24, summarizedThrough: 8 }) },
      ["   \n  "]
    )

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "empty",
    })

    expect(updates(calls)).toHaveLength(0)
  })

  it("stops on an empty read rather than advance the mark over messages it never saw", async () => {
    const { port } = createFakePort({
      conversation: conversation({ messageCount: 24, summarizedThrough: 8 }),
    })
    const logs: string[] = []
    const summarizer = createSummarizer({
      store: createTranscriptStore({ port, now: () => NOW }),
      port: { ...port, messagesRange: async () => [] },
      summarize: async () => "never",
      log: (message) => logs.push(message),
    })

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "empty",
    })
    expect(logs).toHaveLength(0)
  })

  it("moves the mark forward only, never below what the conversation already had", async () => {
    const { summarizer, calls, stored } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 30 }) },
      ["first", "second"]
    )

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: true,
      summarizedThrough: 92,
    })

    expect(marks(calls)).toEqual([70, 92])
    expect(Math.min(...marks(calls))).toBeGreaterThanOrEqual(30)
    expect(stored?.summarizedThrough).toBe(92)
  })

  it("carries the user's id and the conversation id on every port call", async () => {
    const { summarizer, calls } = summarizerWith(
      { conversation: conversation({ messageCount: 100, summarizedThrough: 0 }) },
      ["first", "second"]
    )

    await summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)

    expect(calls.every((call) => call.args[0] === USER_ID)).toBe(true)
    expect(
      calls.every((call) => call.method === "conversationOwnedBy" || call.args[1] === CONVERSATION_ID)
    ).toBe(true)
  })

  it("turns a port rejection into an error result and one log line, never a throw", async () => {
    const read = summarizerWith(
      { conversation: conversation({ messageCount: 24, summarizedThrough: 8 }), reject: "messagesRange" },
      ["never"]
    )
    await expect(read.summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "error",
    })
    expect(read.logs).toHaveLength(1)
    expect(read.logs[0]).toContain("[ai-summary]")
    expect(updates(read.calls)).toHaveLength(0)

    // A write that fails is not progress: the mark stays where the last
    // confirmed write left it, so the next turn re-reads the same region.
    const write = summarizerWith(
      { conversation: conversation({ messageCount: 24, summarizedThrough: 8 }), reject: "updateConversation" },
      ["digest"]
    )
    await expect(write.summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "error",
    })
    expect(write.logs).toHaveLength(1)

    // The ownership read can fail too, before any mark is known.
    const resolve = summarizerWith(
      { conversation: conversation({ messageCount: 24, summarizedThrough: 8 }), reject: "conversationOwnedBy" },
      ["never"]
    )
    await expect(resolve.summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 0,
      reason: "error",
    })
    expect(resolve.logs[0]).toContain("[ai-summary]")
  })

  it("survives a model call that throws instead of returning null", async () => {
    const { port } = createFakePort({
      conversation: conversation({ messageCount: 24, summarizedThrough: 8 }),
    })
    const logs: string[] = []
    const summarizer = createSummarizer({
      store: createTranscriptStore({ port, now: () => NOW }),
      port,
      summarize: async () => {
        throw new Error("provider exploded")
      },
      log: (message) => logs.push(message),
    })

    await expect(summarizer.maybeSummarize(USER_ID, CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      summarizedThrough: 8,
      reason: "summarize_failed",
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("[ai-summary]")
  })
})
