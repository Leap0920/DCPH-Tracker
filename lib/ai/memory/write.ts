/**
 * The async writer: one call for everything a turn does after its response has
 * been handed to the client.
 *
 * The route (Task 12) has exactly one hook for post-response work, so this
 * module is the single failure boundary of the whole feature. Nothing here may
 * reject — `after()` has no error boundary of its own, and a throw from a
 * background hook is a process-level problem, not a 500 the user could have
 * avoided — which is why every stage reports through the returned `WriteReport`
 * and every caught failure is one `[ai-memory]` line.
 *
 * The schedule is the cost guarantee. Extraction runs on every fourth assistant
 * turn and no other: three turns in four spend no model call at all (asserted in
 * `memory-write.test.ts`), and the write is never on the response's critical
 * path. The summary is a separate stage with its own schedule — it is due when
 * unsummarized turns have left the verbatim window (Task 4) — so a failed
 * extraction never blocks it, and a failed summary never discards the counts
 * consolidation already earned.
 *
 * The window is the caller's. `WriteInput.turns` is the L1 window the route
 * already loaded for the prompt, and extraction reads that rather than the
 * transcript, so a memory write costs one model call and nothing else. The
 * slice to `VERBATIM_WINDOW` is a second line of defence for a caller that
 * passes more: extraction cost must stay a function of the window and not of
 * the conversation's length.
 *
 * `AI_MEMORY` is deliberately absent. The kill switch belongs to the caller,
 * which knows whether memory is on for this request; a module that read the
 * environment would behave differently in a test than in production.
 */

import type { TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import { createSummarizer, type SummarizeFn } from "@/lib/ai/conversations/summary"
import { VERBATIM_WINDOW, type TranscriptStore } from "@/lib/ai/conversations/store"
import { createConsolidator } from "@/lib/ai/memory/consolidate"
import { extractMemories } from "@/lib/ai/memory/extract"
import type { MemoryPort } from "@/lib/ai/memory/port"
import type { StructuredCall } from "@/lib/ai/structured"

/** Assistant turns per memory write. Three turns in four cost nothing. */
export const MEMORY_WRITE_EVERY = 4

export interface WriteInput {
  userId: string
  conversationId: string
  /** The count AFTER the assistant turn was appended. */
  messageCount: number
  sourceMessageId: string | null
  /** The L1 window the caller already loaded for the prompt. */
  turns: TranscriptTurn[]
  summary: string | null
}

/**
 * Every field is always present, whatever happened, so the caller can log the
 * report without optional-chaining. `reason` is the exception and is set only
 * when the turn did less than the full job — the schedule said no, the window
 * was empty, or a stage failed.
 */
export interface WriteReport {
  extracted: number
  added: number
  updated: number
  superseded: number
  skipped: number
  summarized: boolean
  reason?: string
}

export interface MemoryWriterDeps {
  /** The writer builds its summariser from these three, per call. */
  store: TranscriptStore
  port: TranscriptPort
  memory: MemoryPort
  call: StructuredCall
  strict: boolean
  summarize: SummarizeFn
  /** Injected so a test's clock never ticks (constraint 11). */
  now?: () => number
  /** One line per caught failure, and the consolidator's own cap notices. */
  log?: (msg: string) => void
}

export interface MemoryWriter {
  run(input: WriteInput): Promise<WriteReport>
}

export function createMemoryWriter(deps: MemoryWriterDeps): MemoryWriter {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? (() => {})

  // Built once rather than per call: it keeps no state between batches, and one
  // logger is what makes "each failure is logged once" true for the caller.
  const consolidator = createConsolidator({ port: deps.memory, now, log })

  return {
    async run(input) {
      const report: WriteReport = {
        extracted: 0,
        added: 0,
        updated: 0,
        superseded: 0,
        skipped: 0,
        summarized: false,
      }

      // The schedule, and the whole cost guarantee: not due means no model call,
      // no port read and no store read — the report is the only work done.
      if (input.messageCount % MEMORY_WRITE_EVERY !== 0) {
        report.reason = "not_due"
        return report
      }

      // From here on the report is filled in place, so a failure at any point
      // returns the counts the earlier stages already earned rather than a
      // fresh zero.
      try {
        const turns = input.turns.slice(-VERBATIM_WINDOW)

        if (turns.length === 0) {
          // A degraded window is the caller's decision (it falls back to the
          // client's history); by the time it reaches here there is nothing to
          // extract from, and a model call on an empty prompt would be waste.
          report.reason = "no_turns"
        } else {
          const extraction = await extractMemories({
            turns,
            summary: input.summary,
            call: deps.call,
            strict: deps.strict,
          })
          report.extracted = extraction.candidates.length

          // Extraction reports a failure the same way it reports candidates, so
          // this log line is the only place a provider problem becomes visible.
          if (extraction.reason !== undefined) {
            report.reason = extraction.reason
            log(`[ai-memory] extraction failed: ${extraction.reason}`)
          }

          // An empty candidate list is not a port call at all (Task 7), so a
          // turn where the user stated nothing new writes nothing and reads
          // nothing.
          const consolidation = await consolidator.consolidate({
            userId: input.userId,
            candidates: extraction.candidates,
            sourceMessageId: input.sourceMessageId,
          })
          report.added = consolidation.added
          report.updated = consolidation.updated
          report.superseded = consolidation.superseded
          report.skipped = consolidation.skipped
        }

        // The summary stage runs whether or not extraction did: the two cover
        // different regions of the transcript and have different schedules, so
        // one failing must not stop the other catching up. Built here rather
        // than at construction so a caller can hand over a fresh store between
        // turns.
        const summary = await createSummarizer({
          store: deps.store,
          port: deps.port,
          summarize: deps.summarize,
          now,
          log,
        }).maybeSummarize(input.userId, input.conversationId)

        report.summarized = summary.ok

        // "not due" is the summariser's normal answer for most turns, and the
        // cap is not a failure: only a real refusal or error earns a line.
        if (!summary.ok && summary.reason !== "not_due") {
          if (report.reason === undefined) report.reason = summary.reason
          log(`[ai-memory] summary failed for ${input.conversationId}: ${summary.reason ?? "unknown"}`)
        }
      } catch (error) {
        // The belt to the stages' braces. Extract, consolidate and summarise
        // each contain their own failures; this is what makes "run never
        // rejects" a property of this function rather than of its dependencies.
        log(`[ai-memory] write failed for ${input.conversationId}: ${messageOf(error)}`)
      }

      return report
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
