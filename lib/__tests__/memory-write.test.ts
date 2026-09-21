/**
 * The writer is the one entry point for the work that happens after a response
 * has been handed to the client, so most of what these tests pin is what it does
 * *not* do: the three turns in four that must cost nothing, the empty window
 * that must not reach the model, and the three ways a stage can fail without
 * taking the others down with it.
 *
 * Every dependency is a hand-written fake (constraint 11): the model call, the
 * transcript store, the transcript port, the memory port and the summariser's
 * completion are all injected, and the clock is the injected `now`. The fakes
 * share one `events` timeline, so "extract, consolidate, then summarise" is
 * asserted as an order rather than as three separate facts.
 */

import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/lib/ai/gateway"
import type { SummarizeFn } from "@/lib/ai/conversations/summary"
import { VERBATIM_WINDOW, type TranscriptStore } from "@/lib/ai/conversations/store"
import type {
  Conversation,
  ConversationPatch,
  TranscriptPort,
  TranscriptTurn,
} from "@/lib/ai/conversations/port"
import type { MemoryCandidate } from "@/lib/ai/memory/extract"
import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"
import type { StructuredCall, StructuredRequest } from "@/lib/ai/structured"
import { MEMORY_WRITE_EVERY, createMemoryWriter, type WriteInput } from "@/lib/ai/memory/write"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const NOW = Date.parse("2026-09-19T10:00:00.000Z")

/** The answer a due run would summarise; long enough to keep, short enough to store. */
const SUMMARY_REPLY = "The user is watching episode 3 and likes Haibara."

function turn(index: number): TranscriptTurn {
  return {
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    createdAt: NOW + index,
  }
}

function transcript(count: number): TranscriptTurn[] {
  return Array.from({ length: count }, (_, index) => turn(index))
}

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return { kind: "preference", key: "favorite_character", value: "Haibara", confidence: 0.9, ...overrides }
}

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: "f1",
    userId: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.7,
    status: "active",
    supersededBy: null,
    sourceMessageId: null,
    evidenceCount: 1,
    lastConfirmedAt: NOW,
    expiresAt: null,
    ...overrides,
  }
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    userId: USER_ID,
    title: "Who is Haibara?",
    summary: null,
    summarizedThrough: 0,
    messageCount: 4,
    lastMessageAt: NOW,
    archivedAt: null,
    ...overrides,
  }
}

interface RecordedCall {
  method: string
  args: unknown[]
}

function createMemoryPort(options: {
  events: string[]
  rows: MemoryFact[]
  reject?: keyof MemoryPort
}): {
  port: MemoryPort
  calls: RecordedCall[]
  inserts: { userId: string; fact: NewFact; now: number }[]
} {
  const calls: RecordedCall[] = []
  const inserts: { userId: string; fact: NewFact; now: number }[] = []
  const rows = options.rows.map((row) => ({ ...row }))
  let nextId = rows.length + 1

  const record = (method: keyof MemoryPort, args: unknown[]): void => {
    calls.push({ method, args })
    options.events.push(`memory:${method}`)
    if (options.reject === method) throw new Error(`${method} rejected`)
  }

  const active = (userId: string): MemoryFact[] =>
    rows.filter((row) => row.status === "active" && row.userId === userId)

  const port: MemoryPort = {
    async loadActive(userId) {
      record("loadActive", [userId])
      return active(userId).map((row) => ({ ...row }))
    },
    async countActive(userId) {
      record("countActive", [userId])
      return active(userId).length
    },
    async insert(userId, newFact, now) {
      record("insert", [userId, newFact, now])
      inserts.push({ userId, fact: newFact, now })
      const created: MemoryFact = {
        id: `new-${nextId++}`,
        userId,
        kind: newFact.kind,
        key: newFact.key,
        value: newFact.value,
        confidence: newFact.confidence,
        status: "active",
        supersededBy: null,
        sourceMessageId: newFact.sourceMessageId,
        evidenceCount: 1,
        lastConfirmedAt: now,
        expiresAt: newFact.expiresAt,
      }
      rows.push(created)
      return { ...created }
    },
    async update(userId, id, patch, now) {
      record("update", [userId, id, patch, now])
      const row = rows.find((entry) => entry.id === id)
      if (row !== undefined) Object.assign(row, patch)
    },
    async supersede(userId, oldId, replacement, now) {
      record("supersede", [userId, oldId, replacement, now])
      const old = rows.find((entry) => entry.id === oldId)
      if (old !== undefined) {
        old.status = "superseded"
        old.supersededBy = `new-${nextId}`
      }
      // Written out rather than shared with insert(): this fake records the
      // calls it received, and a helper would hide which one was called.
      const created: MemoryFact = {
        id: `new-${nextId++}`,
        userId,
        kind: replacement.kind,
        key: replacement.key,
        value: replacement.value,
        confidence: replacement.confidence,
        status: "active",
        supersededBy: null,
        sourceMessageId: replacement.sourceMessageId,
        evidenceCount: 1,
        lastConfirmedAt: now,
        expiresAt: replacement.expiresAt,
      }
      rows.push(created)
      return { ...created }
    },
    async list(userId, limit) {
      record("list", [userId, limit])
      return []
    },
    async delete(userId, id) {
      record("delete", [userId, id])
      return false
    },
  }

  return { port, calls, inserts }
}

