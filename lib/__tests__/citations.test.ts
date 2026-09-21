import { describe, expect, it } from "vitest"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import {
  CITATION_PATTERN,
  MAX_CITATIONS,
  citationInstruction,
  citationSuffix,
  parseCitations,
  validateCitations,
} from "@/lib/ai/citations"

/**
 * The citation contract is a check, not a requirement: the model is asked to
 * cite, and this module decides what actually happened. Its value is entirely
 * in what it refuses to accept, so the reject list below is the point of the
 * file — a lenient parser would validate citations the model never made.
 *
 * What is pinned here, in order: the grammar (accepted shapes, one test case
 * per rejected shape), uniqueness and order, linear parsing on a 20 kB answer,
 * resolution against the supplied `EvidenceRef[]`, the two meanings of
 * `requireCitation`, and the deliberate absence of a rendered suffix in
 * Phase 4.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** The ids the assembler would have handed over: dense, 1-based, unique. */
const EVIDENCE: EvidenceRef[] = [
  { n: 1, id: "episode:1", tag: "[RET]", label: "Episode 1" },
  { n: 2, id: "wiki:dcw:ai-haibara", tag: "[WIKI]", label: "Ai Haibara" },
  { n: 3, id: "case:poison", tag: "[RET]", label: "Poison cases" },
]

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

