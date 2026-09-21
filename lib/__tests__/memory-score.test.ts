import { describe, expect, it } from "vitest"
import type { MemoryFact } from "@/lib/ai/memory/port"
import {
  CHARS_PER_TOKEN,
  HALF_LIFE_DAYS,
  MEMORY_LIMIT,
  MEMORY_TOKEN_BUDGET,
  W_CONFIDENCE,
  W_LEXICAL,
  W_RECENCY,
  lexicalMatch,
  renderMemoryBlock,
  scoreMemory,
  selectMemories,
} from "@/lib/ai/memory/score"

/**
 * Decay scoring and selection (Task 9).
 *
 * The numbers are asserted exactly rather than as ranges, because this module
 * decides what the model is told about the user: a weight that drifts changes
 * the prompt for every turn, and a range would not notice. Time is a fixed
 * constant handed in through the options (constraint 11) -- nothing here reads
 * a clock, touches a network or constructs a client.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111"
const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

function fact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    userId: USER_ID,
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.9,
    status: "active",
    supersededBy: null,
    sourceMessageId: null,
    evidenceCount: 1,
    lastConfirmedAt: NOW,
    expiresAt: null,
    ...overrides,
  }
}

/** The token cost the budget charges for a fact, read off its rendered line. */
function lineCost(row: MemoryFact): number {
  return Math.ceil(renderMemoryBlock([row]).length / CHARS_PER_TOKEN)
}

describe("scoring constants", () => {
  it("pins the weights, the half-life and the budget Task 11 and Task 12 build on", () => {
    expect(HALF_LIFE_DAYS).toBe(45)
    // The three weights sum to 1, which is what makes a perfect fact score
    // exactly 1 and nothing score above it.
    expect([W_LEXICAL, W_CONFIDENCE, W_RECENCY]).toEqual([0.55, 0.25, 0.2])
    expect(W_LEXICAL + W_CONFIDENCE + W_RECENCY).toBe(1)
    expect(MEMORY_LIMIT).toBe(12)
    expect(MEMORY_TOKEN_BUDGET).toBe(200)
    expect(CHARS_PER_TOKEN).toBe(4)
  })
})

describe("lexicalMatch", () => {
  it("is the fraction of query tokens found in the key and the value", () => {
    const row = fact({ id: "row" })

    expect(lexicalMatch(["haibara"], row)).toBe(1)
    expect(lexicalMatch(["haibara", "movie"], row)).toBe(0.5)
    expect(lexicalMatch(["movie"], row)).toBe(0)
  })

  it("matches case- and punctuation-insensitively, on tokens as given", () => {
    const row = fact({ id: "row", value: "Haibara!" })

    // The token arrives from tokenize() normally, but a raw word must not score
    // zero merely because the caller did not lowercase it.
    expect(lexicalMatch(["Haibara"], row)).toBe(1)
    expect(lexicalMatch(["favorite", "haibara"], row)).toBe(1)
    expect(lexicalMatch(["character"], row)).toBe(1)
  })

  it("scores 0 for an empty token list, never 1", () => {
    // Otherwise a message with no keywords ("hi") would select every fact as
    // perfectly relevant instead of falling back to confidence and recency.
    expect(lexicalMatch([], fact({ id: "row" }))).toBe(0)
  })
})

describe("scoreMemory", () => {
  it("scores exactly 1 for a fully matched, fully confident fact confirmed now", () => {
    const perfect = fact({ id: "perfect", confidence: 1, lastConfirmedAt: NOW })

    expect(scoreMemory(perfect, ["favorite", "haibara"], NOW)).toBe(1)
  })

  it("halves the recency term at the 45-day half-life", () => {
    const stale = fact({ id: "stale", confidence: 1, lastConfirmedAt: NOW - HALF_LIFE_DAYS * DAY_MS })

    const expected = W_LEXICAL + W_CONFIDENCE + W_RECENCY * Math.exp(-1)
    expect(scoreMemory(stale, ["haibara"], NOW)).toBe(expected)
  })

  it("treats a future lastConfirmedAt as age zero, never as a bonus", () => {
    const future = fact({ id: "future", confidence: 1, lastConfirmedAt: NOW + 30 * DAY_MS })

    // Clock skew must not push a fact above the perfect score.
    expect(scoreMemory(future, ["haibara"], NOW)).toBe(1)
    expect(scoreMemory(future, ["haibara"], NOW)).toBe(scoreMemory(fact({ id: "now", confidence: 1 }), ["haibara"], NOW))
  })

  it("applies each weight to its own term", () => {
    const mixed = fact({ id: "mixed", confidence: 0.5, lastConfirmedAt: NOW })

    // One of two tokens, half confidence, no age: the three terms in isolation.
    expect(scoreMemory(mixed, ["haibara", "movie"], NOW)).toBe(
      W_LEXICAL * 0.5 + W_CONFIDENCE * 0.5 + W_RECENCY
    )
  })
})

