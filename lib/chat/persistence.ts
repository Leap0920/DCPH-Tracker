/**
 * The one seam between the chat route and everything the transcript feature
 * stores.
 *
 * The route must not know PostgREST, and it must not be modified every time the
 * schema moves. So this module builds the admin client, the two adapters and the
 * two stores, and hands the route a facade of five calls and one id — which also
 * means one line in a route test neutralises persistence completely (rule 7: the
 * existing integration test mocks this module, not the database).
 *
 * Three rules shape the facade. It is *best effort*: `createRequestPersistence`
 * rejects when the store cannot resolve a conversation, and the caller decides
 * to fall back to the client's history — a conversation problem may never cost
 * an answer (constraint 14). It reads the `AI_MEMORY` switch once per request,
 * so a request's read and write agree about which mode it is in (D6: unset or
 * any value other than "off" means on). And nothing it does after the response
 * may reject: `after()` has no error boundary of its own, so `afterTurn`
 * contains every failure as a `[ai-chat]` line and a resolved promise.
 *
 * No I/O of its own beyond what the injected clock and the adapters do, so a
 * test drives every branch with a scripted admin client and never constructs a
 * real Supabase client (constraint 10).
 */

import { createAdminClient } from "@/utils/supabase/admin"
import { createGateway, type ChatMessage } from "@/lib/ai/gateway"
import {
  createSupabaseTranscriptPort,
  type TranscriptClient,
} from "@/lib/ai/conversations/supabase-port"
import { createTranscriptStore, type LoadedWindow } from "@/lib/ai/conversations/store"
import type { TranscriptTurn } from "@/lib/ai/conversations/port"
import { SUMMARY_MAX_TOKENS, type SummarizeFn } from "@/lib/ai/conversations/summary"
import {
  createSupabaseMemoryPort,
  type MemoryClient,
} from "@/lib/ai/memory/supabase-port"
import { MEMORY_OFF, isMemoryEnabled } from "@/lib/ai/memory/flag"
import { createMemoryStore } from "@/lib/ai/memory/store"
import { renderMemoryAnswer } from "@/lib/ai/memory/recall"
import { renderMemoryBlock, selectMemories } from "@/lib/ai/memory/score"
import { createMemoryWriter, type MemoryWriter } from "@/lib/ai/memory/write"
import { toStructuredCall } from "@/lib/ai/structured-call"
import { buildProviderTargets } from "@/lib/ai/targets"

/**
 * Re-exported so the switch keeps living on this module's public surface: the
 * definitions moved to `lib/ai/memory/flag.ts` so the transparency route can
 * read them without this seam's provider graph.
 */
export { MEMORY_OFF, isMemoryEnabled }

/** A turn as the route's prompt wants it: no ids, no timestamps, no system role. */
export interface PersistedTurn {
  role: "user" | "assistant"
  content: string
}

export interface PersistedWindow {
  summary: string | null
  turns: PersistedTurn[]
}

/**
 * Everything the route may ask for. Each call is the route's to time out (rule
 * 7): this module reports a failure by rejecting, and the route decides that a
 * slow database means the client's own history.
 */
export interface RequestPersistence {
  readonly conversationId: string
  /** The L1 window — null when the store degraded, which is not an empty thread. */
  window(): Promise<PersistedWindow | null>
  /** The rendered `[MEM]` block; "" when memory is off, empty, or unreadable. */
  memories(query: string): Promise<string>
  /**
   * The plain-text answer to a "what do you remember about me" question; ""
   * when memory is off. The route reads "" as "no answer here" and falls
   * through to the normal pipeline rather than sending an empty body.
   */
  recallAnswer(): Promise<string>
  /** The user turn. Rejects on a store failure; the route contains it. */
  record(role: "user" | "assistant", content: string): Promise<void>
  /**
   * The assistant turn plus the memory write, after the response. Never rejects:
   * its caller is `after()`, which has no error boundary.
   */
  afterTurn(input: { answer: string }): Promise<void>
}

export interface CreateRequestPersistenceArgs {
  userId: string
  /** Absent or empty: attach to the user's most recent thread, or create one. */
  conversationId?: string | null
  /** Injected so every test runs on a fixed clock (constraint 11). */
  now?: () => number
}

/**
 * Resolves this request's conversation and returns the facade over it, or null
 * when there is nothing to attach to — no service-role key, or an id the caller
 * does not own. Both are the legacy path, and neither is an error the route has
 * to report.
 */
