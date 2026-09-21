"use client"

/**
 * The one client transport for the chat surface.
 *
 * `useChat` (the AI SDK's hook) owns the wire: it POSTs to `/api/ai-chat`, parses
 * the UI message stream, and accumulates the parts. This module owns everything
 * between those raw parts and a component: the route's request body, the
 * parts→view-model mapping, and the small state machine the SDK's status does not
 * have (`stopped` is ours; the SDK only knows `submitted | streaming | ready |
 * error`).
 *
 * **No provider knowledge, no secrets.** The only URL here is the route, and the
 * only vocabulary is `lib/ai/stream/protocol.ts`'s — the same module the route
 * builds its parts from, so a part cannot be renamed on one side and silently
 * dropped on the other.
 *
 * The mappings and the stored-transcript converter are exported pure functions
 * so they can be tested without React; the hook is the thin, stateful shell
 * around them.
 */
import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isDataUIPart } from "ai"
import type { ChatTransport, UIMessage } from "ai"
import {
  PARTS,
  SYNTHETIC_STATE_REASONS,
  isActivityPart,
  isCitationsPart,
  isDegradedPart,
  isEvidencePart,
  isKnownProtocol,
} from "@/lib/ai/stream/protocol"
import type { ActivityPart } from "@/lib/ai/stream/protocol"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"

/** The route the hook talks to. It is the only network address in this module. */
const CHAT_ENDPOINT = "/api/ai-chat"

/**
 * The header the route answers a persisted turn with. Absent means "no
 * server-owned transcript" (no service-role key, or a v1 deployment), which is
 * not the same as "forget the id you had".
 */
const CONVERSATION_ID_HEADER = "X-Conversation-Id"

/** The three synthetic tokens, as a type. */
export type SyntheticStateReason = (typeof SYNTHETIC_STATE_REASONS)[number]

/**
 * How a message ended, as one discriminated field rather than a set of booleans.
 *
 * Precedence, highest first:
 * - `streaming` — the hook is receiving this message right now;
 * - `stopped`   — the reader pressed stop while it was streaming;
 * - `synthetic` — a `degraded` part named one of the three synthetic states
 *   (D5); the message text is one of the server's own sentences;
 * - `degraded`  — a `degraded` part named at least one other reason;
 * - `complete`  — none of the above.
 *
 * `degraded` still carries every merged reason (including a synthetic token), so
 * a renderer may badge from it directly; `state` is the summary.
 */
export type MessageState =
  | { kind: "streaming" }
  | { kind: "complete" }
  | { kind: "stopped" }
  | { kind: "synthetic"; reason: SyntheticStateReason }
  | { kind: "degraded"; reasons: string[] }

/** One message, as a component consumes it. */
export interface ChatMessageView {
  id: string
  role: UIMessage["role"]
  /** The answer text, exactly as the SDK assembled it: never trimmed, re-encoded or regexed. */
  text: string
  /** The server's numbered evidence, verbatim. The chips come from here, never from the text. */
  refs: EvidenceRef[]
  /** What the pipeline did, or `null` when the server sent no activity part. */
  activity: ActivityPart | null
  /** Every degrade reason across every `degraded` part, merged and deduped. */
  degraded: string[]
  /** The citation verdict, or `null` on a turn with no citations part (v1). */
  citations: CitationReport | null
  state: MessageState
}

/**
 * What the hook knows that the parts do not: which message is currently
 * receiving deltas and which one the reader stopped.
 */
export interface StreamViewContext {
  streamingMessageId: string | null
  stoppedMessageId: string | null
}

/**
 * The answer text a message carries: every `text` part concatenated in order.
 * The route emits exactly one text part (`id: "answer"`), so this is that part's
 * string unchanged.
 */
export function messageText(message: UIMessage): string {
  let text = ""
  for (const part of message.parts) {
    if (part.type === "text") text += part.text
  }
  return text
}

/**
 * One turn of the route's `history` field.
 */
export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

