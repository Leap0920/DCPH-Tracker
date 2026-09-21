import { describe, expect, it } from "vitest"
import type { TranscriptTurn } from "@/lib/ai/conversations/port"
import type { StructuredCall, StructuredRequest } from "@/lib/ai/structured"
import {
  MEMORY_KINDS,
  SLOT_KEYS,
  isKnownSlot,
  isProgressSlot,
  normalizeSlotKey,
  progressExpiry,
} from "@/lib/ai/memory/slots"
import {
  CONFIDENCE_FLOOR,
  EXTRACTION_MAX_CANDIDATES,
  MAX_FACT_CHARS,
  MemoryCandidateSchema,
  buildExtractionMessages,
  extractMemories,
} from "@/lib/ai/memory/extract"

/**
 * Extraction is policy over two pure inputs: the controlled vocabulary and the
 * model's JSON. The model is the injected `StructuredCall` (constraint 11), so
 * every test here is deterministic — a scripted reply and the count of times it
 * was asked. Nothing reaches the network and nothing reads a clock.
 */

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

const TURNS: TranscriptTurn[] = [
  { id: "m1", role: "user", content: "Haibara is my favourite character.", createdAt: NOW },
  { id: "m2", role: "assistant", content: "She is a fan favourite.", createdAt: NOW + 1 },
]

const DAY_MS = 24 * 60 * 60 * 1000

interface Scripted {
  call: StructuredCall
  requests: StructuredRequest[]
  /** How many times the model was actually invoked. */
  calls: () => number
}

/** Replies in order; the last one repeats, so a test lists only what changes. */
function scriptedCall(
  responses: { text: string; finishReason?: string | null }[]
): Scripted {
  const requests: StructuredRequest[] = []
  const call: StructuredCall = async (request) => {
    requests.push(request)
    const response = responses[Math.min(requests.length - 1, responses.length - 1)]
    return { text: response.text, finishReason: response.finishReason ?? "stop" }
  }
  return { call, requests, calls: () => requests.length }
}

/** The envelope the model is asked for: one object holding the candidate list. */
function reply(candidates: unknown[]): { text: string } {
  return { text: JSON.stringify({ candidates }) }
}

function extract(script: Scripted, overrides: Partial<{ strict: boolean; summary: string | null }> = {}) {
  return extractMemories({
    turns: TURNS,
    summary: overrides.summary ?? null,
    call: script.call,
    strict: overrides.strict ?? true,
  })
}

describe("normalizeSlotKey", () => {
  it("folds case and every separator into one underscore", () => {
    expect(normalizeSlotKey("Favorite Character")).toBe("favorite_character")
    expect(normalizeSlotKey("favorite-character")).toBe("favorite_character")
    expect(normalizeSlotKey("favorite  character")).toBe("favorite_character")
    expect(normalizeSlotKey("  Favorite--Character!!  ")).toBe("favorite_character")
    expect(normalizeSlotKey("Favorite_Character")).toBe("favorite_character")
    // Idempotent, because a normalized key is fed back through callers.
    expect(normalizeSlotKey(normalizeSlotKey("Watch Progress"))).toBe("watch_progress")
  })
})

describe("isKnownSlot", () => {
  it("accepts every controlled key, raw or normalized, and nothing else", () => {
    for (const key of SLOT_KEYS) expect(isKnownSlot(key)).toBe(true)
    expect(isKnownSlot(normalizeSlotKey("Favorite Character"))).toBe(true)
    expect(isKnownSlot("Favorite Character")).toBe(true)

    expect(isKnownSlot("favourite_character")).toBe(false)
    expect(isKnownSlot("favorite_villain")).toBe(false)
    expect(isKnownSlot("")).toBe(false)
  })
})

describe("isProgressSlot", () => {
  it("marks only watch_progress: a stale status or plan cannot contradict the tracker", () => {
    expect(isProgressSlot("watch_progress")).toBe(true)
    expect(isProgressSlot("watch_status")).toBe(false)
    expect(isProgressSlot("watch_plan")).toBe(false)
    expect(isProgressSlot("favorite_character")).toBe(false)
  })
})

describe("progressExpiry", () => {
  it("is exactly 90 days after the given instant", () => {
    expect(progressExpiry(NOW)).toBe(NOW + 90 * DAY_MS)
  })
})

