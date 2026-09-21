/**
 * Consolidation: candidates in, slot writes out.
 *
 * Two pieces, split the way the plan splits them. `decide` is the policy and is
 * pure — the same candidate against the same row always gives the same verdict,
 * with no clock, no port and no logging — so every rule about what deserves to
 * be stored is testable without a fake. `createConsolidator` is the IO that
 * applies it, and it is the only place that knows a batch is not a single
 * candidate (the cap, the single count read).
 *
 * Three properties are load-bearing and each has a test behind it:
 *
 * - **Nothing is deleted.** A changed value supersedes: the old row keeps its
 *   history and gains a pointer to the new active row (§7.4, provenance).
 * - **Growth is bounded without merging.** At the cap a new slot is skipped
 *   with a reason; an existing slot can still be confirmed or replaced, so the
 *   user is never silently rewritten (D7).
 * - **Nothing throws.** This runs inside `after()`, which has no error boundary
 *   of its own (Task 10 rule 4), so a port rejection is a log line and the
 *   counts accumulated so far.
 */

import { normalizeText } from "@/lib/chat/query"
import { CONFIDENCE_FLOOR, type MemoryCandidate } from "@/lib/ai/memory/extract"
import { isKnownSlot, isProgressSlot, normalizeSlotKey, progressExpiry, type MemoryKind } from "@/lib/ai/memory/slots"
import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"

/**
 * The ceiling on active facts per user, and the reason a new slot is dropped
 * rather than merged: merging costs a model call, and the plan decided the cost
 * is not justified until telemetry shows real users at the cap (D7).
 */
export const MAX_ACTIVE_FACTS = 50

/** A repeated fact gets more certain, but never certain. */
const MAX_CONFIDENCE = 0.95

/** What one more telling of the same value is worth. */
const CONFIRMATION_BUMP = 0.05

export type ConsolidationAction = "add" | "update" | "supersede" | "noop"

export interface Decision {
  action: ConsolidationAction
  reason: string
  /** For "update": the row's new confidence and evidence count. */
  confidence?: number
  evidenceCount?: number
}

/**
 * The verdict for one candidate. Pure by construction: no clock, no port and no
 * logging, so a caller can ask "what would happen?" without causing it, and the
 * same inputs always give the same answer.
 *
 * The floor is checked first because it is a property of the candidate alone —
 * a weak fact is dropped whatever the store holds, and saying so before
 * consulting the row keeps the reason honest.
 */
export function decide(input: {
  candidate: MemoryCandidate
  existing: { value: string; confidence: number; evidenceCount: number } | null
  floor?: number
}): Decision {
  const floor = input.floor ?? CONFIDENCE_FLOOR

  if (input.candidate.confidence < floor) {
    return { action: "noop", reason: "low_confidence" }
  }

  if (input.existing === null) {
    return { action: "add", reason: "new_slot" }
  }

  if (normalizeText(input.existing.value) === normalizeText(input.candidate.value)) {
    // The more confident of the two tellings survives the max(), so a hesitant
    // restatement cannot weaken a fact the user stated plainly — and then the
    // bump rewards the repetition. The min() is what keeps "more certain" from
    // becoming "certain": a fact contradicted later must still be able to lose.
    return {
      action: "update",
      reason: "same_value",
      confidence: Math.min(
        MAX_CONFIDENCE,
        Math.max(input.existing.confidence, input.candidate.confidence) + CONFIRMATION_BUMP
      ),
      evidenceCount: input.existing.evidenceCount + 1,
    }
  }

  return { action: "supersede", reason: "value_changed" }
}

export interface ConsolidationReport {
  added: number
  updated: number
  superseded: number
  skipped: number
}

/** One applied write, for a caller that wants to log or inspect the batch. */
export interface AppliedMemory {
  id: string
  kind: MemoryKind
  key: string
  action: ConsolidationAction
}