describe("parseCitations", () => {
  it("accepts [E1], adjacent [E1][E2] and two-digit ids in prose", () => {
    expect(parseCitations("[E1]")).toEqual([1])
    expect(parseCitations("[E1][E2]")).toEqual([1, 2])
    expect(parseCitations("Both agree [E2][E10], as the wiki says.")).toEqual([2, 10])

    // The exported pattern is global, so a caller that ran `test` on it leaves
    // a `lastIndex` behind; parsing clones via `matchAll`, so it is unaffected.
    CITATION_PATTERN.test("[E7]")
    expect(parseCitations("[E1]")).toEqual([1])
  })

  it("returns unique numbers in first-appearance order", () => {
    expect(parseCitations("[E3] first, [E1] next, [E3] again, then [E1][E2]")).toEqual([3, 1, 2])
  })

  it("returns nothing when the answer cites nothing", () => {
    expect(parseCitations("")).toEqual([])
    expect(parseCitations("No ids here, just prose and a [bracket].")).toEqual([])
  })

  it("reads a citation inside a fenced code block like any other", () => {
    // Deliberate: fences are not special-cased (the prompt has a no-code rule,
    // and re-implementing Markdown here would buy nothing). Asserted so the
    // choice is visible rather than assumed.
    expect(parseCitations("```\n[E1]\n```")).toEqual([1])
  })

  it("parses a 20 kB answer without backtracking", () => {
    // The shape that would blow up a backtracking pattern: an open bracket, an
    // id prefix, and no closing bracket, twenty thousand times over.
    const adversarial = "[E".repeat(10_000)
    const answer = `${adversarial} [E1] and [E2].`

    const started = performance.now()
    const cited = parseCitations(answer)
    const elapsed = performance.now() - started

    expect(answer.length).toBeGreaterThan(20_000)
    expect(cited).toEqual([1, 2])
    expect(elapsed).toBeLessThan(250)
  })

  it.each([
    ["[E1, E2]", "two ids in one bracket"],
    ["[e1]", "lowercase id"],
    ["(E1)", "parentheses"],
    ["[E1 ]", "space before the bracket closes"],
    ["[E0]", "zero is not an id"],
    ["[E-1]", "a sign"],
    ["[E1.5]", "a decimal"],
    ["[[E1]]", "a doubled bracket"],
  ])("does not read %s as a citation (%s)", (text) => {
    expect(parseCitations(text)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe("validateCitations", () => {
  it("resolves cited numbers to the supplied evidence, in the answer's order", () => {
    const report = validateCitations({
      text: "The watch was a gift [E3]. He confirms it later [E1].",
      evidence: EVIDENCE,
      requireCitation: true,
    })

    expect(report.cited).toEqual([EVIDENCE[2], EVIDENCE[0]])
    expect(report.unknown).toEqual([])
    expect(report.valid).toBe(true)
    expect(report.uncited).toBe(false)

    // The report is the whole output: no rewritten-answer field exists, so
    // nothing downstream can accidentally replace the stream (D3).
    expect(Object.keys(report).sort()).toEqual(["cited", "uncited", "unknown", "valid"])
  })

  it("reports a number beyond the supplied evidence as unknown, not as a parse miss", () => {
    const report = validateCitations({
      text: "It happened in the manga [E12].",
      evidence: EVIDENCE, // three refs: 12 was never supplied
      requireCitation: true,
    })

    expect(report.cited).toEqual([])
    expect(report.unknown).toEqual([12])
    expect(report.valid).toBe(false)
    expect(report.uncited).toBe(true)
  })

  it("keeps resolved and fabricated citations apart", () => {
    const report = validateCitations({
      text: "Real [E2] and invented [E9].",
      evidence: EVIDENCE,
      requireCitation: true,
    })

    expect(report.cited).toEqual([EVIDENCE[1]])
    expect(report.unknown).toEqual([9])
    expect(report.valid).toBe(false)
    expect(report.uncited).toBe(false)
  })

  it("is uncited when evidence was supplied but nothing valid was cited", () => {
    const report = validateCitations({
      text: "I am not sure about that one.",
      evidence: EVIDENCE,
      requireCitation: true,
    })

    expect(report.cited).toEqual([])
    expect(report.unknown).toEqual([])
    expect(report.valid).toBe(false)
    expect(report.uncited).toBe(true)
  })

  it("is valid and not uncited when no citation was required (chit-chat turn)", () => {
    const report = validateCitations({
      text: "Hi! Ask me about the show whenever you like.",
      evidence: [],
      requireCitation: false,
    })

    expect(report).toEqual({ cited: [], unknown: [], valid: true, uncited: false })
  })

  it("still fails when no evidence was supplied and the answer cites one anyway", () => {
    // `requireCitation: false` forgives a missing citation, not a fabricated
    // one: a `[E1]` for a block that was never sent must not pass.
    const report = validateCitations({
      text: "As proven in [E1].",
      evidence: [],
      requireCitation: false,
    })

    expect(report.cited).toEqual([])
    expect(report.unknown).toEqual([1])
    expect(report.valid).toBe(false)
    expect(report.uncited).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Prompt fragment and suffix                                          */
/* ------------------------------------------------------------------ */

describe("citationInstruction", () => {
  it("is one short string naming the syntax, the ceiling and the honesty rule", () => {
    const instruction = citationInstruction(MAX_CITATIONS)

    expect(typeof instruction).toBe("string")
    expect(instruction).toContain("[E1]")
    expect(instruction).toContain(`[E${MAX_CITATIONS}]`)
    expect(instruction).toContain("[E1][E2]")
    expect(instruction).toContain("you actually used")
    expect(instruction).toContain("never every id")
    expect(instruction).toContain("does not contain the answer")
    expect(instruction.length).toBeLessThan(600)

    // Task 10 embeds the return value verbatim; a different ceiling is the same
    // instruction with a different last id.
    const four = citationInstruction(4)
    expect(four).toContain("[E4]")
    expect(four).not.toContain("[E12]")
  })
})

describe("citationSuffix", () => {
  it("is null in Phase 4 — the rendered marker is deliberately absent", () => {
    // Pinned so the absence stays visible: when Phase 5 adds a visible suffix,
    // this is the test that must change.
    const valid = validateCitations({
      text: "It is [E1].",
      evidence: EVIDENCE,
      requireCitation: true,
    })
    const degraded = validateCitations({
      text: "No ids at all.",
      evidence: EVIDENCE,
      requireCitation: true,
    })

    expect(valid.valid).toBe(true)
    expect(degraded.uncited).toBe(true)
    expect(citationSuffix(valid)).toBeNull()
    expect(citationSuffix(degraded)).toBeNull()
  })
})
