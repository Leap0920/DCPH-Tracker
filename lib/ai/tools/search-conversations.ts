/**
 * Conversation search: the user's own earlier messages, as citable evidence.
 *
 * Plan 3 built `searchMessages` on the transcript port and deferred the tool to
 * this phase (its D5); the plan executor is what makes it useful, so "what did
 * we decide about episode 500?" can be answered from the transcript instead of
 * from the model's memory of a conversation it cannot see.
 *
 * Three constraints this module keeps:
 *
 * 1. `userId` rides on every port call. `ai_messages` has no `user_id` column
 *    (Plan 3's D1), so the port's ownership predicate is the whole cross-user
 *    guard; the tool takes the id from its caller and has no argument that could
 *    widen the search.
 * 2. Bodies are capped at `MAX_MESSAGE_BODY_CHARS`. The assembler evicts whole
 *    documents, so one 20,000-character assistant turn would push real corpus
 *    evidence out of the budget; a truncated message is still quotable, a
 *    missing one is not.
 * 3. A rejection is not swallowed. `searchCatalog` degrades a retrieval branch
 *    to "no documents" because a corpus branch has alternatives; a transcript
 *    read that fails has none, so the failure travels and `runTools` records
 *    `ok: false` — the execution report can then say a tool was broken rather
 *    than empty.
 */
import type { TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"

/** Messages a plan gets when its step carries no limit. */
export const DEFAULT_CONVERSATION_HITS = 5

/**
 * The longest message body that reaches the evidence set.
 *
 * The assembly budget is measured in tokens and enforced by evicting whole
 * documents, so a single long turn would cost corpus evidence that answers the
 * question. Truncation is by character rather than by word: the cap is a budget,
 * and a body whose length depends on where the spaces fell is not one.
 */
export const MAX_MESSAGE_BODY_CHARS = 1200

/**
 * `TranscriptTurn` carries no conversation title — the port's search answers
 * with messages, and the title lives on `Conversation` — so naming the
 * conversation would take a second round trip per hit for a label. The fallback
 * is what the model sees until a title-bearing read exists.
 */
const TITLE_FALLBACK = "Earlier conversation"

export interface ConversationSearchContext {
  port: TranscriptPort
  userId: string
}

function toDocument(turn: TranscriptTurn): CorpusDocument {
  return {
    id: `message:${turn.id}`,
    source: "conversations",
    title: TITLE_FALLBACK,
    body: turn.content.slice(0, MAX_MESSAGE_BODY_CHARS),
    // A message has no page to link to; `CorpusDocument.url` is nullable for
    // exactly this case.
    url: null,
    metadata: {
      // A turn read without the column (an older adapter, a fixture) is null
      // rather than the string "undefined".
      conversationId: turn.conversationId ?? null,
      created_at: turn.createdAt,
    },
  }
}

/**
 * The user's messages matching `query`, newest first, as documents the
 * assembler can cite. A rejection is the port's to raise: see constraint 3.
 */
export async function searchConversations(
  query: string,
  ctx: ConversationSearchContext,
  limit = DEFAULT_CONVERSATION_HITS
): Promise<ScoredDoc[]> {
  const turns = await ctx.port.searchMessages(ctx.userId, query, limit)

  return turns.map((turn) => ({
    doc: toDocument(turn),
    // Precise hits, not ranked candidates: `rankCandidates` never ran, so any
    // non-zero number here would be an opinion nothing computed. Task 6's merge
    // orders these after the ladder's fused documents.
    score: 0,
    rrf: 0,
    origins: ["conversations"],
  }))
}
