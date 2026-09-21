/**
 * The transcript store: the policy layer over the transcript port.
 *
 * Everything the conversation feature decides lives here — which conversation a
 * request attaches to, when a conversation gets its title, how much of the
 * transcript is shown verbatim, and what counts as a refusal. Two properties
 * shape it. Ownership is checked before a message is touched, never after
 * (D1: `ai_messages` has no `user_id`, so the conversation is the only place
 * the owner can be read from). And a broken database is a distinct outcome from
 * an empty one: `loadWindow` reports `{ degraded: true }` so the route can fall
 * back to the client's history instead of answering with a blank transcript
 * (constraint 14).
 *
 * No I/O of its own: the port is injected and the clock is injected, so a test
 * runs every branch offline.
 */

import type {
  Conversation,
  ConversationPatch,
  TranscriptPort,
  TranscriptTurn,
} from "@/lib/ai/conversations/port"

/** How far back a request with no conversation id may attach to an existing thread. */
export const RECENT_CONVERSATION_MS = 30 * 60 * 1000

/** How many of the newest messages are replayed verbatim rather than summarised. */
export const VERBATIM_WINDOW = 8

/** How much of the first user turn a conversation title keeps. */
export const MAX_TITLE_CHARS = 80

export interface MessageRange {
  from: number
  to: number
}

/**
 * The first user turn as a title. Whitespace is collapsed because the turn is
 * free text and a title is one line, and the ellipsis is the reader's cue that
 * the question continues — the store turns the empty string into `null` rather
 * than storing one.
 */
export function titleFromFirstUserTurn(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= MAX_TITLE_CHARS) return collapsed
  return `${collapsed.slice(0, MAX_TITLE_CHARS)}…`
}

/**
 * The verbatim slice of a transcript, as `slice` would take it: the last
 * `VERBATIM_WINDOW` messages, clamped at the start of the conversation.
 */
export function verbatimRange(messageCount: number): MessageRange {
  return { from: Math.max(0, messageCount - VERBATIM_WINDOW), to: messageCount }
}

/**
 * The turns a summary has to cover: older than the verbatim window, newer than
 * what the summary already covers. `null` when there are none, which is not the
 * same answer as an empty range — the caller must not spend a model call on a
 * region it has already summarised or can still show verbatim.
 */
export function summaryRange(messageCount: number, summarizedThrough: number): MessageRange | null {
  const to = messageCount - VERBATIM_WINDOW
  if (to <= summarizedThrough) return null
  return { from: summarizedThrough, to }
}

export interface ResolveInput {
  userId: string
  conversationId?: string | null
}

export interface ResolvedConversation {
  conversation: Conversation
  created: boolean
}

export interface LoadedWindow {
  summary: string | null
  turns: TranscriptTurn[]
}

export interface TranscriptStore {
  resolve(input: ResolveInput): Promise<ResolvedConversation | null>
  appendUserTurn(input: { userId: string; conversationId: string; content: string }): Promise<void>
  /**
   * The turns the model is given verbatim, plus the rolling summary of what it
   * is not. `{ degraded: true }` is the route's fallback signal, never an empty
   * window for a failure or for someone else's conversation.
   */
  loadWindow(
    userId: string,
    conversationId: string
  ): Promise<LoadedWindow | { degraded: true }>
  list(userId: string, limit?: number): Promise<Conversation[]>
  transcript(userId: string, conversationId: string, limit?: number): Promise<TranscriptTurn[] | null>
}

export interface TranscriptStoreDeps {
  port: TranscriptPort
  /** Injected so every test runs on a fixed clock (constraint 11). */
  now?: () => number
  /**
   * Accepted so a caller can hand the store the same logger it uses for
   * everything else. The store itself stays silent: it reports a refusal or a
   * failure through its return value, and the caller that can fall back owns
   * the log line and the decision.
   */
  log?: (msg: string) => void
}

/**
 * The store's methods reject only when the port rejects; the one exception is
 * `loadWindow`, which converts a rejection into its degraded branch because the
 * route calls it on the response path and must never fail an answer over a
 * transcript problem.
 */
export function createTranscriptStore(deps: TranscriptStoreDeps): TranscriptStore {
  const port = deps.port
  const now = deps.now ?? Date.now

  return {
    async resolve(input) {
      const { userId, conversationId } = input

      // An empty string is a client that sent the field with nothing in it;
      // it means "no id", exactly like an absent one.
      if (conversationId) {
        // The scoped read is the whole check. An id that is unknown and an id
        // that belongs to someone else come back the same way, and neither
        // creates a conversation: a caller must not be able to tell them apart,
        // and a tampered id must not silently start a thread it then owns.
        const owned = await port.conversationOwnedBy(userId, conversationId)
        return owned === null ? null : { conversation: owned, created: false }
      }

      const at = now()
      const recent = await port.recentConversation(userId, at - RECENT_CONVERSATION_MS)
      if (recent !== null) return { conversation: recent, created: false }

      // Untitled: the first user turn names it, and until then the API has to
      // answer `null` rather than an invented label.
      const conversation = await port.createConversation({ userId, title: null }, at)
      return { conversation, created: true }
    },

    async appendUserTurn(input) {
      const { userId, conversationId, content } = input

      // Ownership first, because `ai_messages` has no user_id (D1): this read
      // is the only thing standing between a caller-supplied conversation id
      // and a write into another user's transcript. It also supplies the count
      // the patch below is derived from.
      const conversation = await port.conversationOwnedBy(userId, conversationId)
      if (conversation === null) return

      const at = now()
      await port.appendMessages(userId, conversationId, [{ role: "user", content }], at)

      const patch: ConversationPatch = { messageCount: conversation.messageCount + 1, lastMessageAt: at }
      // The first user turn names the thread, and only the first: a later turn
      // must not rewrite a title the user has already seen.
      if (conversation.messageCount === 0 && conversation.title === null) {
        const title = titleFromFirstUserTurn(content)
        patch.title = title === "" ? null : title
      }

      await port.updateConversation(userId, conversationId, patch)
    },

    async loadWindow(userId, conversationId) {
      try {
        // One scoped read answers both questions: whose conversation this is,
        // and what its summary says.
        const conversation = await port.conversationOwnedBy(userId, conversationId)
        // Not the caller's is not the same as empty, and it gets the same
        // answer as a failure: the route falls back to the client's history
        // rather than answering from a transcript it could not verify.
        if (conversation === null) return { degraded: true }

        const turns = await port.lastMessages(userId, conversationId, VERBATIM_WINDOW)
        return { summary: conversation.summary, turns }
      } catch {
        // Swallowed deliberately: this is the fallback signal the route acts
        // on, and an exception here would cost an answer the client's own
        // history could still have produced.
        return { degraded: true }
      }
    },

    async list(userId, limit = 30) {
      return port.listConversations(userId, limit)
    },

    async transcript(userId, conversationId, limit = 200) {
      // Task 14's cap is the default: a drawer reads the tail of a thread, and
      // the port already returns it oldest-first.
      const conversation = await port.conversationOwnedBy(userId, conversationId)
      if (conversation === null) return null
      return port.lastMessages(userId, conversationId, limit)
    },
  }
}
