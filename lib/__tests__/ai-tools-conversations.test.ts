import { describe, expect, it } from "vitest"
import type { TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import { PLAN_TOOLS } from "@/lib/ai/pipeline/plan"
import { createStaticSource } from "@/lib/ai/retrieval/source"
import {
  DEFAULT_CONVERSATION_HITS,
  MAX_MESSAGE_BODY_CHARS,
  searchConversations,
  type ConversationSearchContext,
} from "@/lib/ai/tools/search-conversations"
import { TOOL_NAMES, runTools, type ToolContext, type ToolRequest } from "@/lib/ai/tools"

/**
 * `search_conversations` is the one tool whose evidence is the user's own
 * history, so three properties travel with it and none of them is visible from
 * the return value alone:
 *
 * 1. `userId` is on every port call. `ai_messages` has no `user_id` column, so
 *    the port's ownership predicate is the whole cross-user guard: a tool that
 *    fetched by conversation id alone would answer with someone else's history.
 * 2. The body is capped. The assembler evicts whole documents, so one long
 *    assistant turn would push corpus evidence out of the budget — this module
 *    is where that is prevented, not the assembler.
 * 3. Unconfigured is a failure, not an empty answer. `{ ok: false }` shows up in
 *    the execution report; a silent `[]` would hide a wiring bug forever.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_CONVERSATION_ID = "44444444-4444-4444-8444-444444444444"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

const TURNS: TranscriptTurn[] = [
  {
    id: "m2",
    role: "assistant",
    content: "Episode 500 is canon; we settled on it last week.",
    createdAt: NOW,
    conversationId: CONVERSATION_ID,
  },
  {
    id: "m1",
    role: "user",
    content: "what did we say about episode 500?",
    createdAt: NOW - 60_000,
    conversationId: OTHER_CONVERSATION_ID,
  },
]

interface RecordedCall {
  method: keyof TranscriptPort
  args: unknown[]
}

interface FakeScript {
  turns?: TranscriptTurn[]
  /** A dropped connection: `searchMessages` rejects instead of answering. */
  reject?: Error
}

/**
 * A recording stand-in for the port. Every method logs its arguments, so a test
 * can assert the ownership id that rode along with the search. No network, no
 * database (constraint 13).
 */
function createFakePort(script: FakeScript = {}): { port: TranscriptPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []

  function record(method: keyof TranscriptPort, args: unknown[]): void {
    calls.push({ method, args })
  }

  const port: TranscriptPort = {
    async conversationOwnedBy(userId, conversationId) {
      record("conversationOwnedBy", [userId, conversationId])
      return null
    },
    async recentConversation(userId, since) {
      record("recentConversation", [userId, since])
      return null
    },
    async createConversation(row, now) {
      record("createConversation", [row, now])
      throw new Error("createConversation is not reachable from the tool")
    },
    async updateConversation(userId, id, patch) {
      record("updateConversation", [userId, id, patch])
    },
    async lastMessages(userId, conversationId, limit) {
      record("lastMessages", [userId, conversationId, limit])
      return []
    },
    async messagesRange(userId, conversationId, from, to) {
      record("messagesRange", [userId, conversationId, from, to])
      return []
    },
    async appendMessages(userId, conversationId, turns, now) {
      record("appendMessages", [userId, conversationId, turns, now])
    },
    async listConversations(userId, limit) {
      record("listConversations", [userId, limit])
      return []
    },
    async searchMessages(userId, query, limit) {
      record("searchMessages", [userId, query, limit])
      if (script.reject) throw script.reject
      return script.turns ?? []
    },
  }

  return { port, calls }
}

function context(script: FakeScript = {}): {
  ctx: ConversationSearchContext
  calls: RecordedCall[]
} {
  const { port, calls } = createFakePort(script)
  return { ctx: { port, userId: USER_ID }, calls }
}

/**
 * The registry context for a configured tool. The corpus half is never reached
 * by this tool, so an empty static source and an empty wiki cache are enough.
 */
function toolContext(ctx: ConversationSearchContext): ToolContext {
  return {
    source: createStaticSource([]),
    wiki: { async lookup() { return [] }, async put() {} },
    conversations: ctx,
  }
}

function request(args: Record<string, unknown>): ToolRequest {
  return { name: "search_conversations", args }
}