describe("selectMemories", () => {
  it("keeps only active facts that have not expired, dropping the boundary instant", () => {
    const active = fact({ id: "active" })
    const live = fact({ id: "live", expiresAt: NOW + 1 })
    const statusExpired = fact({ id: "status-expired", status: "expired" })
    const superseded = fact({ id: "superseded", status: "superseded", supersededBy: "other" })
    const lapsed = fact({ id: "lapsed", expiresAt: NOW - 1 })
    const boundary = fact({ id: "boundary", expiresAt: NOW })

    const selected = selectMemories([live, boundary, lapsed, statusExpired, superseded, active], "", {
      now: NOW,
    })

    // `expiresAt <= now` is expired: the shelf life is over the instant it ends.
    expect(selected.map((row) => row.id)).toEqual(["active", "live"])
  })

  it("tokenises the query itself, so the on-topic fact beats the confident one", () => {
    const confident = fact({ id: "confident", value: "Ayumi", confidence: 0.95 })
    const onTopic = fact({ id: "on-topic", value: "Haibara", confidence: 0.5, lastConfirmedAt: NOW - 200 * DAY_MS })

    // A real question, stopword and all: tokenize() reduces it to "haibara".
    expect(selectMemories([confident, onTopic], "Who is Haibara?", { now: NOW }).map((r) => r.id)).toEqual([
      "on-topic",
      "confident",
    ])
    // With nothing to match, relevance is gone and confidence decides.
    expect(selectMemories([confident, onTopic], "", { now: NOW }).map((r) => r.id)).toEqual([
      "confident",
      "on-topic",
    ])
  })

  it("caps the result at limit and defaults to MEMORY_LIMIT", () => {
    const facts = Array.from({ length: MEMORY_LIMIT + 1 }, (_, index) =>
      fact({ id: `f${String(index).padStart(2, "0")}` })
    )

    const defaulted = selectMemories(facts, "", { now: NOW, tokenBudget: 10_000 })
    expect(defaulted).toHaveLength(MEMORY_LIMIT)
    expect(defaulted.map((row) => row.id)).toEqual(facts.slice(0, MEMORY_LIMIT).map((row) => row.id))

    expect(selectMemories(facts, "", { now: NOW, limit: 2, tokenBudget: 10_000 }).map((r) => r.id)).toEqual([
      "f00",
      "f01",
    ])
  })

  it("breaks ties by score, then lastConfirmedAt descending, then id ascending", () => {
    const nowRow = fact({ id: "now" })
    const tomorrow = fact({ id: "tomorrow", lastConfirmedAt: NOW + DAY_MS })
    const nextWeek = fact({ id: "next-week", lastConfirmedAt: NOW + 7 * DAY_MS })

    // All three clamp to age zero and score identically, so the timestamp is
    // what orders them -- and the id order below is deliberately different, so
    // a missing time tie-break fails this assertion.
    expect(
      selectMemories([nowRow, nextWeek, tomorrow], "haibara", { now: NOW }).map((row) => row.id)
    ).toEqual(["next-week", "tomorrow", "now"])

    // Same instant and same score: the id decides, so the block never flickers
    // between two runs with the same inputs.
    const zed = fact({ id: "zed" })
    const abe = fact({ id: "abe" })
    expect(selectMemories([zed, abe], "haibara", { now: NOW }).map((row) => row.id)).toEqual(["abe", "zed"])
  })

  it("fills the token budget to the exact token and drops what comes after", () => {
    const a = fact({ id: "a", value: "Alpha" })
    const b = fact({ id: "b", value: "Bravo" })
    const c = fact({ id: "c", value: "Charlie" })
    const exact = lineCost(a) + lineCost(b)

    // The running total may reach the budget exactly but not pass it.
    expect(selectMemories([a, b, c], "", { now: NOW, tokenBudget: exact }).map((r) => r.id)).toEqual(["a", "b"])
    expect(selectMemories([a, b, c], "", { now: NOW, tokenBudget: exact - 1 }).map((r) => r.id)).toEqual(["a"])
  })

  it("keeps the block a prefix of the ranking once the budget cannot take the next fact", () => {
    const a = fact({ id: "a", value: "Alpha" })
    const b = fact({ id: "b", value: "Bravo" })
    const big = fact({ id: "big", value: "Charlie".repeat(30) })
    const small = fact({ id: "small", value: "Delta" })
    const room = lineCost(small)
    const budget = lineCost(a) + lineCost(b) + room

    // `small` would fit in the leftover room, but it ranks behind `big`, and a
    // fact that does not fit drops the rest of the ranking with it: skipping
    // ahead would spend prompt room on a lower-ranked fact while the better one
    // is missing.
    expect(lineCost(big)).toBeGreaterThan(room)
    expect(selectMemories([a, b, big, small], "", { now: NOW, tokenBudget: budget }).map((r) => r.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("truncates a single fact that alone exceeds the budget instead of dropping it", () => {
    const huge = fact({ id: "huge", value: "x".repeat(2000) })

    // 12 tokens is 48 characters: the key and the confidence tag survive, and
    // the value is cut to the room that is left.
    const selected = selectMemories([huge], "haibara", { now: NOW, tokenBudget: 12 })

    expect(selected).toHaveLength(1)
    expect(renderMemoryBlock(selected)).toBe(`[MEM] favorite_character: ${"x".repeat(11)} (conf 0.9)`)
    // The cut is made on a copy: the caller's fact is never mutated (rule 7).
    expect(selected[0]).not.toBe(huge)
    expect(huge.value).toHaveLength(2000)
  })

  it("is pure: an empty list stays empty and the caller's array is untouched", () => {
    const first = fact({ id: "first", confidence: 0.1 })
    const second = fact({ id: "second", confidence: 0.9 })
    const input = [first, second]

    const selected = selectMemories(input, "haibara", { now: NOW })

    expect(selectMemories(input, "haibara", { now: NOW })).toEqual(selected)
    expect(selected).not.toBe(input)
    expect(input).toEqual([fact({ id: "first", confidence: 0.1 }), fact({ id: "second", confidence: 0.9 })])
    expect(selectMemories([], "haibara", { now: NOW })).toEqual([])
  })
})

describe("renderMemoryBlock", () => {
  it("emits one [MEM] line per fact, confidence rounded to two decimals", () => {
    expect(
      renderMemoryBlock([
        fact({ id: "a", key: "favorite_character", value: "Haibara", confidence: 0.9 }),
        fact({ id: "b", key: "watch_status", value: "caught up to episode 500", confidence: 0.75 }),
      ])
    ).toBe(
      "[MEM] favorite_character: Haibara (conf 0.9)\n[MEM] watch_status: caught up to episode 500 (conf 0.75)"
    )

    // Rounded, not padded: the format is "0.9", and a whole number stays "1".
    expect(renderMemoryBlock([fact({ id: "c", confidence: 1 })])).toBe(
      "[MEM] favorite_character: Haibara (conf 1)"
    )
    expect(renderMemoryBlock([fact({ id: "d", confidence: 0.906 })])).toBe(
      "[MEM] favorite_character: Haibara (conf 0.91)"
    )
    expect(renderMemoryBlock([fact({ id: "e", confidence: 0.904 })])).toBe(
      "[MEM] favorite_character: Haibara (conf 0.9)"
    )
  })

  it("returns an empty string for an empty list, so the caller injects no section", () => {
    expect(renderMemoryBlock([])).toBe("")
  })
})