/**
 * The store the writer builds its summariser with. Only `resolve` is exercised —
 * the writer never reads the window itself, because the caller already has it —
 * so the other methods fail loudly rather than pretending to answer.
 */
function createStore(options: { events: string[]; conversation: Conversation }): {
  store: TranscriptStore
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []

  const store: TranscriptStore = {
    async resolve(input) {
      calls.push({ method: "resolve", args: [input] })
      options.events.push("store:resolve")
      return { conversation: options.conversation, created: false }
    },
    async appendUserTurn() {
      throw new Error("the writer must not append turns")
    },
    async loadWindow() {
      throw new Error("the writer reads the window the caller already loaded")
    },
    async list() {
      return []
    },
    async transcript() {
      return null
    },
  }

  return { store, calls }
}

function createPort(options: { events: string[]; turns: TranscriptTurn[] }): {
  port: TranscriptPort
  calls: RecordedCall[]
  updates: { userId: string; id: string; patch: ConversationPatch }[]
} {
  const calls: RecordedCall[] = []
  const updates: { userId: string; id: string; patch: ConversationPatch }[] = []

  const port: TranscriptPort = {
    async conversationOwnedBy() {
      throw new Error("the summariser resolves through the store")
    },
    async recentConversation() {
      throw new Error("the writer must not resolve conversations")
    },
    async createConversation() {
      throw new Error("the writer must not create conversations")
    },
    async updateConversation(userId, id, patch) {
      calls.push({ method: "updateConversation", args: [userId, id, patch] })
      options.events.push("port:updateConversation")
      updates.push({ userId, id, patch })
    },
    async lastMessages() {
      throw new Error("the writer must not read the window")
    },
    async messagesRange(userId, conversationId, from, to) {
      calls.push({ method: "messagesRange", args: [userId, conversationId, from, to] })
      options.events.push("port:messagesRange")
      return options.turns.slice(from, to)
    },
    async appendMessages() {
      throw new Error("the writer must not append messages")
    },
    async listConversations() {
      throw new Error("the writer must not list conversations")
    },
    async searchMessages() {
      throw new Error("the writer must not search")
    },
  }

  return { port, calls, updates }
}

function createSummarize(options: { events: string[]; reply: string | null }): {
  summarize: SummarizeFn
  seen: ChatMessage[][]
} {
  const seen: ChatMessage[][] = []
  const summarize: SummarizeFn = async (messages) => {
    options.events.push("summarize")
    seen.push(messages)
    return options.reply
  }
  return { summarize, seen }
}

interface Script {
  messageCount?: number
  /** The L1 window the caller already loaded; defaults to one window's worth. */
  turns?: TranscriptTurn[]
  summary?: string | null
  sourceMessageId?: string | null
  candidates?: MemoryCandidate[] | "throw"
  strict?: boolean
  /** What the summariser's completion answers; null is the provider failing. */
  summaryReply?: string | null
  conversation?: Partial<Conversation>
  rows?: MemoryFact[]
  rejectMemory?: keyof MemoryPort
}

/**
 * One scripted run. The pieces the assertions need — the extraction requests,
 * the memory writes, the store reads, the timeline — all come back as handles,
 * so a test reads as the story of one turn.
 */
