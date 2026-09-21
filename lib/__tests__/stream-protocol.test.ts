import { describe, expect, it } from "vitest"
import type { CitationReport } from "@/lib/ai/citations"
import {
  SUMMARY_EVICTION,
  TURN_EVICTION_PREFIX,
} from "@/lib/ai/pipeline/assemble"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"
import type { PipelineResult } from "@/lib/ai/pipeline"
import {
  DEGRADED_REASONS,
  EMPTY_RESULT_REASON,
  PARTS,
  PARTIAL_ANSWER_REASON,
  PIPELINE_DEGRADE_REASONS,
  PROTOCOL_VERSION,
  RATE_LIMITED_REASON,
  ROUTE_DEGRADE_REASONS,
  SUMMARY_EVICTION_MARKER,
  SYNTHETIC_STATE_REASONS,
  TURN_EVICTION_MARKER,
  buildActivityPart,
  buildCitationsPart,
  buildDegradedPart,
  buildEvidencePart,
  isActivityPart,
  isCitationsPart,
  isDegradedPart,
  isEvidencePart,
  isKnownProtocol,
} from "@/lib/ai/stream/protocol"

/**
 * The transport's vocabulary is the contract both sides of the wire import, so
 * this file pins the names, the payload builders and the guards — nothing here
 * touches a stream, a network or React. The builders are pure copies of what
 * the route already computed; a test that found a builder measuring or
 * re-deriving a value would be a bug, not a missing feature.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const EVIDENCE: EvidenceRef[] = [
  { n: 1, id: "episode:1", tag: "[RET]", label: "Episode 1" },
  { n: 2, id: "wiki:dcw:ai-haibara", tag: "[WIKI]", label: "Ai Haibara" },
]

const REPORT: CitationReport = {
  cited: [EVIDENCE[0]],
  unknown: [],
  valid: true,
  uncited: false,
}

function pipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    version: "v2",
    messages: [],
    evidence: EVIDENCE,
    evicted: [],
    degraded: null,
    planSource: "router",
    toolNames: ["lookup_character"],
    timings: { planMs: 7, retrieveMs: 11, assembleMs: 3 },
    screening: { excluded: [], matches: 0, redacted: 0 },
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

describe("the protocol envelope", () => {
  it("names the four data parts in one place", () => {
    expect(PARTS).toEqual({
      evidence: "data-evidence",
      activity: "data-activity",
      degraded: "data-degraded",
      citations: "data-citations",
    })
  })

  it("carries version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(isKnownProtocol(1)).toBe(true)
    expect(isKnownProtocol(2)).toBe(false)
    // A string is a different value, not a coerced one.
    expect(isKnownProtocol("1")).toBe(false)
    expect(isKnownProtocol(undefined)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

describe("buildActivityPart", () => {
  it("copies the pipeline's plan facts verbatim", () => {
    const result = pipeline({ planSource: "model", toolNames: ["search_cases", "lookup_character"] })
    const part = buildActivityPart({ pipeline: result, retrieveMs: 999 })

    expect(part).toEqual({
      protocol: 1,
      planSource: "model",
      tools: ["search_cases", "lookup_character"],
      timings: { planMs: 7, retrieveMs: 11, assembleMs: 3 },
    })
  })

  it("reports v1's shape with nulls rather than fabricated zeroes", () => {
    const part = buildActivityPart({ pipeline: null, retrieveMs: 42 })

    expect(part).toEqual({
      protocol: 1,
      planSource: null,
      tools: [],
      timings: { planMs: null, retrieveMs: 42, assembleMs: null },
    })
  })

  it("does not alias the pipeline's tool list", () => {
    const result = pipeline({ toolNames: ["lookup_character"] })
    const part = buildActivityPart({ pipeline: result, retrieveMs: 0 })
    part.tools.push("search_cases")

    expect(result.toolNames).toEqual(["lookup_character"])
  })

  it("omits the evicted list when nothing was evicted", () => {
    const part = buildActivityPart({ pipeline: pipeline(), retrieveMs: 0 })

    // Not `[]`: an empty list is omitted, so a response that evicted nothing
    // keeps v1's exact shape rather than gaining a field that says nothing.
    expect(part).not.toHaveProperty("evicted")
  })

  it("carries a non-empty evicted list, copied", () => {
    const evicted = ["entry:6", "entry:5", "turns:2", "summary"]
    const result = pipeline({ evicted })
    const part = buildActivityPart({ pipeline: result, retrieveMs: 0 })

    expect(part.evicted).toEqual(evicted)
    expect(part.evicted).not.toBe(evicted)
    part.evicted?.push("entry:4")
    expect(result.evicted).toEqual(evicted)
  })

  it("omits the evicted list on the v1 shape", () => {
    // There is no pipeline to carry from, so there is nothing to say.
    expect(buildActivityPart({ pipeline: null, retrieveMs: 1 })).not.toHaveProperty("evicted")
  })
})

describe("buildEvidencePart", () => {
  it("carries the pipeline's refs verbatim", () => {
    const part = buildEvidencePart(pipeline())

    expect(part.refs).toEqual(EVIDENCE)
    // Equal in content, not the same array: a later mutation must not rewrite
    // what was already sent.
    expect(part.refs).not.toBe(EVIDENCE)
  })

  it("carries an empty ref list as an empty ref list", () => {
    expect(buildEvidencePart(pipeline({ evidence: [] })).refs).toEqual([])
  })
})

describe("buildDegradedPart", () => {
  it("returns null when there is no reason to report", () => {
    expect(buildDegradedPart([])).toBeNull()
    expect(buildDegradedPart([""])).toBeNull()
  })

  it("keeps reasons in order and drops duplicates", () => {
    expect(buildDegradedPart(["screened", "uncited", "screened"])).toEqual({
      reasons: ["screened", "uncited"],
    })
  })

  it("carries an unknown reason rather than hiding it", () => {
    // Task 6 renders a reason it has no wording for by name; the transport must
    // not be the thing that drops it.
    expect(buildDegradedPart(["a_reason_from_the_future"])).toEqual({
      reasons: ["a_reason_from_the_future"],
    })
  })
})

describe("buildCitationsPart", () => {
  it("carries the report verbatim", () => {
    expect(buildCitationsPart(REPORT)).toEqual({ report: REPORT })
  })
})

/* ------------------------------------------------------------------ */
/* Degrade vocabulary                                                  */
/* ------------------------------------------------------------------ */

