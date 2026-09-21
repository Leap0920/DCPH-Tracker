/**
 * The recall matcher, the answer renderer, and the persistence seam's
 * `recallAnswer()`.
 *
 * The matcher is the one place in this feature where a false positive is worse
 * than a miss: the chat route turns a match into a direct answer, so matching
 * "what do you remember about episode 5" would hijack a tracker question. The
 * lists below are therefore deliberately lopsided -- every domain shape the
 * tracker answers is a negative, and the only positives are phrasings where the
 * user is the object of the question.
 *
 * The seam is exercised through a scripted admin client (constraint 10: no test
 * constructs a real Supabase client), with the memory writer mocked because
 * `recallAnswer` never reaches it and its own contract is pinned elsewhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MemoryFact } from "@/lib/ai/memory/port"
import { renderMemoryAnswer, isMemoryRecallQuestion } from "@/lib/ai/memory/recall"

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const run = vi.fn()
vi.mock("@/lib/ai/memory/write", () => ({
  createMemoryWriter: () => ({ run }),
}))

import { createRequestPersistence } from "@/lib/chat/persistence"

/** Every phrasing whose object is the user, in the shapes the widget sees. */
const POSITIVES = [
  "what do you remember about me",
  "what do you know about me",
  "my memories",
  "what have you remembered",
  "show my memories",
  "do you remember anything about me",
  "what do you know about me so far?",
  "tell me what you remember about me",
  "do you remember me",
  "can you show me my memories?",
  "what memories do you have about me",
  "What do you remember about me?",
]

/**
 * Questions that belong to the tracker, the corpus or the model. Each of these
 * must reach retrieval: the branch answers from a memory table and would
 * otherwise return a list where the user asked about the series.
 */
const DOMAIN_NEGATIVES = [
  "what do you remember about episode 5",
  "what do you know about Haibara",
  "do you remember the Vermouth arc",
  "what do you remember about the movie with the sunflowers",
  "what do you know about the case with the locked room",
  "do you remember the gadget Conan used in the first movie",
  "what do you remember about Kaito Kid",
  "what do you know about my favorite character?",
  "do you know what episode I'm on?",
  "do you remember what episode I'm on?",
  "my memories of episode 5",
]

/** A memory question with no object at all names nothing to list. */
const OBJECTLESS_NEGATIVES = [
  "what do you remember",
  "do you remember?",
  "what do you know",
  "do you recall anything",
  "what do you remember about it",
]

const NON_QUESTIONS = ["", "   ", "hi", "how are you?"]

const USER_ID = "11111111-1111-4111-8111-111111111111"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const NOW_ISO = "2026-09-19T10:00:00.000Z"

const CONVERSATION_ROW: Record<string, unknown> = {
  id: CONVERSATION_ID,
  user_id: USER_ID,
  title: null,
  summary: null,
  summarized_through: 0,
  message_count: 0,
  last_message_at: NOW_ISO,
  archived_at: null,
}

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    user_id: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.9,
    status: "active",
    superseded_by: null,
    source_message_id: null,
    evidence_count: 1,
    last_confirmed_at: NOW_ISO,
    expires_at: null,
    ...overrides,
  }
}

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.9,
    status: "active",
    supersededBy: null,
    sourceMessageId: null,
    evidenceCount: 1,
    lastConfirmedAt: NOW,
    expiresAt: null,
    ...overrides,
  }
}

interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeQuery {
  eq(column: string, value: unknown): FakeQuery
  is(column: string, value: unknown): FakeQuery
  gte(column: string, value: unknown): FakeQuery
  order(column: string, options: unknown): FakeQuery
  limit(count: number): FakeQuery
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
  then(
    onFulfilled: (value: {
      data: Record<string, unknown>[] | null
      error: { message: string } | null
    }) => unknown,
    onRejected: (reason: unknown) => unknown
  ): unknown
}

interface FakeAdmin {
  calls: RecordedCall[]
  from(table: string): { select(columns: string): FakeQuery }
}

/**
 * The smallest admin client the memory read and the conversation lookup need,
 * and a log of what was asked of it: "no database call" is only assertable
 * because every call is recorded here.
 */