describe("MemoryCandidateSchema", () => {
  it("accepts a valid candidate and defaults a missing confidence to 0.7", () => {
    const full = MemoryCandidateSchema.safeParse({
      kind: "preference",
      key: "favorite_character",
      value: "Haibara",
      confidence: 0.9,
    })
    expect(full.success).toBe(true)
    if (full.success) expect(full.data.confidence).toBe(0.9)

    const bare = MemoryCandidateSchema.safeParse({
      kind: "preference",
      key: "favorite_character",
      value: "Haibara",
    })
    expect(bare.success).toBe(true)
    if (bare.success) expect(bare.data.confidence).toBe(0.7)
  })

  it("rejects a confidence outside 0..1 on either side", () => {
    const below = MemoryCandidateSchema.safeParse({
      kind: "preference",
      key: "favorite_character",
      value: "Haibara",
      confidence: -0.1,
    })
    const above = MemoryCandidateSchema.safeParse({
      kind: "preference",
      key: "favorite_character",
      value: "Haibara",
      confidence: 1.1,
    })
    expect(below.success).toBe(false)
    expect(above.success).toBe(false)
  })

  it("rejects a kind outside the vocabulary", () => {
    const result = MemoryCandidateSchema.safeParse({
      kind: "gossip",
      key: "favorite_character",
      value: "Haibara",
    })
    expect(result.success).toBe(false)
  })
})

describe("buildExtractionMessages", () => {
  it("is a system/user pair that lists every controlled key and kind as a choice", () => {
    const messages = buildExtractionMessages({ turns: TURNS, summary: null })

    expect(messages.map((message) => message.role)).toEqual(["system", "user"])
    // The vocabulary is the contract that makes a slot lookup possible, so the
    // model must be able to see all of it — not a hint, not a subset.
    for (const key of SLOT_KEYS) expect(messages[0].content).toContain(key)
    for (const kind of MEMORY_KINDS) expect(messages[0].content).toContain(kind)
  })

  it("demands user facts, refuses assistant talk and Conan trivia, and forbids guessing", () => {
    const system = buildExtractionMessages({ turns: TURNS, summary: null })[0].content

    expect(system).toMatch(/about the user/i)
    expect(system).toMatch(/assistant/i)
    expect(system).toMatch(/trivia|detective conan/i)
    expect(system).toMatch(/omit/i)
    expect(system).toMatch(/guess/i)
    // The reply has to be machine-readable or the schema check has nothing to do.
    expect(system).toMatch(/json/i)
    expect(system).toMatch(/schema/i)
  })

  it("keeps the previous summary ahead of the verbatim turns, in their original order", () => {
    const content = buildExtractionMessages({
      turns: TURNS,
      summary: "They are rewatching episode one.",
    })[1].content

    expect(content).toMatch(/previous summary/i)
    expect(content).toContain("They are rewatching episode one.")
    expect(content.indexOf("They are rewatching episode one.")).toBeLessThan(
      content.indexOf("user: Haibara is my favourite character.")
    )
    expect(content.indexOf("user: Haibara is my favourite character.")).toBeLessThan(
      content.indexOf("assistant: She is a fan favourite.")
    )

    const without = buildExtractionMessages({ turns: TURNS, summary: null })[1].content
    expect(without).not.toMatch(/previous summary/i)
    expect(without).toContain("user: Haibara is my favourite character.")
    expect(without).toContain("assistant: She is a fan favourite.")
  })
})