describe("the degrade vocabulary", () => {
  it("exports the three synthetic state tokens by name", () => {
    expect(RATE_LIMITED_REASON).toBe("rate_limited")
    expect(EMPTY_RESULT_REASON).toBe("empty_result")
    expect(PARTIAL_ANSWER_REASON).toBe("partial_answer")
    expect(SYNTHETIC_STATE_REASONS).toEqual(["rate_limited", "empty_result", "partial_answer"])
  })

  it("lists every pipeline reason the client may receive", () => {
    for (const reason of [
      "pipeline_failed",
      "corpus_unavailable",
      "execute_budget",
      "ladder_failed",
      "tool_failed",
      "retrieval_budget",
      "evidence_evicted",
      "corpus_static",
    ]) {
      expect(PIPELINE_DEGRADE_REASONS).toContain(reason)
    }
  })

  it("lists the route's own reasons", () => {
    expect(ROUTE_DEGRADE_REASONS).toEqual(["screened", "uncited", "retrieval_failed"])
  })

  it("combines both vocabularies plus the synthetic tokens, without duplicates", () => {
    expect(DEGRADED_REASONS).toContain("screened")
    expect(DEGRADED_REASONS).toContain("uncited")
    expect(DEGRADED_REASONS).toContain("retrieval_failed")
    expect(DEGRADED_REASONS).toContain("rate_limited")
    expect(DEGRADED_REASONS.length).toBe(new Set(DEGRADED_REASONS).size)
  })
})

/* ------------------------------------------------------------------ */
/* The eviction vocabulary                                             */
/* ------------------------------------------------------------------ */