function harness(script: Script = {}) {
  const events: string[] = []
  const logs: string[] = []
  const requests: StructuredRequest[] = []
  const messageCount = script.messageCount ?? 4
  const candidates = script.candidates === "throw" ? [] : script.candidates ?? []

  const call: StructuredCall = async (request) => {
    events.push("extract")
    requests.push(request)
    if (script.candidates === "throw") throw new Error("provider exploded")
    return { text: JSON.stringify({ candidates }), finishReason: "stop" }
  }

  const memory = createMemoryPort({ events, rows: script.rows ?? [], reject: script.rejectMemory })
  const store = createStore({
    events,
    conversation: conversation({ ...script.conversation, messageCount }),
  })
  // Sixteen stored turns, so the summariser's own reads have a transcript to
  // slice and its ranges are not empty by accident.
  const port = createPort({ events, turns: transcript(16) })
  // `undefined` means "no opinion"; an explicit null is the provider failing,
  // and `??` would swallow it into the default.
  const summarize = createSummarize({
    events,
    reply: script.summaryReply === undefined ? SUMMARY_REPLY : script.summaryReply,
  })

  const writer = createMemoryWriter({
    store: store.store,
    port: port.port,
    memory: memory.port,
    call,
    strict: script.strict ?? true,
    summarize: summarize.summarize,
    now: () => NOW,
    log: (message) => logs.push(message),
  })

  const input: WriteInput = {
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    messageCount,
    sourceMessageId: script.sourceMessageId ?? null,
    turns: script.turns ?? transcript(messageCount),
    summary: script.summary ?? null,
  }

  return { writer, input, events, logs, requests, memory, store, port, summarize }
}