/**
 * The route's request body, exactly as `app/api/ai-chat/route.ts` parses it.
 */
export interface ChatRequestBody {
  message: string
  history: ChatTurn[]
  conversationId?: string
}

/**
 * Map UI messages to the route's body. The contract:
 *
 * - `message` is the newest user turn's text (the edited text after an edit, the
 *   resent text after a regenerate);
 * - `history` is every turn before it, text parts only, roles limited to
 *   user/assistant, empty turns dropped — the route's own `sanitizeHistory`
 *   remains the authority on size and shape;
 * - `conversationId` is included only when there is a non-blank id.
 *
 * The text is passed through verbatim; the route trims and caps it.
 */
export function toChatRequestBody(input: {
  messages: readonly UIMessage[]
  conversationId?: string | null
}): ChatRequestBody {
  const turns: ChatTurn[] = []
  for (const message of input.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    const content = messageText(message)
    if (content.trim().length === 0) continue
    turns.push({ role: message.role, content })
  }

  let lastUser = -1
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "user") {
      lastUser = index
      break
    }
  }

  const body: ChatRequestBody = {
    message: lastUser === -1 ? "" : turns[lastUser].content,
    history: lastUser === -1 ? turns : turns.slice(0, lastUser),
  }
  const conversationId = input.conversationId?.trim()
  if (conversationId) body.conversationId = conversationId
  return body
}

/**
 * Map one UI message to the view model. The contract:
 *
 * - every `text` part is concatenated verbatim into `text`;
 * - the data parts are read through `protocol.ts`'s guards, never a cast, so a
 *   malformed payload is ignored rather than trusted;
 * - a `degraded` part may arrive after the text it describes (Task 2's C4), so
 *   reasons are merged across all of them, deduped in arrival order;
 * - a part type this client does not know is ignored, and so is a whole turn
 *   whose `activity` part claims a `PROTOCOL_VERSION` this client does not know —
 *   that turn renders as text alone rather than guessing at the data shapes;
 * - the text is never parsed for `[E#]`: the chips come from `refs`.
 */
export function toMessageView(message: UIMessage, context: StreamViewContext): ChatMessageView {
  let text = ""
  let activity: ActivityPart | null = null
  let refs: EvidenceRef[] | null = null
  let citations: CitationReport | null = null
  const degraded: string[] = []

  for (const part of message.parts) {
    if (part.type === "text") {
      text += part.text
      continue
    }
    if (!isDataUIPart(part)) continue

    if (part.type === PARTS.activity) {
      if (activity === null && isActivityPart(part.data)) activity = part.data
    } else if (part.type === PARTS.evidence) {
      if (refs === null && isEvidencePart(part.data)) refs = part.data.refs
    } else if (part.type === PARTS.degraded) {
      if (isDegradedPart(part.data)) {
        for (const reason of part.data.reasons) {
          if (!degraded.includes(reason)) degraded.push(reason)
        }
      }
    } else if (part.type === PARTS.citations) {
      if (citations === null && isCitationsPart(part.data)) citations = part.data.report
    }
    // Any other data part is a part this client does not know: ignored on purpose.
  }

  // The version travels in the activity part. An unknown version means the data
  // parts' shapes cannot be trusted, so the turn renders as text alone.
  if (activity !== null && !isKnownProtocol(activity.protocol)) {
    activity = null
    refs = null
    citations = null
    degraded.length = 0
  }

  return {
    id: message.id,
    role: message.role,
    text,
    refs: refs ?? [],
    activity,
    degraded,
    citations,
    state: resolveState({
      id: message.id,
      degraded,
      streamingMessageId: context.streamingMessageId,
      stoppedMessageId: context.stoppedMessageId,
    }),
  }
}

/** Map a whole transcript, preserving order and ids. */
export function toMessageViews(
  messages: readonly UIMessage[],
  context: StreamViewContext
): ChatMessageView[] {
  return messages.map((message) => toMessageView(message, context))
}

