/**
 * The rolling summary: the memory of the turns the verbatim window no longer
 * shows.
 *
 * Three properties shape this module.
 *
 * The unsummarized region is read from its START, in chunks, never as "the
 * newest N messages". A region longer than one chunk therefore loses nothing —
 * it is summarised over several calls, and `summarizedThrough` records exactly
 * how far the model has read. Reading backwards would skip the oldest part of a
 * long region and the skip would be invisible.
 *
 * It only ever writes what the model produced: a failed or blank completion, an
 * empty read or a rejected write leaves the stored mark where it was, and the
 * next turn retries. The mark moves forward, never back, so a slow call cannot
 * regress a newer one.
 *
 * And it never throws. Its callers are the request's `after()` hook (Task 12)
 * and the memory writer (Task 10), neither of which has an error boundary for
 * work that outlives the response, so a failure is a return value plus one
 * `[ai-summary]` log line.
 *
 * The token ceiling belongs to the caller: it binds `summarize` through
 * `gateway.complete` with `maxOutputTokens: SUMMARY_MAX_TOKENS`, which is
 * exported so that binding has one source of truth. The character ceiling is
 * owned here, by `clampSummary`: a 400-token answer can still be longer than a
 * summary wants to be.
 *
 * No I/O of its own — the store, the port, the model call and the clock are all
 * injected, which is what keeps every test offline (constraint 11).
 */

import type { ChatMessage } from "@/lib/ai/gateway"
import type { TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import {
  summaryRange,
  VERBATIM_WINDOW,
  type TranscriptStore,
} from "@/lib/ai/conversations/store"

/** Unsummarized messages outside the window before a summary is due. */
export const SUMMARY_TRIGGER = 8

/** The most messages one summarisation round may read. */
export const SUMMARY_INPUT_LIMIT = 40

/** The character cap this module enforces on the stored summary. */
export const SUMMARY_MAX_CHARS = 1200

/** The output ceiling the caller binds `summarize` with (see the header). */
export const SUMMARY_MAX_TOKENS = 400

/** Bounded catch-up: at most this many summarisation rounds per call. */
export const SUMMARY_CATCHUP_ROUNDS = 2

/**
 * True when enough unsummarized turns have left the verbatim window to be worth
 * a model call. The window check is deliberate: a conversation shorter than the
 * window has nothing to summarise, whatever its mark says.
 */
export function needsSummary(messageCount: number, summarizedThrough: number): boolean {
  if (messageCount <= VERBATIM_WINDOW) return false
  return messageCount - VERBATIM_WINDOW - summarizedThrough >= SUMMARY_TRIGGER
}

/**
 * The stored form of a summary: one line, and inside the character cap. The cut
 * lands on a space so the reader never meets half a word; a single unbroken word
 * longer than the cap has no such boundary and is cut at the cap instead.
 */
export function clampSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= SUMMARY_MAX_CHARS) return collapsed

  const head = collapsed.slice(0, SUMMARY_MAX_CHARS)
  const boundary = head.lastIndexOf(" ")
  const kept = boundary > 0 ? head.slice(0, boundary) : head
  return `${kept}…`
}

const SUMMARY_SYSTEM = [
  "You maintain the rolling summary of a chat between a user and the Detective Conan Philippines assistant.",
  "The summary stands in for the older turns of the conversation, so it must be readable on its own.",
  "Preserve what the user said about themselves: stated facts, preferences and questions, including names, favourite characters, episodes, cases, arcs and where they are in their watch progress.",
  "Never invent anything. If a detail was not said, leave it out; add no advice, no opinion and no description of what the assistant did not say.",
  `Write plain prose in at most ${SUMMARY_MAX_CHARS} characters, with no headings and no lists.`,
].join(" ")

/**
 * The two messages one summarisation round sends: the instructions, then the
 * previous summary followed by the new turns. The turns keep their order and
 * their role labels, because the model has to tell a claim the user made from
 * one the assistant made.
 */
export function buildSummaryMessages(input: {
  previousSummary: string | null
  turns: TranscriptTurn[]
}): ChatMessage[] {
  const rendered = input.turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
  const previous = input.previousSummary?.trim()

  // The label is the model's only cue that the first block is what earlier
  // rounds already distilled and the second is new material.
  const content =
    previous === undefined || previous === ""
      ? `New turns:\n${rendered}`
      : `Previous summary:\n${previous}\n\nNew turns:\n${rendered}`

  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content },
  ]
}