describe("the eviction vocabulary", () => {
  it("mirrors the assembler's own markers, so the copy cannot drift", () => {
    // The duplication is deliberate: this module is imported by a client
    // component, so it must stay browser-bundle-safe and cannot value-import
    // the assembler's constants. This assertion is what keeps the two equal.
    expect(TURN_EVICTION_MARKER).toBe(TURN_EVICTION_PREFIX)
    expect(SUMMARY_EVICTION_MARKER).toBe(SUMMARY_EVICTION)
  })

  it("keeps this module browser-bundle-safe: every import is a type import", async () => {
    // The duplication above exists only because this rule holds. A single value
    // import from the pipeline would pull the assembler, its tokenizer and the
    // whole retrieval stack into every client bundle that renders a trace, and
    // nothing else in the suite would notice. Reading the source is the check:
    // a bundle step would only catch it after the fact, and only for the one
    // entry point it happened to bundle.
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("lib/ai/stream/protocol.ts", "utf8")
    const imports = source.match(/^\s*import\s.+$/gm) ?? []

    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter((line) => !/^\s*import\s+type\s/.test(line))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

describe("the part guards", () => {
  it("accept a part the builders produced", () => {
    expect(isActivityPart(buildActivityPart({ pipeline: pipeline(), retrieveMs: 1 }))).toBe(true)
    expect(
      isActivityPart(
        buildActivityPart({ pipeline: pipeline({ evicted: ["turns:2"] }), retrieveMs: 1 })
      )
    ).toBe(true)
    expect(isActivityPart(buildActivityPart({ pipeline: null, retrieveMs: 1 }))).toBe(true)
    expect(isEvidencePart(buildEvidencePart(pipeline()))).toBe(true)
    expect(isDegradedPart(buildDegradedPart(["screened"]))).toBe(true)
    expect(isCitationsPart(buildCitationsPart(REPORT))).toBe(true)
  })

  it("reject a payload that is not a part", () => {
    for (const value of [null, undefined, 1, "data", []]) {
      expect(isActivityPart(value)).toBe(false)
      expect(isEvidencePart(value)).toBe(false)
      expect(isDegradedPart(value)).toBe(false)
      expect(isCitationsPart(value)).toBe(false)
    }
  })

  it("reject a malformed activity payload", () => {
    expect(isActivityPart({ protocol: 1, planSource: "router", tools: [], timings: {} })).toBe(false)
    expect(isActivityPart({ protocol: "1", planSource: null, tools: [], timings: {} })).toBe(false)
    expect(
      isActivityPart({
        protocol: 1,
        planSource: "guessed",
        tools: [],
        timings: { planMs: null, retrieveMs: null, assembleMs: null },
      })
    ).toBe(false)
    expect(
      isActivityPart({
        protocol: 1,
        planSource: null,
        tools: [1],
        timings: { planMs: null, retrieveMs: null, assembleMs: null },
      })
    ).toBe(false)
  })

  it("accept an activity part whose evicted list is absent or well-formed", () => {
    const base = {
      protocol: 1,
      planSource: null,
      tools: [],
      timings: { planMs: null, retrieveMs: null, assembleMs: null },
    }

    // Absent is the common case and must keep passing; an empty list is valid
    // even though the builder never sends one.
    expect(isActivityPart(base)).toBe(true)
    expect(isActivityPart({ ...base, evicted: [] })).toBe(true)
    expect(isActivityPart({ ...base, evicted: ["entry:6", "turns:2", "summary"] })).toBe(true)
  })

  it("reject a malformed evicted list", () => {
    const base = {
      protocol: 1,
      planSource: null,
      tools: [],
      timings: { planMs: null, retrieveMs: null, assembleMs: null },
    }

    expect(isActivityPart({ ...base, evicted: "none" })).toBe(false)
    expect(isActivityPart({ ...base, evicted: [1] })).toBe(false)
    expect(isActivityPart({ ...base, evicted: null })).toBe(false)
  })

  it("reject a malformed evidence or degraded payload", () => {
    expect(isEvidencePart({ refs: "none" })).toBe(false)
    expect(isDegradedPart({ reasons: [1] })).toBe(false)
    expect(isCitationsPart({ report: "none" })).toBe(false)
  })
})