/**
 * A stored transcript row, structurally. The drawer's `TranscriptMessage` and
 * the route's `toMessagePayload` both satisfy this without either side importing
 * the other — this module must not depend on a component.
 *
 * `role` is the SDK's own union rather than `user | assistant`: the stored rows
 * carry `system` in their union too, and a narrower role here would refuse them
 * at the call site while the server still owns those rows.
 */
export interface TranscriptMessageLike {
  id: string
  role: UIMessage["role"]
  content: string
}

/**
 * Stored transcript rows as the hook's message shape: text-only parts.
 *
 * A row is never dropped for empty content. These rows are the transcript the
 * next request is built from (`toChatRequestBody`), so dropping one would
 * silently rewrite the history the server is told about — and the server owns
 * the transcript, not this converter. An empty row is a row.
 *
 * Only the text is carried: a stored row has no parts to restore, so a loaded
 * turn renders as text alone rather than as a guess at the activity, evidence
 * or citation parts the original stream may have had.
 */
export function transcriptToUIMessages(rows: readonly TranscriptMessageLike[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: "text" as const, text: row.content }],
  }))
}

/** The hook's status, which the SDK's `ChatStatus` cannot express (no `stopped`). */
export type ChatStreamStatus = "idle" | "streaming" | "stopped" | "error"

export interface UseChatStreamOptions {
  /** The conversation the parent currently has open; the hook may adopt a new one. */
  conversationId?: string | null
  /**
   * Test seam: replaces the default transport. Production callers omit it and
   * talk to `/api/ai-chat`.
   */
  transport?: ChatTransport<UIMessage>
}

/** The view model a component consumes. */
export interface ChatStreamView {
  messages: ChatMessageView[]
  status: ChatStreamStatus
  /** The id currently in force: the one given, or the one the server last returned. */
  conversationId: string | null
  /** The last request's failure, already unwrapped from a JSON error body. */
  error: string | null
  send: (text: string) => Promise<void>
  stop: () => void
  regenerate: (messageId?: string) => Promise<void>
  editAndResend: (messageId: string, text: string) => Promise<void>
  /**
   * Replace the transcript with a stored one and adopt its conversation id, so
   * the next turn continues that conversation instead of starting a new one.
   */
  loadConversation: (id: string, messages: readonly UIMessage[]) => void
}

/**
 * The chat transport as a hook. Sends the conversation id it holds, adopts the
 * one the server returns, and exposes the transcript as view models.
 */