describe("extractMemories", () => {
  it("returns normalized plain candidates on the first valid response", async () => {
    const script = scriptedCall([
      reply([
        { kind: "preference", key: "Favorite Character", value: "Haibara", confidence: 0.9 },
      ]),
    ])

    const result = await extract(script)

    // Consolidation looks the slot up by this key, so the raw model text must
    // not survive into the candidate.
    expect(result.candidates).toEqual([
      { kind: "preference", key: "favorite_character", value: "Haibara", confidence: 0.9 },
    ])
    expect(Object.keys(result.candidates[0]).sort()).toEqual([
      "confidence",
      "key",
      "kind",
      "value",
    ])
    expect(result.attempts).toBe(1)
    expect(result.attempts).toBe(script.calls())
    expect(result.reason).toBeUndefined()
    // The prompt is the builder's, so what the model saw is what the tests pinned.
    expect(script.requests[0].messages).toEqual(
      buildExtractionMessages({ turns: TURNS, summary: null })
    )
  })

  it("passes strict through: a schema when it can be enforced, plain JSON when it cannot", async () => {
    const strict = scriptedCall([
      reply([{ kind: "preference", key: "favorite_character", value: "Haibara" }]),
    ])
    await extract(strict, { strict: true })
    expect(strict.requests[0].mode).toBe("strict")
    expect(strict.requests[0].schema).not.toBeNull()

    // A Groq target has no constrained decoding; json_object still guarantees
    // syntax, so the extraction has to keep working with no schema attached.
    const loose = scriptedCall([
      reply([{ kind: "preference", key: "favorite_character", value: "Haibara" }]),
    ])
    const result = await extract(loose, { strict: false })
    expect(loose.requests[0].mode).toBe("json_object")
    expect(loose.requests[0].schema).toBeNull()
    expect(result.candidates).toHaveLength(1)
  })

  it("drops a key outside the controlled vocabulary", async () => {
    const script = scriptedCall([
      reply([
        { kind: "preference", key: "favorite_character", value: "Haibara" },
        { kind: "interest", key: "favorite_villain", value: "Gin", confidence: 1 },
      ]),
    ])

    const result = await extract(script)

    expect(result.candidates.map((candidate) => candidate.key)).toEqual(["favorite_character"])
  })

  it("trims and caps values at MAX_FACT_CHARS, dropping the ones that trim to nothing", async () => {
    expect(MAX_FACT_CHARS).toBe(200)

    const script = scriptedCall([
      reply([
        { kind: "interest", key: "favorite_movie", value: `  ${"x".repeat(300)}  ` },
        { kind: "constraint", key: "answer_style", value: "   \n  " },
        { kind: "identity", key: "preferred_name", value: "  Kai  " },
      ]),
    ])

    const result = await extract(script)

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].value).toBe("x".repeat(MAX_FACT_CHARS))
    expect(result.candidates[1].value).toBe("Kai")
  })

  it("collapses duplicates on kind and normalized key, keeping the most confident", async () => {
    const script = scriptedCall([
      reply([
        { kind: "preference", key: "Favorite Character", value: "Haibara", confidence: 0.6 },
        { kind: "preference", key: "favorite-character", value: "Ran", confidence: 0.9 },
        { kind: "interest", key: "favorite_character", value: "Ran", confidence: 0.4 },
      ]),
    ])

    const result = await extract(script)

    // Two, not one: the kind is part of the identity, so a preference and an
    // interest may share a slot key.
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toEqual({
      kind: "preference",
      key: "favorite_character",
      value: "Ran",
      confidence: 0.9,
    })
    expect(result.candidates[1]).toEqual({
      kind: "interest",
      key: "favorite_character",
      value: "Ran",
      confidence: 0.4,
    })
  })

  it("truncates to EXTRACTION_MAX_CANDIDATES after the collapse, not before", async () => {
    const script = scriptedCall([
      reply([
        { kind: "preference", key: "favorite_character", value: "Haibara", confidence: 0.4 },
        { kind: "preference", key: "favorite_movie", value: "The Time Bombed Skyscraper" },
        { kind: "preference", key: "favorite_episode", value: "The Blue Castle Case" },
        { kind: "preference", key: "favorite_case", value: "The Moonlight Sonata" },
        { kind: "preference", key: "favorite_arc", value: "The Vermouth arc" },
        { kind: "preference", key: "disliked_character", value: "Gin" },
        { kind: "preference", key: "disliked_element", value: "Filler cases" },
        { kind: "progress", key: "watch_progress", value: "Episode 120" },
        // A ninth entry that collapses into the first: were the list truncated
        // before the collapse, watch_progress would be dropped and this value
        // would never be the one kept.
        { kind: "preference", key: "favorite_character", value: "Ran", confidence: 0.95 },
      ]),
    ])

    const result = await extract(script)

    expect(result.candidates).toHaveLength(EXTRACTION_MAX_CANDIDATES)
    expect(result.candidates.map((candidate) => candidate.key)).toContain("watch_progress")
    expect(result.candidates[0].value).toBe("Ran")
    expect(result.candidates[0].confidence).toBe(0.95)
  })

  it("keeps a below-floor candidate: the floor is applied when consolidating", async () => {
    expect(CONFIDENCE_FLOOR).toBe(0.5)

    const script = scriptedCall([
      reply([
        { kind: "interest", key: "community_interest", value: "Fan art", confidence: 0.2 },
      ]),
    ])

    // Consolidation counts a low-confidence candidate as skipped; dropping it
    // here would make that skip invisible.
    const result = await extract(script)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].confidence).toBe(0.2)
  })

  it("gives up with no candidates after three failed attempts, never a throw", async () => {
    const invalid = scriptedCall([{ text: "not json at all" }])
    const failed = await extract(invalid)
    expect(failed.candidates).toEqual([])
    expect(failed.attempts).toBe(3)
    expect(failed.attempts).toBe(invalid.calls())
    expect(failed.reason).toBeTruthy()

    // A truncated answer is re-run rather than repaired, and still bounded.
    const truncated = scriptedCall([{ text: '{"candidates":[', finishReason: "length" }])
    const cut = await extract(truncated)
    expect(cut.candidates).toEqual([])
    expect(cut.attempts).toBe(3)
    expect(cut.attempts).toBe(truncated.calls())
    expect(cut.reason).toBeTruthy()
  })

  it("survives a call that throws, reporting the attempts actually made", async () => {
    let calls = 0
    const broken: StructuredCall = async () => {
      calls += 1
      throw new Error("provider exploded")
    }

    const result = await extractMemories({
      turns: TURNS,
      summary: null,
      call: broken,
      strict: true,
    })

    expect(result.candidates).toEqual([])
    expect(result.attempts).toBe(1)
    expect(result.attempts).toBe(calls)
    expect(result.reason).toContain("provider exploded")
  })
})