describe("searchConversations", () => {
  it("searches the caller's own messages, with the query and the default limit", async () => {
    const { ctx, calls } = context({ turns: TURNS })

    const hits = await searchConversations("episode 500", ctx)

    // The ownership id is the security property, not a detail: without it the
    // search spans every user's history.
    expect(calls).toEqual([
      { method: "searchMessages", args: [USER_ID, "episode 500", DEFAULT_CONVERSATION_HITS] },
    ])
    expect(hits.map((hit) => hit.doc.id)).toEqual(["message:m2", "message:m1"])
  })

  it("passes the caller's limit through instead of the default", async () => {
    const { ctx, calls } = context({ turns: TURNS })

    await searchConversations("episode 500", ctx, 2)

    expect(calls).toEqual([{ method: "searchMessages", args: [USER_ID, "episode 500", 2] }])
  })

  it("builds one citable document per turn, in exactly six fields", async () => {
    const { ctx } = context({ turns: TURNS })

    const [hit] = await searchConversations("episode 500", ctx)

    expect(hit.doc).toEqual({
      id: "message:m2",
      source: "conversations",
      title: "Earlier conversation",
      body: "Episode 500 is canon; we settled on it last week.",
      url: null,
      metadata: { conversationId: CONVERSATION_ID, created_at: NOW },
    })
    // Pinned as a set so a seventh field cannot be added without this test
    // saying so: the assembler's budget is per document, not per field.
    expect(Object.keys(hit.doc).sort()).toEqual(["body", "id", "metadata", "source", "title", "url"])
  })

  it("returns precise hits, not ranked candidates", async () => {
    const { ctx } = context({ turns: TURNS })

    const [hit] = await searchConversations("episode 500", ctx)

    // `rankCandidates` never ran, so any non-zero number here would be a second
    // opinion nothing computed; Task 6's merge is what orders these.
    expect(hit.score).toBe(0)
    expect(hit.rrf).toBe(0)
    expect(hit.origins).toEqual(["conversations"])
  })

  it("keeps a null conversationId when the port cannot supply one", async () => {
    const { ctx } = context({
      turns: [{ id: "m9", role: "user", content: "older", createdAt: NOW }],
    })

    const [hit] = await searchConversations("older", ctx)

    // A turn read without the column must not become the string "undefined".
    expect(hit.doc.metadata.conversationId).toBeNull()
    expect(hit.doc.metadata.created_at).toBe(NOW)
  })

  it("caps the body so one long turn cannot evict corpus evidence", async () => {
    const long = "a".repeat(MAX_MESSAGE_BODY_CHARS + 800)
    const { ctx } = context({
      turns: [{ id: "m7", role: "assistant", content: long, createdAt: NOW }],
    })

    const [hit] = await searchConversations("long", ctx)

    expect(MAX_MESSAGE_BODY_CHARS).toBe(1200)
    expect(hit.doc.body).toHaveLength(MAX_MESSAGE_BODY_CHARS)
    expect(hit.doc.body).toBe(long.slice(0, MAX_MESSAGE_BODY_CHARS))
  })

  it("leaves a body shorter than the cap untouched", async () => {
    const { ctx } = context({
      turns: [{ id: "m8", role: "assistant", content: "short answer", createdAt: NOW }],
    })

    const [hit] = await searchConversations("short", ctx)

    expect(hit.doc.body).toBe("short answer")
  })

  it("returns no documents for a query that matched nothing", async () => {
    const { ctx } = context({ turns: [] })

    expect(await searchConversations("nothing", ctx)).toEqual([])
  })

  it("lets a port rejection travel rather than reading it as no results", async () => {
    const { ctx } = context({ reject: new Error("transcript is down") })

    // The tool adds no try/catch of its own: a failed read is a real failure,
    // and `runTools` is the layer that turns it into `{ ok: false }` (D5/Task 5
    // rule 4). Resolving to [] here would report an empty history instead.
    await expect(searchConversations("episode 500", ctx)).rejects.toThrow("transcript is down")
  })
})

describe("search_conversations in the registry", () => {
  it("dispatches by name and hands the documents to the citation contract", async () => {
    const { ctx } = context({ turns: TURNS })

    const [result] = await runTools([request({ query: "episode 500", limit: 2 })], toolContext(ctx))

    expect(result.name).toBe("search_conversations")
    expect(result.ok, result.error ?? "").toBe(true)
    expect(result.docs.map((doc) => doc.id)).toEqual(["message:m2", "message:m1"])
    expect(result.docs[0].source).toBe("conversations")
    expect(result.data).toEqual(["message:m2", "message:m1"])
    expect(result.error).toBeNull()
  })

  it("answers an empty search with ok: true and no documents", async () => {
    const { ctx } = context({ turns: [] })

    const [result] = await runTools([request({ query: "episode 500" })], toolContext(ctx))

    expect(result.ok).toBe(true)
    expect(result.docs).toEqual([])
    expect(result.data).toEqual([])
    expect(result.error).toBeNull()
  })

  it("fails the tool when the context has no conversations port", async () => {
    const ctx: ToolContext = toolContext(context().ctx)
    delete ctx.conversations

    const [result] = await runTools([request({ query: "episode 500" })], ctx)

    // Not an empty answer: an unconfigured tool is a wiring bug, and this is the
    // only place it can surface.
    expect(result.ok).toBe(false)
    expect(result.error).toBe("conversations_unavailable")
    expect(result.docs).toEqual([])
    expect(result.data).toBeNull()
  })

  it("turns a rejecting port into a failed result, not a rejected batch", async () => {
    const { ctx } = context({ reject: new Error("transcript is down") })

    const results = await runTools(
      [request({ query: "episode 500" }), request({ query: "episode 501" })],
      toolContext(ctx)
    )

    // Both requests settle as results: the batch resolved, so the assembler can
    // still answer from the ladder and the other tools.
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.name).toBe("search_conversations")
      expect(result.ok).toBe(false)
      expect(result.error).toBe("transcript is down")
      expect(result.docs).toEqual([])
      expect(result.data).toBeNull()
      expect(result.ms).toBeGreaterThanOrEqual(0)
    }
  })

  it("validates the query instead of coercing it", async () => {
    const { ctx, calls } = context({ turns: TURNS })
    const toolCtx = toolContext(ctx)

    const results = await runTools(
      [request({}), request({ query: 500 }), request({ query: "   " })],
      toolCtx
    )

    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.error).toContain("search_conversations")
      expect(result.error).toContain("query")
    }
    // A rejected argument never reaches the port.
    expect(calls).toEqual([])
  })
})

describe("search_conversations registration", () => {
  it("is the eighth tool name and still plan-coverable", () => {
    expect(TOOL_NAMES).toHaveLength(8)
    expect([...TOOL_NAMES]).toContain("search_conversations")
    expect([...TOOL_NAMES].at(-1)).toBe("search_conversations")

    // The direction Task 6 depends on: every name the registry dispatches is a
    // name a plan can produce.
    for (const name of TOOL_NAMES) expect(PLAN_TOOLS, name).toContain(name)
  })
})
