/**
 * Extraction: one turn window in, memory candidates out.
 *
 * The model is an injected `StructuredCall` and the ladder that repairs its
 * output belongs to `generateStructured`, so this module owns exactly two
 * things: what the model is asked, and what survives the answer.
 *
 * What survives is deliberately narrow. The model is free text; the store is a
 * controlled vocabulary; this is where the first becomes the second — unknown
 * keys dropped, values trimmed and capped, duplicates collapsed, the list
 * capped. Everything downstream (consolidation, decay scoring, the prompt
 * block) is entitled to assume a candidate is a plain object with a known slot
 * key, and this is the only place that assumption is established.
 *
 * Nothing here throws. The caller is the request's `after()` hook (Task 12),
 * which has no error boundary of its own, so a provider failure is a return
 * value: no candidates and a reason. A partial write is never a possibility,
 * because extraction writes nothing — it only reads the model.
 */

import { z } from "zod"
import type { ChatMessage } from "@/lib/ai/gateway"
import type { TranscriptTurn } from "@/lib/ai/conversations/port"
import {
  generateStructured,
  type GenerateStructuredResult,
  type StructuredCall,
} from "@/lib/ai/structured"
import { MEMORY_KINDS, SLOT_KEYS, isKnownSlot, normalizeSlotKey } from "@/lib/ai/memory/slots"

/** The most candidates one turn may contribute. Extraction is a per-turn cost. */
export const EXTRACTION_MAX_CANDIDATES = 8

/**
 * The confidence below which consolidation counts a candidate as skipped. It is
 * exported here because this is where confidence is defined, but the decision
 * belongs to Task 7 — extraction keeps a low-confidence candidate so the skip
 * shows up in the report instead of vanishing.
 */
export const CONFIDENCE_FLOOR = 0.5

/** The character ceiling a stored fact value is held to. */
export const MAX_FACT_CHARS = 200

/**
 * The researched ceiling on the repair ladder. `generateStructured` defaults to
 * the same number; naming it here makes the cost bound a property of extraction
 * rather than of a default that could move.
 */
const EXTRACTION_MAX_ATTEMPTS = 3

export const MemoryCandidateSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.7),
})
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>

/**
 * The model's envelope. One object rather than a bare array, so a provider with
 * constrained decoding has a schema to enforce, and so the model has somewhere
 * to say "the user stated nothing" with an empty list.
 */
export const ExtractionSchema = z.object({
  candidates: z.array(MemoryCandidateSchema),
})
export type ExtractionResponse = z.infer<typeof ExtractionSchema>

/**
 * The instruction. Four properties are non-negotiable and each has a failure
 * mode behind it: the vocabulary (an unknown key is dropped, so guessing one
 * wastes the call), user-only facts (the assistant's own suggestions are not
 * the user's preferences), omission over invention (a fabricated favourite
 * character is worse than a missing one), and the JSON shape (the parse is the
 * only way the answer reaches the store).
 */
const EXTRACTION_SYSTEM = [
  "You extract durable facts about the user from a chat between a user and the Detective Conan Philippines assistant.",
  "A durable fact is something that stays true across conversations: who the user is, what they like or dislike, how far they have watched, and how they want answers.",
  "The facts must be about the user. Never record what the assistant said or suggested, and never record Detective Conan trivia: that the user asked who Haibara is is not a fact about the user, while that the user likes Haibara is.",
  "If the user did not state a fact clearly, omit it. Never guess, and never turn a question into a preference.",
  `kind must be one of: ${MEMORY_KINDS.join(", ")}.`,
  `key must be one of: ${SLOT_KEYS.join(", ")}.`,
  `Return a JSON object matching this schema: {"candidates":[{"kind":"preference","key":"favorite_character","value":"Haibara","confidence":0.9}]}.`,
  `At most ${EXTRACTION_MAX_CANDIDATES} candidates, and an empty list is a valid answer.`,
].join(" ")

