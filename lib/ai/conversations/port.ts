/**
 * The transcript port: the one contract the conversation logic depends on.
 *
 * `ai_messages` is conversation-scoped and has no `user_id` column (deviation
 * D1), so ownership cannot be a filter on a message row. It is part of the
 * port's shape instead: every method that reads or writes a message takes
 * `userId` and must carry the ownership predicate into the same query. An
 * implementation that reads messages by conversation id alone is a cross-user
 * read, which is why the adapter's tests assert the predicate rather than the
 * values.
 *
 * Zero I/O here: this module is types only, so the logic above it never imports
 * PostgREST and a test can inject a fake through the same interface.
 */

export interface Conversation {
  id: string
  userId: string
  title: string | null
  summary: string | null
  summarizedThrough: number
  messageCount: number
  lastMessageAt: number
  archivedAt: number | null
}

export interface TranscriptTurn {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: number
  /**
   * The conversation the turn belongs to. Optional because not every reader is
   * conversation-scoped — `searchMessages` spans the user's whole history, and
   * that is the caller that needs the id to say which conversation a hit came
   * from — while a turn a caller assembles by hand need not name one.
   */
  conversationId?: string
}

export interface NewConversation {
  userId: string
  title: string | null
}

export interface NewTurn {
  conversationId: string
  role: TranscriptTurn["role"]
  content: string
}

export interface ConversationPatch {
  title?: string | null
  summary?: string | null
  summarizedThrough?: number
  messageCount?: number
  lastMessageAt?: number
  archivedAt?: number | null
}

/**
 * Every method that touches a message takes `userId` and MUST verify ownership of
 * the conversation in the same call. A port implementation that reads messages by
 * conversation id alone is a security bug (D1).
 */
export interface TranscriptPort {
  conversationOwnedBy(userId: string, conversationId: string): Promise<Conversation | null>
  recentConversation(userId: string, since: number): Promise<Conversation | null>
  createConversation(row: NewConversation, now: number): Promise<Conversation>
  updateConversation(userId: string, id: string, patch: ConversationPatch): Promise<void>
  lastMessages(userId: string, conversationId: string, limit: number): Promise<TranscriptTurn[]>
  messagesRange(
    userId: string,
    conversationId: string,
    from: number,
    to: number
  ): Promise<TranscriptTurn[]>
  appendMessages(
    userId: string,
    conversationId: string,
    turns: Omit<NewTurn, "conversationId">[],
    now: number
  ): Promise<void>
  listConversations(userId: string, limit: number): Promise<Conversation[]>
  searchMessages(userId: string, query: string, limit: number): Promise<TranscriptTurn[]>
}