export function useChatStream(options: UseChatStreamOptions = {}): ChatStreamView {
  const { conversationId: givenConversationId = null, transport } = options

  const [conversationId, setConversationId] = React.useState<string | null>(givenConversationId)
  // `stopped` is ours: the SDK returns to `ready` after an abort and cannot say
  // whether the reader or the network ended the turn.
  const [stopped, setStopped] = React.useState(false)

  // The request body is built inside the transport, which is created once, so it
  // reads the live id through a ref rather than closing over a stale render.
  const conversationIdRef = React.useRef(conversationId)
  React.useEffect(() => {
    setConversationId(givenConversationId)
  }, [givenConversationId])
  React.useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const defaultTransport = React.useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: CHAT_ENDPOINT,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: toChatRequestBody({ messages, conversationId: conversationIdRef.current }),
        }),
        // The response header is the only way the route reports the conversation
        // it resolved; the SDK has no response callback in this version, so the
        // fetch is wrapped. The response is returned unchanged so the transport
        // can still parse its SSE body.
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init)
          const returnedId = response.headers.get(CONVERSATION_ID_HEADER)
          if (returnedId) setConversationId(returnedId)
          return response
        },
      }),
    []
  )

  const {
    messages: uiMessages,
    status: chatStatus,
    error: chatError,
    sendMessage,
    regenerate: regenerateMessage,
    stop: stopStream,
    setMessages,
  } = useChat<UIMessage>({ transport: transport ?? defaultTransport })

  const streamingMessageId =
    chatStatus === "submitted" || chatStatus === "streaming" ? lastAssistantId(uiMessages) : null
  const stoppedMessageId = stopped ? lastAssistantId(uiMessages) : null

  const messages = React.useMemo(
    () => toMessageViews(uiMessages, { streamingMessageId, stoppedMessageId }),
    [uiMessages, streamingMessageId, stoppedMessageId]
  )

  const status: ChatStreamStatus =
    chatStatus === "error"
      ? "error"
      : chatStatus === "submitted" || chatStatus === "streaming"
        ? "streaming"
        : stopped
          ? "stopped"
          : "idle"

  const send = React.useCallback(
    async (text: string) => {
      if (text.trim().length === 0) return
      setStopped(false)
      await sendMessage({ text })
    },
    [sendMessage]
  )

  const stop = React.useCallback(() => {
    setStopped(true)
    void stopStream()
  }, [stopStream])

  const regenerate = React.useCallback(
    async (messageId?: string) => {
      if (messageId === undefined && lastAssistantId(uiMessages) === null) return
      setStopped(false)
      await regenerateMessage(messageId === undefined ? {} : { messageId })
    },
    [regenerateMessage, uiMessages]
  )

  const editAndResend = React.useCallback(
    async (messageId: string, text: string) => {
      if (text.trim().length === 0) return
      setStopped(false)
      // Passing `messageId` truncates the transcript from that message and
      // replaces it (D7: edit resends, it does not fork).
      await sendMessage({ text, messageId })
    },
    [sendMessage]
  )

  /**
   * Replace the transcript with a stored one (the drawer hands back rows the
   * server already owns).
   *
   * Three things happen in the same call, and each one matters:
   *
   * - the messages are replaced, never appended — the loaded transcript is the
   *   whole conversation the server holds;
   * - `stopped` is cleared. The flag is ours, not the SDK's, and it names the
   *   last assistant turn; leaving it set would render the loaded conversation's
   *   final answer as one the reader had stopped;
   * - the id is written to the ref *and* to state. The transport reads the ref,
   *   and a `setState` has not committed when a turn is sent from the same tick,
   *   so state alone would post the next turn with the id from before the load.
   */
  const loadConversation = React.useCallback(
    (id: string, messages: readonly UIMessage[]) => {
      setStopped(false)
      conversationIdRef.current = id
      setConversationId(id)
      setMessages([...messages])
    },
    [setMessages]
  )

  return {
    messages,
    status,
    conversationId,
    error: chatError ? errorText(chatError) : null,
    send,
    stop,
    regenerate,
    editAndResend,
    loadConversation,
  }
}

/** The last assistant message's id, or `null` when the transcript has none. */
function lastAssistantId(messages: readonly UIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index].id
  }
  return null
}

/** The one field of the five the state machine reads, in precedence order. */
function resolveState(input: {
  id: string
  degraded: readonly string[]
  streamingMessageId: string | null
  stoppedMessageId: string | null
}): MessageState {
  if (input.id === input.streamingMessageId) return { kind: "streaming" }
  if (input.id === input.stoppedMessageId) return { kind: "stopped" }
  const synthetic = input.degraded.find(isSyntheticReason)
  if (synthetic !== undefined) return { kind: "synthetic", reason: synthetic }
  if (input.degraded.length > 0) return { kind: "degraded", reasons: [...input.degraded] }
  return { kind: "complete" }
}

function isSyntheticReason(reason: string): reason is SyntheticStateReason {
  return (SYNTHETIC_STATE_REASONS as readonly string[]).includes(reason)
}

/**
 * The route answers a failure as `{ error }` JSON; the transport surfaces the raw
 * body as the error message. Unwrap it when it is JSON, otherwise keep the
 * transport's own message.
 */
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown }
    if (parsed && typeof parsed.error === "string" && parsed.error) return parsed.error
  } catch {
    // Not a JSON body: the transport's message is the honest one.
  }
  return error.message
}