export function createConsolidator(deps: {
  port: MemoryPort
  now?: () => number
  log?: (msg: string) => void
}): {
  consolidate(input: {
    userId: string
    candidates: MemoryCandidate[]
    sourceMessageId: string | null
  }): Promise<ConsolidationReport>
} {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? (() => {})

  async function consolidate(input: {
    userId: string
    candidates: MemoryCandidate[]
    sourceMessageId: string | null
  }): Promise<ConsolidationReport> {
    const report: ConsolidationReport = { added: 0, updated: 0, superseded: 0, skipped: 0 }

    // Extraction often finds nothing, and that must cost nothing: not a read,
    // not a count, not a log line.
    if (input.candidates.length === 0) return report

    try {
      // One clock reading for the whole batch, so a candidate's expiry and the
      // row's last_confirmed_at cannot land on different sides of midnight.
      const at = now()

      // Read once per call, never per candidate: the cap is a property of the
      // batch, and a count per candidate would turn one round trip into eight.
      const existing = await deps.port.loadActive(input.userId)
      const activeCount = await deps.port.countActive(input.userId)

      // Candidates carry the model's raw key; the store holds the normalized
      // one, so the lookup normalizes both sides.
      const index = new Map<string, MemoryFact>()
      for (const row of existing) index.set(slotId(row.kind, row.key), row)

      let additions = 0

      for (const candidate of input.candidates) {
        const key = normalizeSlotKey(candidate.key)
        const row = index.get(`${candidate.kind}:${key}`) ?? null
        const decision = decide({ candidate, existing: row })

        if (decision.action === "noop") {
          report.skipped += 1
          continue
        }

        if (decision.action === "add") {
          if (activeCount + additions >= MAX_ACTIVE_FACTS) {
            report.skipped += 1
            log(`[ai-memory] skipped ${key}: cap`)
            continue
          }

          const created = await deps.port.insert(input.userId, newFact(input, candidate, key, at), at)
          report.added += 1
          additions += 1
          index.set(slotId(created.kind, created.key), created)
          continue
        }

        // decide() answers update or supersede only when it was given a row, so
        // this is the shape of the type rather than a case to expect.
        if (row === null) {
          report.skipped += 1
          continue
        }

        if (decision.action === "update") {
          const patch = {
            confidence: decision.confidence ?? candidate.confidence,
            evidenceCount: decision.evidenceCount ?? row.evidenceCount + 1,
            lastConfirmedAt: at,
          }
          // No `value`: normalization says the candidate and the row are the
          // same fact, and the stored rendering is the one the user has seen.
          await deps.port.update(input.userId, row.id, patch, at)
          report.updated += 1
          index.set(slotId(row.kind, row.key), { ...row, ...patch })
          continue
        }

        const created = await deps.port.supersede(input.userId, row.id, newFact(input, candidate, key, at), at)
        report.superseded += 1
        index.set(slotId(created.kind, created.key), created)
      }

      return report
    } catch (error) {
      log(`[ai-memory] consolidation failed: ${messageOf(error)}`)
      return report
    }
  }

  return { consolidate }
}

function slotId(kind: MemoryKind, key: string): string {
  return `${kind}:${normalizeSlotKey(key)}`
}

/**
 * The write both add and supersede share. The key is the normalized one, so the
 * row lands under the slot every reader looks up; the expiry is the progress
 * slot's shelf life and null for everything else, because a remembered episode
 * number is a claim about data the tracker owns.
 */
function newFact(
  input: { userId: string; sourceMessageId: string | null },
  candidate: MemoryCandidate,
  key: string,
  at: number
): NewFact {
  return {
    userId: input.userId,
    kind: candidate.kind,
    key,
    value: candidate.value,
    confidence: candidate.confidence,
    sourceMessageId: input.sourceMessageId,
    expiresAt: isKnownSlot(key) && isProgressSlot(key) ? progressExpiry(at) : null,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