export async function createRequestPersistence(
  args: CreateRequestPersistenceArgs
): Promise<RequestPersistence | null> {
  const admin = createAdminClient()
  if (admin === null) return null

  const userId = args.userId
  const now = args.now ?? Date.now
  const memoryEnabled = isMemoryEnabled()

  // The adapters declare the client structurally, so the generated Supabase type
  // is narrowed once, here, rather than leaking PostgREST into the route.
  const transcriptPort = createSupabaseTranscriptPort(admin as unknown as TranscriptClient)
  const memoryPort = createSupabaseMemoryPort(admin as unknown as MemoryClient)
  const store = createTranscriptStore({ port: transcriptPort, now })
  const memoryStore = createMemoryStore({ port: memoryPort, now })

  // The ownership check and the attach-or-create decision are the store's; this
  // module only refuses to hand back a facade when it came back empty, so a
  // tampered id can never start a thread it would then own.
  const resolved = await store.resolve({ userId, conversationId: args.conversationId ?? undefined })
  if (resolved === null) return null

  const conversationId = resolved.conversation.id
  // Tracked rather than re-read: every write below is this request's, and the
  // count is what the writer's every-fourth-turn schedule is derived from.
  let messageCount = resolved.conversation.messageCount
  // The prompt's own window, kept so the writer extracts from the same bounded
  // input the model saw rather than from the whole transcript (Task 10 rule 5).
  let loadedWindow: LoadedWindow | null = null

  let writer: MemoryWriter | null = null

  /** The memory writer, built on first use so a memory-off request pays nothing. */
  function memoryWriter(): MemoryWriter {
    if (writer !== null) return writer

    const targets = buildProviderTargets()
    const gateway = createGateway()
    // There is no request scope left by the time this runs, and nothing may
    // cancel the write: the gateway's own per-target timeout is the ceiling.
    const signal = new AbortController().signal
    const call = toStructuredCall(gateway, { targets, signal })
    const summarize: SummarizeFn = async (messages: ChatMessage[]) => {
      // SUMMARY_MAX_TOKENS is the summariser's own output ceiling, exported by
      // Task 4 so this binding has one source of truth.
      const result = await gateway.complete({
        messages,
        targets,
        signal,
        maxOutputTokens: SUMMARY_MAX_TOKENS,
      })
      // null, not "", is the summariser's failure signal.
      return result.ok ? result.text : null
    }

    writer = createMemoryWriter({
      store,
      port: transcriptPort,
      memory: memoryStore,
      call,
      strict: targets.some((target) => target.supportsJsonSchema),
      summarize,
      now,
      log: (message) => console.error(message),
    })
    return writer
  }

  /** One turn, owned and counted. The port's write is what enforces ownership. */
  async function append(role: "user" | "assistant", content: string): Promise<void> {
    if (role === "user") {
      // The store's own append: it titles a new thread from its first turn and
      // advances the conversation row's count in the same call.
      await store.appendUserTurn({ userId, conversationId, content })
      messageCount += 1
      return
    }

    const at = now()
    await transcriptPort.appendMessages(userId, conversationId, [{ role, content }], at)
    // Counted after the insert lands: a failed append must not advance the
    // schedule the writer reads.
    messageCount += 1
    // `appendMessages` writes only the message row, so the counters the attach
    // window and the writer read are advanced here.
    await transcriptPort.updateConversation(userId, conversationId, { messageCount, lastMessageAt: at })
  }

  return {
    conversationId,

    async window() {
      const loaded = await store.loadWindow(userId, conversationId)
      // A degraded read is not an empty thread: the route falls back to the
      // client's history rather than answering from a transcript it could not
      // verify.
      if ("degraded" in loaded) return null

      loadedWindow = loaded
      return { summary: loaded.summary, turns: toRouteTurns(loaded.turns) }
    },

    async memories(query) {
      // Before the read, not after: the switch exists to stop the database work,
      // not just its result.
      if (!memoryEnabled) return ""
      const facts = await memoryStore.loadActive(userId)
      // One clock reading for the whole ranking, so two facts cannot be aged
      // against different instants.
      return renderMemoryBlock(selectMemories(facts, query, { now: now() }))
    },

    async recallAnswer() {
      // Before the read, not after, for the same reason `memories` is: the
      // switch exists to stop the database work, not just its result (D6).
      if (!memoryEnabled) return ""
      // `loadActive` rather than the transparency `list`: an expired progress
      // fact is not something to claim we remember, and this is the same read
      // the prompt path already trusts.
      const facts = await memoryStore.loadActive(userId)
      return renderMemoryAnswer(facts)
    },

    async record(role, content) {
      await append(role, content)
    },

    async afterTurn({ answer }) {
      try {
        await append("assistant", answer)
      } catch (error) {
        // Logged and contained, but not fatal to the rest: the summary stage
        // reads the stored transcript, and a message that could not land must
        // not also cost the summary of the turns that did.
        console.error(`[ai-chat] assistant turn not stored: ${messageOf(error)}`)
      }

      if (!memoryEnabled) return

      try {
        await memoryWriter().run({
          userId,
          conversationId,
          messageCount,
          // The port's append returns no row, and nothing in this plan reads a
          // fact back by its source message.
          sourceMessageId: null,
          // The system role is dropped for the same reason the prompt's window
          // drops it: a transcript holds user and assistant turns only.
          turns: (loadedWindow?.turns ?? []).filter((turn) => turn.role !== "system"),
          summary: loadedWindow?.summary ?? null,
        })
      } catch (error) {
        // The writer already contains its own stages; this is the belt to that
        // braces, because `after()` would surface a throw as a process problem.
        console.error(`[ai-chat] memory write failed: ${messageOf(error)}`)
      }
    },
  }
}

/**
 * The window as the route's prompt takes it: the system role is dropped because
 * a transcript holds user and assistant turns only, and the adapters' ids and
 * timestamps are not the prompt's business.
 */
function toRouteTurns(turns: TranscriptTurn[]): PersistedTurn[] {
  const kept: PersistedTurn[] = []
  for (const turn of turns) {
    if (turn.role !== "user" && turn.role !== "assistant") continue
    kept.push({ role: turn.role, content: turn.content })
  }
  return kept
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
