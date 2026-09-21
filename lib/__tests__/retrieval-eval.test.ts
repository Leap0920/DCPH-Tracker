import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import { parseSeedEntries } from "@/lib/ai/corpus/seed-sql"
import type { ContentEntryRow } from "@/lib/ai/corpus/tracker"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import {
  EVAL_K,
  evaluateRetrieval,
  recallAtK,
  RECALL_GATE,
  type GoldenCase,
} from "@/lib/ai/retrieval/eval"
import { runLadder } from "@/lib/ai/retrieval/ladder"
import { createStaticSource } from "@/lib/ai/retrieval/source"

/**
 * The golden eval harness has two halves.
 *
 * The first half is pure arithmetic over `ScoredDoc[]` and is tested here with
 * hand-built documents: the definition of a hit (any expected id inside the top
 * k), the emptiness case, and the report's shape. These tests pin the score the
 * gate later quotes, so a change to the definition cannot slip in unnoticed.
 *
 * The second half is the recall@5 gate over the real corpus. WHAT THIS NUMBER IS
 * AND IS NOT (plan deviation D5): it measures the ladder, the fusion and the
 * tracker scorer over an in-process approximation of the three RPCs, on the real
 * catalog seed and the real curated guides, with no database and no network.
 * `createStaticSource` implements the same three branches as the SQL but not
 * Postgres's exact ranking or its stemming, so this is NOT a live recall
 * measurement. The SQL's own quality is a manual check after
 * 20260919100000_ai_corpus.sql is applied to the remote project.
 */

const K = EVAL_K

/** A `ScoredDoc` shell: the harness only ever reads `doc.id`, `recallAtK` nothing else. */
function scored(id: string): ScoredDoc {
  const doc: CorpusDocument = {
    id,
    source: "content_entries",
    title: id,
    body: "",
    url: null,
    metadata: {},
  }
  return { doc, score: 0, rrf: 0, origins: [] }
}

/** The first n ids of a sequence, in order, as a ranked result list. */
function docs(ids: string[]): ScoredDoc[] {
  return ids.map(scored)
}

describe("recallAtK", () => {
  it("counts a hit at the last position of the window", () => {
    const result = docs(["a", "b", "c", "d", "entry:ep-001"])

    expect(recallAtK(result, ["entry:ep-001"])).toBe(1)
  })

  it("does not count a hit one position past the window", () => {
    const result = docs(["a", "b", "c", "d", "e", "entry:ep-001"])

    expect(recallAtK(result, ["entry:ep-001"])).toBe(0)
  })

  it("defaults k to EVAL_K", () => {
    // Position 5 (index 4) is inside the default window; position 6 is not.
    const inside = docs(["a", "b", "c", "d", "entry:ep-001"])
    const outside = docs(["a", "b", "c", "d", "e", "entry:ep-001"])

    expect(K).toBe(5)
    expect(recallAtK(inside, ["entry:ep-001"])).toBe(recallAtK(inside, ["entry:ep-001"], K))
    expect(recallAtK(outside, ["entry:ep-001"])).toBe(recallAtK(outside, ["entry:ep-001"], K))
  })

  it("honours an explicit k over the default", () => {
    const result = docs(["a", "b", "entry:ep-001"])

    expect(recallAtK(result, ["entry:ep-001"], 1)).toBe(0)
    expect(recallAtK(result, ["entry:ep-001"], 2)).toBe(0)
    expect(recallAtK(result, ["entry:ep-001"], 3)).toBe(1)
  })

  it("treats the order of expected ids as irrelevant", () => {
    const result = docs(["a", "character:ai-haibara", "b"])

    expect(recallAtK(result, ["character:ai-haibara", "entry:ep-001"])).toBe(1)
    expect(recallAtK(result, ["entry:ep-001", "character:ai-haibara"])).toBe(1)
  })

  it("returns 0 for an empty expected list", () => {
    // Not 1: an empty expectation is unanswerable, not vacuously satisfied.
    expect(recallAtK(docs(["a"]), [])).toBe(0)
  })

  it("returns 0 for an empty result list", () => {
    expect(recallAtK([], ["entry:ep-001"])).toBe(0)
  })
})