/**
 * The two messages one extraction round sends. The previous summary comes
 * first because it is the context the new turns are read against; the turns
 * keep their order and their role labels, since the model has to tell what the
 * user claimed from what the assistant claimed.
 */
export function buildExtractionMessages(input: {
  turns: TranscriptTurn[]
  summary: string | null
}): ChatMessage[] {
  const rendered = input.turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
  const previous = input.summary?.trim()

  const content =
    previous === undefined || previous === ""
      ? `Turns:\n${rendered}`
      : `Previous summary:\n${previous}\n\nTurns:\n${rendered}`

  return [
    { role: "system", content: EXTRACTION_SYSTEM },
    { role: "user", content },
  ]
}

export interface ExtractionRun {
  candidates: MemoryCandidate[]
  /** Provider calls actually made, never more than EXTRACTION_MAX_ATTEMPTS. */
  attempts: number
  /** Present only when the run produced no candidates for a failure. */
  reason?: string
}

/**
 * Runs the bounded repair ladder over the turn window and returns the
 * candidates that survive the filter. `strict` is passed straight through:
 * Cerebras and Gemini enforce the schema, while a target without constrained
 * decoding still gets the same prompt in `json_object` mode.
 */
export async function extractMemories(input: {
  turns: TranscriptTurn[]
  summary: string | null
  call: StructuredCall
  strict: boolean
}): Promise<ExtractionRun> {
  const messages = buildExtractionMessages({ turns: input.turns, summary: input.summary })

  // Counted here rather than taken from the ladder's result: when the injected
  // call throws, the ladder's own count never comes back, and the caller still
  // deserves to know how many provider calls this turn spent.
  let calls = 0
  const counted: StructuredCall = async (request) => {
    calls += 1
    return input.call(request)
  }

  let result: GenerateStructuredResult<ExtractionResponse>
  try {
    result = await generateStructured({
      schema: ExtractionSchema,
      messages,
      call: counted,
      strict: input.strict,
      maxAttempts: EXTRACTION_MAX_ATTEMPTS,
    })
  } catch (error) {
    // A provider that throws is the same answer as one that returns garbage:
    // no candidates, a reason, and no exception for after() to swallow.
    return { candidates: [], attempts: calls, reason: messageOf(error) }
  }

  if (result.value === null) {
    return {
      candidates: [],
      attempts: calls,
      reason: result.reason ?? "no valid structured response",
    }
  }

  return { candidates: selectCandidates(result.value.candidates), attempts: calls }
}

/**
 * The post-parse filter, in the order the plan states — and the order matters.
 * The vocabulary comes first, because a key that survives normalization but not
 * the list has no slot to be stored under. Duplicates are collapsed before the
 * cap, because the cap is a cost ceiling on distinct facts, not on the model's
 * repetitions: truncating first would let one repeated slot crowd out a fact.
 */
function selectCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const kept: MemoryCandidate[] = []
  // Identity -> index in `kept`, so the collapse is one pass and a later, more
  // confident telling replaces the earlier one in place.
  const seen = new Map<string, number>()

  for (const candidate of candidates) {
    const key = normalizeSlotKey(candidate.key)
    if (!isKnownSlot(key)) continue

    const value = candidate.value.trim().slice(0, MAX_FACT_CHARS)
    if (value === "") continue

    const identity = `${candidate.kind}:${key}`
    const index = seen.get(identity)

    if (index !== undefined) {
      if (candidate.confidence > kept[index].confidence) {
        kept[index] = { kind: candidate.kind, key, value, confidence: candidate.confidence }
      }
      continue
    }

    seen.set(identity, kept.length)
    // Rebuilt rather than spread: the returned candidate has exactly the four
    // schema fields, whatever extra keys a lenient provider left in the JSON.
    kept.push({ kind: candidate.kind, key, value, confidence: candidate.confidence })
  }

  return kept.slice(0, EXTRACTION_MAX_CANDIDATES)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