export interface SummaryRun {
  ok: boolean
  /** The mark the call ended on, whether or not anything was written. */
  summarizedThrough: number
  reason?: string
}

/**
 * A non-streaming completion bound to a target list and a signal by the caller.
 * The route builds it from `gateway.complete`; tests pass a stub. Keeping the
 * binding outside this module is what keeps the summariser offline-testable.
 *
 * `null` is the model's own failure signal; a throw is caught anyway, because
 * the caller has no error boundary.
 */
export type SummarizeFn = (messages: ChatMessage[]) => Promise<string | null>

export interface SummarizerDeps {
  store: TranscriptStore
  port: TranscriptPort
  summarize: SummarizeFn
  /**
   * Accepted for interface parity with the other writers and injected by the
   * callers that have one. This module writes no timestamp of its own, so it is
   * deliberately unused: nothing here depends on the wall clock.
   */
  now?: () => number
  /** One line per caught failure; the returned reason is the caller's signal. */
  log?: (msg: string) => void
}

export interface Summarizer {
  maybeSummarize(userId: string, conversationId: string): Promise<SummaryRun>
}

/**
 * Rolls the summary forward, at most `SUMMARY_CATCHUP_ROUNDS` chunks per call.
 * A long backlog is drained over consecutive turns, which splits the cost of
 * summarising a whole conversation across turns instead of spending it in one.
 */
export function createSummarizer(deps: SummarizerDeps): Summarizer {
  const { store, port, summarize } = deps
  const log = deps.log ?? (() => {})

  return {
    async maybeSummarize(userId, conversationId) {
      // The mark the call can vouch for. Until a write succeeds it stays at the
      // value read from the conversation, so a failure reports no progress.
      let through = 0

      try {
        // The ownership check comes before any message read: `ai_messages` is
        // conversation-scoped and has no user_id (D1), so a read by conversation
        // id alone would cross users. `resolve` with an id never creates one.
        const resolved = await store.resolve({ userId, conversationId })
        if (resolved === null) {
          // An unknown id and another user's id get the same answer, and no
          // summary work happens for either.
          return { ok: false, summarizedThrough: 0, reason: "not_found" }
        }

        const { conversation } = resolved
        through = conversation.summarizedThrough

        if (!needsSummary(conversation.messageCount, through)) {
          return { ok: false, summarizedThrough: through, reason: "not_due" }
        }

        let summary = conversation.summary

        for (let round = 0; round < SUMMARY_CATCHUP_ROUNDS; round++) {
          const range = summaryRange(conversation.messageCount, through)
          // Nothing left outside the window that the mark does not cover: the
          // call did its work, and the next turn has nothing to catch up on.
          if (range === null) return { ok: true, summarizedThrough: through }

          const chunkTo = Math.min(range.from + SUMMARY_INPUT_LIMIT, range.to)
          // From the mark forward, never the newest chunk: this is what makes a
          // region longer than the limit lose nothing.
          const turns = await port.messagesRange(userId, conversationId, range.from, chunkTo)

          if (turns.length === 0) {
            // The range is inside the transcript, so an empty read means the
            // rows are not there to summarise. Advancing the mark over them
            // would drop messages from memory silently; stopping retries.
            return { ok: false, summarizedThrough: through, reason: "empty" }
          }

          let text: string | null
          try {
            text = await summarize(buildSummaryMessages({ previousSummary: summary, turns }))
          } catch (error) {
            log(`[ai-summary] summarize failed for ${conversationId}: ${messageOf(error)}`)
            return { ok: false, summarizedThrough: through, reason: "summarize_failed" }
          }

          if (text === null) {
            return { ok: false, summarizedThrough: through, reason: "summarize_failed" }
          }

          const clamped = clampSummary(text)
          if (clamped === "") {
            return { ok: false, summarizedThrough: through, reason: "empty" }
          }

          // The guard against a stale call: the mark is the larger of what this
          // call read and what it just covered, so it can only move forward.
          const next = Math.max(through, chunkTo)
          await port.updateConversation(userId, conversationId, {
            summary: clamped,
            summarizedThrough: next,
          })

          summary = clamped
          through = next
        }

        return { ok: true, summarizedThrough: through }
      } catch (error) {
        // after() has no error boundary of its own: a rejection here is a log
        // line and a reason, not a thrown error that could take down the hook.
        log(`[ai-summary] maybeSummarize failed for ${conversationId}: ${messageOf(error)}`)
        return { ok: false, summarizedThrough: through, reason: "error" }
      }
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