function createFakeAdmin(script: { facts?: Record<string, unknown>[] | null } = {}): FakeAdmin {
  const calls: RecordedCall[] = []

  function query(table: string): FakeQuery {
    const chain: FakeQuery = {
      then(onFulfilled, onRejected) {
        const data = table === "ai_user_memories" ? (script.facts ?? null) : null
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
      eq(column, value) {
        calls.push({ table, method: "eq", args: [column, value] })
        return chain
      },
      is(column, value) {
        calls.push({ table, method: "is", args: [column, value] })
        return chain
      },
      gte(column, value) {
        calls.push({ table, method: "gte", args: [column, value] })
        return chain
      },
      order(column, options) {
        calls.push({ table, method: "order", args: [column, options] })
        return chain
      },
      limit(count) {
        calls.push({ table, method: "limit", args: [count] })
        return chain
      },
      maybeSingle() {
        calls.push({ table, method: "maybeSingle", args: [] })
        return Promise.resolve({
          data: table === "ai_conversations" ? CONVERSATION_ROW : null,
          error: null,
        })
      },
    }
    return chain
  }

  return {
    calls,
    from(table) {
      return {
        select(columns) {
          calls.push({ table, method: "select", args: [columns] })
          return query(table)
        },
      }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AI_MEMORY
  run.mockResolvedValue({})
})

afterEach(() => {
  delete process.env.AI_MEMORY
})

describe("isMemoryRecallQuestion", () => {
  it("matches questions whose object is the user", () => {
    for (const text of POSITIVES) {
      expect(isMemoryRecallQuestion(text), `should match: ${text}`).toBe(true)
    }
  })

  it("rejects every question that names a tracker noun", () => {
    for (const text of DOMAIN_NEGATIVES) {
      expect(isMemoryRecallQuestion(text), `should not match: ${text}`).toBe(false)
    }
  })

  it("rejects a memory question with no object", () => {
    for (const text of OBJECTLESS_NEGATIVES) {
      expect(isMemoryRecallQuestion(text), `should not match: ${text}`).toBe(false)
    }
  })

  it("rejects empty input and ordinary conversation", () => {
    for (const text of NON_QUESTIONS) {
      expect(isMemoryRecallQuestion(text), `should not match: ${text}`).toBe(false)
    }
  })
})

describe("renderMemoryAnswer", () => {
  it("groups active facts by kind in MEMORY_KINDS order", () => {
    const answer = renderMemoryAnswer([
      fact({ id: "f1", kind: "progress", key: "watch_progress", value: "episode 500" }),
      fact({ id: "f2", kind: "interest", key: "community_interest", value: "arc rankings" }),
      fact({ id: "f3", kind: "preference", key: "favorite_character", value: "Haibara" }),
    ])

    const preference = answer.indexOf("Preferences")
    const progress = answer.indexOf("Progress")
    const interest = answer.indexOf("Interests")
    expect(preference).toBeGreaterThan(-1)
    expect(preference).toBeLessThan(progress)
    expect(progress).toBeLessThan(interest)
    // A kind with no facts gets no heading and no empty section.
    expect(answer).not.toContain("Identity")
    expect(answer).not.toContain("Constraints")
  })

  it("lists the newest confirmation first inside a group", () => {
    const answer = renderMemoryAnswer([
      fact({ id: "old", value: "the old one", lastConfirmedAt: NOW - 86_400_000 }),
      fact({ id: "new", value: "the new one", lastConfirmedAt: NOW }),
    ])

    expect(answer.indexOf("the new one")).toBeLessThan(answer.indexOf("the old one"))
  })

  it("shows the confidence rounded to two decimals", () => {
    const answer = renderMemoryAnswer([
      fact({ id: "a", value: "Haibara", confidence: 0.9 }),
      fact({ id: "b", key: "answer_style", value: "short", confidence: 0.876 }),
    ])

    expect(answer).toContain("(confidence 0.90)")
    expect(answer).toContain("(confidence 0.88)")
  })

  it("renders no superseded or expired fact", () => {
    const answer = renderMemoryAnswer([
      fact({ id: "a", value: "still true", status: "active" }),
      fact({ id: "b", value: "replaced long ago", status: "superseded" }),
      fact({ id: "c", key: "watch_progress", value: "expired shelf life", status: "expired" }),
    ])

    expect(answer).toContain("still true")
    expect(answer).not.toContain("replaced long ago")
    expect(answer).not.toContain("expired shelf life")
    // One line per active fact: nothing is invented and nothing is repeated.
    expect(answer.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1)
  })

  it("does not mutate the facts it was handed", () => {
    const facts = [
      fact({ id: "old", value: "older", lastConfirmedAt: NOW - 1 }),
      fact({ id: "new", value: "newer", lastConfirmedAt: NOW }),
    ]
    const order = facts.map((f) => f.id)

    renderMemoryAnswer(facts)

    expect(facts.map((f) => f.id)).toEqual(order)
  })

  it("says nothing is stored yet, how facts are learned, and how to remove one", () => {
    const answer = renderMemoryAnswer([])

    expect(answer).toMatch(/do not have anything remembered/i)
    expect(answer).toMatch(/conversation/i)
    expect(answer).toMatch(/delete/i)
    // An empty list is never rendered as a plan: no "you can ask me" invention.
    expect(answer).not.toContain("- ")
  })
})

describe("RequestPersistence.recallAnswer", () => {
  it("renders the user's active facts for the signed-in user", async () => {
    const admin = createFakeAdmin({
      facts: [factRow(), factRow({ id: "f2", value: "the old favorite", status: "superseded" })],
    })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      now: () => NOW,
    })
    const answer = await seam?.recallAnswer()

    expect(answer).toContain("Haibara")
    expect(answer).not.toContain("the old favorite")
    // The ownership predicate is what keeps one user's facts out of another's
    // answer; the seam cannot read without it.
    expect(admin.calls.some((call) => call.method === "eq" && call.args[0] === "user_id")).toBe(true)
  })

  it("answers nothing and reads nothing when AI_MEMORY is off", async () => {
    process.env.AI_MEMORY = "off"
    const admin = createFakeAdmin({ facts: [factRow()] })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      now: () => NOW,
    })

    await expect(seam?.recallAnswer()).resolves.toBe("")
    expect(admin.calls.some((call) => call.table === "ai_user_memories")).toBe(false)
  })

  it("answers the empty statement for a user with no facts", async () => {
    const admin = createFakeAdmin({ facts: [] })
    createAdminClient.mockReturnValue(admin)

    const seam = await createRequestPersistence({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      now: () => NOW,
    })

    await expect(seam?.recallAnswer()).resolves.toMatch(/do not have anything remembered/i)
  })
})