describe("createMemoryWriter", () => {
  it("extracts every fourth turn", async () => {
    expect(MEMORY_WRITE_EVERY).toBe(4)

    for (const messageCount of [4, 8, 12]) {
      const h = harness({ messageCount, candidates: [candidate()] })
      const report = await h.writer.run(h.input)

      expect(h.requests, `messageCount ${messageCount}`).toHaveLength(1)
      expect(report.extracted).toBe(1)
      expect(report.added).toBe(1)
      expect(h.memory.inserts).toHaveLength(1)
    }
  })

  it("costs nothing on the three turns in between: no model call and no summary work", async () => {
    for (const messageCount of [5, 6, 7]) {
      const h = harness({ messageCount, candidates: [candidate()] })
      const report = await h.writer.run(h.input)

      // The whole report, so the shape is pinned as well as the counts: a caller
      // logs this object without optional-chaining.
      expect(report, `messageCount ${messageCount}`).toEqual({
        extracted: 0,
        added: 0,
        updated: 0,
        superseded: 0,
        skipped: 0,
        summarized: false,
        reason: "not_due",
      })
      expect(h.requests).toEqual([])
      expect(h.memory.calls).toEqual([])
      expect(h.store.calls).toEqual([])
      expect(h.port.calls).toEqual([])
      expect(h.summarize.seen).toEqual([])
    }
  })

  it("extracts, consolidates and then summarises, in that order", async () => {
    const h = harness({ messageCount: 16, candidates: [candidate()], sourceMessageId: "m40" })
    const report = await h.writer.run(h.input)

    expect(h.events).toEqual([
      "extract",
      "memory:loadActive",
      "memory:countActive",
      "memory:insert",
      "store:resolve",
      "port:messagesRange",
      "summarize",
      "port:updateConversation",
    ])
    expect(report).toEqual({
      extracted: 1,
      added: 1,
      updated: 0,
      superseded: 0,
      skipped: 0,
      summarized: true,
    })
    // No `reason` on a clean run: the field is for a caller that needs to know
    // why a turn did less than the full job.
    expect(Object.keys(report).sort()).toEqual([
      "added",
      "extracted",
      "skipped",
      "summarized",
      "superseded",
      "updated",
    ])
  })

  it("reports the consolidation verdicts next to the extraction count", async () => {
    const h = harness({
      messageCount: 4,
      rows: [fact({ id: "f1", key: "favorite_character", value: "Haibara" })],
      candidates: [
        candidate({ key: "favorite_character", value: "haibara" }),
        candidate({ key: "favorite_movie", value: "Movie 6", confidence: 0.8 }),
        candidate({ key: "favorite_arc", value: "Vermouth arc", confidence: 0.4 }),
      ],
    })

    const report = await h.writer.run(h.input)

    // One confirmed fact, one new slot, one candidate below the floor.
    expect(report).toEqual({
      extracted: 3,
      added: 1,
      updated: 1,
      superseded: 0,
      skipped: 1,
      summarized: false,
    })
  })

  it("passes the user and the source message through to the write", async () => {
    const h = harness({ messageCount: 4, sourceMessageId: "m42", candidates: [candidate()] })

    await h.writer.run(h.input)

    expect(h.memory.inserts).toHaveLength(1)
    expect(h.memory.inserts[0].userId).toBe(USER_ID)
    expect(h.memory.inserts[0].fact.sourceMessageId).toBe("m42")
  })

  it("treats a summary that is not due as silence, not as a failure", async () => {
    const h = harness({ messageCount: 4, candidates: [candidate()] })
    const report = await h.writer.run(h.input)

    // Four messages: the summariser is asked and answers "not due" itself.
    expect(h.store.calls).toHaveLength(1)
    expect(h.summarize.seen).toEqual([])
    expect(report.summarized).toBe(false)
    expect(report.reason).toBeUndefined()
    expect(h.logs).toEqual([])
  })

  it("skips extraction when the caller has no window, without a model call", async () => {
    const h = harness({ messageCount: 4, turns: [], candidates: [candidate()] })
    const report = await h.writer.run(h.input)

    expect(report).toEqual({
      extracted: 0,
      added: 0,
      updated: 0,
      superseded: 0,
      skipped: 0,
      summarized: false,
      reason: "no_turns",
    })
    expect(h.requests).toEqual([])
    expect(h.memory.calls).toEqual([])
    // The summary is not the window's business: it covers turns the window no
    // longer shows, and the summariser owns the decision to spend a call.
    expect(h.store.calls).toHaveLength(1)
    expect(h.summarize.seen).toEqual([])
  })

  it("contains a throwing extraction and still runs the summary", async () => {
    const h = harness({ messageCount: 16, candidates: "throw" })
    const report = await h.writer.run(h.input)

    expect(report).toEqual({
      extracted: 0,
      added: 0,
      updated: 0,
      superseded: 0,
      skipped: 0,
      summarized: true,
      reason: "provider exploded",
    })
    expect(h.requests).toHaveLength(1)
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0].startsWith("[ai-memory]")).toBe(true)
    expect(h.logs[0]).toContain("provider exploded")
  })

  it("contains a rejected memory port, keeping what extraction found, and logs once", async () => {
    const h = harness({
      messageCount: 16,
      candidates: [candidate(), candidate({ key: "favorite_movie", value: "Movie 6" })],
      rejectMemory: "loadActive",
    })
    const report = await h.writer.run(h.input)

    expect(report).toEqual({
      extracted: 2,
      added: 0,
      updated: 0,
      superseded: 0,
      skipped: 0,
      summarized: true,
    })
    expect(h.memory.inserts).toEqual([])
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0].startsWith("[ai-memory]")).toBe(true)
    expect(h.logs[0]).toContain("loadActive rejected")
  })

  it("keeps the counts already earned when the summary fails", async () => {
    const h = harness({ messageCount: 16, candidates: [candidate()], summaryReply: null })
    const report = await h.writer.run(h.input)

    expect(report).toEqual({
      extracted: 1,
      added: 1,
      updated: 0,
      superseded: 0,
      skipped: 0,
      summarized: false,
      reason: "summarize_failed",
    })
    expect(h.memory.inserts).toHaveLength(1)
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0].startsWith("[ai-memory]")).toBe(true)
    expect(h.logs[0]).toContain("summarize_failed")
  })

  it("sends the last window of turns plus the summary, never the whole transcript", async () => {
    const h = harness({
      messageCount: 12,
      turns: transcript(12),
      summary: "The user is watching episode 3.",
      candidates: [candidate()],
    })

    await h.writer.run(h.input)

    const content = h.requests[0].messages[1].content
    expect(content).toContain("The user is watching episode 3.")
    expect(content).toContain(`message ${12 - VERBATIM_WINDOW}`)
    expect(content).toContain("message 11")
    expect(content).not.toContain(`message ${12 - VERBATIM_WINDOW - 1}`)
    expect(h.requests[0].mode).toBe("strict")
  })

  it("forwards a non-strict binding, so a target without constrained decoding still works", async () => {
    const h = harness({ messageCount: 4, strict: false, candidates: [candidate()] })

    await h.writer.run(h.input)

    expect(h.requests[0].mode).toBe("json_object")
    expect(h.requests[0].schema).toBeNull()
  })

  it("never reads AI_MEMORY: the caller owns the kill switch", async () => {
    const previous = process.env.AI_MEMORY
    process.env.AI_MEMORY = "off"
    try {
      const h = harness({ messageCount: 4, candidates: [candidate()] })
      const report = await h.writer.run(h.input)

      // Off is the caller's decision to skip the writer entirely, not a second
      // switch this module consults — otherwise its behaviour would depend on
      // the environment it happens to run in.
      expect(report.extracted).toBe(1)
      expect(h.memory.inserts).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.AI_MEMORY
      else process.env.AI_MEMORY = previous
    }
  })
})