describe("evaluateRetrieval", () => {
  /** The case list's runner: every id maps to a document whose rank the test controls. */
  function runReturning(byQuery: Record<string, string[]>): (query: string) => Promise<ScoredDoc[]> {
    return async (query) => docs(byQuery[query] ?? [])
  }

  it("passes a case whose expected id is inside the window", async () => {
    const cases: GoldenCase[] = [{ q: "what is episode 1 about?", expected: ["entry:ep-001"] }]

    const report = await evaluateRetrieval(
      cases,
      runReturning({ "what is episode 1 about?": ["entry:ep-001", "entry:ep-002"] })
    )

    expect(report.total).toBe(1)
    expect(report.passed).toBe(1)
    expect(report.recallAt5).toBe(1)
    expect(report.misses).toEqual([])
  })

  it("lists only failures in misses and counts passed", async () => {
    const cases: GoldenCase[] = [
      { q: "hit", expected: ["entry:ep-001"] },
      { q: "miss", expected: ["entry:ep-002"] },
    ]

    const report = await evaluateRetrieval(
      cases,
      runReturning({
        hit: ["entry:ep-001"],
        miss: ["entry:ep-003", "entry:ep-004"],
      })
    )

    expect(report.total).toBe(2)
    expect(report.passed).toBe(1)
    expect(report.recallAt5).toBe(0.5)
    expect(report.misses.map((miss) => miss.q)).toEqual(["miss"])
  })

  it("records the searched window on a miss, capped at k", async () => {
    const cases: GoldenCase[] = [{ q: "q", expected: ["entry:ep-009"] }]

    const report = await evaluateRetrieval(
      cases,
      runReturning({
        q: [
          "entry:ep-001",
          "entry:ep-002",
          "entry:ep-003",
          "entry:ep-004",
          "entry:ep-005",
          "entry:ep-006",
        ],
      })
    )

    // The window is what the recall decision looked at, so the sixth id is
    // dropped: including it would describe a 6-document search in a @5 report.
    expect(report.misses[0].hits).toEqual([
      "entry:ep-001",
      "entry:ep-002",
      "entry:ep-003",
      "entry:ep-004",
      "entry:ep-005",
    ])
  })

  it("scores an empty case list as perfect rather than dividing by zero", async () => {
    const report = await evaluateRetrieval([], runReturning({}))

    expect(report.total).toBe(0)
    expect(report.passed).toBe(0)
    expect(report.recallAt5).toBe(1)
    expect(report.misses).toEqual([])
  })

  it("quotes a gate that the fixture can be measured against", () => {
    expect(RECALL_GATE).toBe(0.85)
  })
})

/**
 * The corpus the gate runs over, assembled exactly as the ingestion route
 * assembles it: the seed's rows projected onto `ContentEntryRow` (the parser
 * returns camelCase, the builder wants columns), then `buildCorpusDocuments`
 * with no other input, so the curated builders use their real guides. `cases`
 * stays empty -- the repo has no offline source for `dcw_cases` -- so only the
 * catalog and curated halves are measured.
 */
const seedSql = readFileSync(new URL("../../supabase/seed-content.sql", import.meta.url), "utf8")
const parsed = parseSeedEntries(seedSql)
const entries: ContentEntryRow[] = parsed.rows.map((row) => ({
  id: row.slug,
  slug: row.slug,
  title: row.title,
  type: row.type,
  episode_number: row.episodeNumber,
  movie_number: row.movieNumber,
  air_date: row.airDate,
  canon_order: row.canonOrder,
  release_order: null,
  arc_id: null,
  synopsis: row.synopsis,
  dcw_title: null,
}))

const corpusDocs = buildCorpusDocuments({ entries })
const source = createStaticSource(corpusDocs)
const corpusIds = new Set(corpusDocs.map((doc) => doc.id))

const cases: GoldenCase[] = JSON.parse(
  readFileSync(new URL("./fixtures/golden-qa.json", import.meta.url), "utf8")
)

/**
 * The gate's runner: the real ladder with an empty wiki dependency, so every
 * case is answered from the corpus alone. `limit: EVAL_K` keeps the requested
 * document count and the scored window the same number rather than two fives
 * that can drift apart.
 */
function run(query: string): Promise<ScoredDoc[]> {
  return runLadder({ query, limit: EVAL_K }, { source, wiki: async () => [] }).then(
    (result) => result.docs
  )
}

describe("golden fixture", () => {
  it("holds at least 50 cases, each expecting something", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50)

    for (const golden of cases) {
      expect(golden.q.length, golden.q).toBeGreaterThan(0)
      expect(golden.expected.length, golden.q).toBeGreaterThan(0)
    }
  })

  it("names only ids the offline corpus actually holds", () => {
    // The typo guard: a mistyped id cannot silently lower the gate, it fails
    // here with the id named.
    for (const golden of cases) {
      for (const id of golden.expected) {
        expect(corpusIds.has(id), `${golden.q} expects ${id}`).toBe(true)
      }
    }
  })
})

describe("retrieval recall gate", () => {
  it(
    "clears the recall@5 gate",
    async () => {
      const report = await evaluateRetrieval(cases, run)
      // The measured number on one line, before the gate: `npm run test:eval`
      // exists so a CI log shows this value, and a failing run shows the number
      // that failed rather than only the assertion's message (plan D4).
      console.log(
        `retrieval recall@5 ${report.recallAt5.toFixed(4)} (${report.passed}/${report.total}) ≥ ${RECALL_GATE}`
      )
      // The failing questions travel in the assertion message, so a regression
      // is diagnosable from CI output alone.
      const misses = JSON.stringify(report.misses.map((miss) => miss.q))

      expect(report.recallAt5, misses).toBeGreaterThanOrEqual(RECALL_GATE)
    },
    60000
  )

  it(
    "is deterministic across two full passes",
    async () => {
      const first = await evaluateRetrieval(cases, run)
      const second = await evaluateRetrieval(cases, run)

      expect(second.recallAt5, JSON.stringify(second.misses.map((miss) => miss.q))).toBe(
        first.recallAt5
      )
      expect(second.misses.map((miss) => miss.q)).toEqual(first.misses.map((miss) => miss.q))
    },
    60000
  )
})
