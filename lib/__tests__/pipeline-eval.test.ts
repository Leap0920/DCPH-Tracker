import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import { parseSeedEntries } from "@/lib/ai/corpus/seed-sql"
import type { ContentEntryRow } from "@/lib/ai/corpus/tracker"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import { assembleMessages, type EvidenceRef } from "@/lib/ai/pipeline/assemble"
import { executePlan } from "@/lib/ai/pipeline/execute"
import type { QueryPlan } from "@/lib/ai/pipeline/plan"
import { routeQuery } from "@/lib/ai/pipeline/router"
import type { RetrievalDeps } from "@/lib/ai/pipeline/source-resolver"
import { screenDocuments, WRAP } from "@/lib/ai/prompt/screen"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import { evaluateRetrieval, RECALL_GATE, type GoldenCase } from "@/lib/ai/retrieval/eval"
import { createStaticSource } from "@/lib/ai/retrieval/source"
import type { ToolContext } from "@/lib/ai/tools"

/**
 * The pipeline-level golden eval: the 60 fixture cases through the real stages —
 * `routeQuery` → `executePlan` → `screenDocuments` → `assembleMessages` — over
 * the real static corpus, with no model, no network and no database.
 *
 * It exists because the retrieval eval measures the ladder, and the ladder is
 * not what the model reads: screening can exclude a document and the 1,800-token
 * evidence budget can evict one, so the number that matters is the recall of the
 * documents the assembled prompt actually numbers. Report format and gate
 * constant are Plan 2's, reused through `evaluateRetrieval` with a runner that
 * goes through the pipeline, so the two evals cannot quote two definitions of
 * recall.
 *
 * The corpus assembly is copied verbatim from `retrieval-eval.test.ts` (plan
 * rule 1): same seed, same `ContentEntryRow` projection, same builder, same
 * static source, and the same fixture guard below, so a change to one eval's
 * corpus or fixture cannot leave the other measuring a different world.
 */

/* ------------------------------------------------------------------ */
/* The corpus, exactly as the retrieval eval assembles it              */
/* ------------------------------------------------------------------ */

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
const corpusById = new Map(corpusDocs.map((doc) => [doc.id, doc]))

const cases: GoldenCase[] = JSON.parse(
  readFileSync(new URL("./fixtures/golden-qa.json", import.meta.url), "utf8")
)

/**
 * The retrieval dependencies the route would resolve to after the reachability
 * probe fails: this process's own corpus. `wiki` is the resolver's no-admin stub
 * (`source-resolver.ts`), so the ladder's R4 costs nothing and returns nothing.
 */
const deps: RetrievalDeps = {
  source,
  wiki: async () => [],
  mode: "static",
  degraded: "corpus_static",
}

/** The tool context the route builds: the same source, no watch client and no
 *  transcript port, so `search_conversations` is the documented offline case and
 *  no tool can reach a database or the network. */
const toolCtx: ToolContext = {
  source,
  wiki: {
    async lookup() {
      return []
    },
    async put() {},
  },
}

/**
 * A marker-free stand-in for `buildSystemPrompt`'s output. The route owns the
 * real prompt and this eval does not test it; keeping the prefix short and free
 * of `WRAP.open` is what lets the wrap assertion below fail — the real prompt
 * names the marker in its legend, which would satisfy that assertion on its own.
 */
const SYSTEM_PROMPT = "DCPH Bot system prompt (the assembler's stable prefix)."

/* ------------------------------------------------------------------ */
/* One case through the pipeline                                       */
/* ------------------------------------------------------------------ */

interface CaseRun {
  q: string
  /** The plan the router produced, the one the executor ran. */
  plan: QueryPlan
  /** What screening admitted, before the budget evicted anything. */
  admitted: ScoredDoc[]
  /** The assembler's numbered refs: what the answer may cite. */
  evidence: EvidenceRef[]
  /** The ids the budget dropped. Doc ids only: no turns and no summary here. */
  evicted: string[]
  /** The assembled system message, the one model-facing string. */
  message: string
  /** `admitted`, in evidence order, for the recall window. */
  numbered: ScoredDoc[]
}

/** A `ScoredDoc` shell for an evidence id. The harness reads `doc.id` and
 *  nothing else, and the corpus holds the real document under every id. */
function numberedDoc(id: string): ScoredDoc {
  const doc: CorpusDocument = corpusById.get(id) ?? {
    id,
    source: "content_entries",
    title: id,
    body: "",
    url: null,
    metadata: {},
  }
  return { doc, score: 0, rrf: 0, origins: [] }
}

/** The route, minus the route: one message through every stage. */
async function runCase(query: string): Promise<CaseRun> {
  const routed = routeQuery({ message: query })
  const executed = await executePlan({
    plan: routed.plan,
    query,
    deps,
    toolCtx,
    // A frozen clock: the eval scores evidence, and `Date.now` in the report's
    // `ms` would be the one non-deterministic field in an otherwise pure run.
    now: () => 0,
  })
  const screened = screenDocuments(executed.docs)
  const assembled = assembleMessages({
    systemPrompt: SYSTEM_PROMPT,
    memories: "",
    summary: null,
    turns: [],
    docs: screened.admitted,
    wiki: executed.wiki,
  })

  return {
    q: query,
    plan: routed.plan,
    admitted: screened.admitted,
    evidence: assembled.report.evidence,
    evicted: assembled.report.evicted,
    message: assembled.messages[0].content,
    numbered: assembled.report.evidence.map((ref) => numberedDoc(ref.id)),
  }
}

/**
 * Every case, run once and shared by the structural tests: the pipeline is pure
 * (static source, frozen clock, no model), so one pass answers all of them, and
 * the gate below pays for its own pass through the harness instead.
 */
let runsPromise: Promise<CaseRun[]> | null = null

function pipelineRuns(): Promise<CaseRun[]> {
  runsPromise ??= (async () => {
    const runs: CaseRun[] = []
    for (const golden of cases) runs.push(await runCase(golden.q))
    return runs
  })()
  return runsPromise
}

/** A substring count, for "one marker pair per rendered document". */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/* ------------------------------------------------------------------ */
/* The fixture                                                         */
/* ------------------------------------------------------------------ */

describe("golden fixture", () => {
  it("holds the 60 cases, each expecting something", () => {
    expect(cases).toHaveLength(60)

    for (const golden of cases) {
      expect(golden.q.length, "an empty question").toBeGreaterThan(0)
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

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("pipeline recall gate", () => {
  const throughPipeline = (query: string): Promise<ScoredDoc[]> =>
    runCase(query).then((run) => run.numbered)

  it(
    "clears the recall@5 gate over the assembled evidence",
    async () => {
      const report = await evaluateRetrieval(cases, throughPipeline)
      // The measured number on one line, before the gate: `npm run test:eval`
      // exists so a CI log shows this value, and a failing run shows the number
      // that failed rather than only the assertion's message (plan D4).
      console.log(
        `pipeline-level recall ${report.recallAt5.toFixed(4)} (${report.passed}/${report.total}) ≥ ${RECALL_GATE}`
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
      const first = await evaluateRetrieval(cases, throughPipeline)
      const second = await evaluateRetrieval(cases, throughPipeline)

      expect(second.recallAt5, JSON.stringify(second.misses.map((miss) => miss.q))).toBe(
        first.recallAt5
      )
      expect(second.misses.map((miss) => miss.q)).toEqual(first.misses.map((miss) => miss.q))
    },
    60000
  )
})

/* ------------------------------------------------------------------ */
/* What the assembled prompt promises                                  */
/* ------------------------------------------------------------------ */

describe("assembled evidence", () => {
  it("numbers at least one document for every case", async () => {
    const runs = await pipelineRuns()
    const failures = runs.filter((run) => run.evidence.length === 0).map((run) => run.q)

    expect(failures, JSON.stringify(failures)).toEqual([])
  })

  it("numbers every case densely from [E1]", async () => {
    const runs = await pipelineRuns()
    const failures: string[] = []

    for (const run of runs) {
      // A set, not the array order: what matters is that no number is skipped
      // and none is repeated, because an answer cites [E#] and nothing else.
      const numbers = [...new Set(run.evidence.map((ref) => ref.n))].sort((a, b) => a - b)
      const expected = run.evidence.map((_, index) => index + 1)
      const dense = numbers.length === expected.length && numbers.every((n, i) => n === expected[i])

      if (!dense) failures.push(`${run.q}: [${numbers.join(",")}] of ${run.evidence.length}`)
      if (run.evidence.length > 0 && !run.message.includes("[E1]")) {
        failures.push(`${run.q}: the message numbers no [E1]`)
      }
    }

    expect(failures, JSON.stringify(failures)).toEqual([])
  })

  it("wraps every rendered document between the evidence markers", async () => {
    // The prefix carries no marker, so a marker pair in the message can only
    // have come from the wrapper around a rendered document (plan rule 2).
    expect(SYSTEM_PROMPT).not.toContain(WRAP.open)

    const runs = await pipelineRuns()
    const failures: string[] = []

    for (const run of runs) {
      const opens = occurrences(run.message, WRAP.open)
      const closes = occurrences(run.message, WRAP.close)

      // Exactly one pair per rendered document: screening excludes a document
      // carrying a marker, and `wrapEvidence` is idempotent, so a higher count
      // is a delimiter-break or a double wrap, not a wrapping miss.
      if (opens !== run.evidence.length || closes !== run.evidence.length) {
        failures.push(
          `${run.q}: ${opens} open / ${closes} close for ${run.evidence.length} evidence refs`
        )
      }
    }

    expect(failures, JSON.stringify(failures)).toEqual([])
  })

  it("keeps only screened documents in the numbered evidence", async () => {
    const runs = await pipelineRuns()
    const failures: string[] = []

    for (const run of runs) {
      const admitted = new Set(run.admitted.map((entry) => entry.doc.id))
      const survivors = run.evidence.map((ref) => ref.id)
      const strangers = survivors.filter((id) => !admitted.has(id))
      const duplicates = survivors.filter((id, index) => survivors.indexOf(id) !== index)
      // Eviction names ids the assembler was handed; a turn or summary marker
      // cannot appear here because neither input is non-empty.
      const unknownEvictions = run.evicted.filter((id) => !admitted.has(id))

      if (strangers.length > 0) failures.push(`${run.q}: rendered unscreened ${strangers.join(",")}`)
      if (duplicates.length > 0) failures.push(`${run.q}: numbered ${duplicates.join(",")} twice`)
      if (unknownEvictions.length > 0) {
        failures.push(`${run.q}: evicted ${unknownEvictions.join(",")} it never held`)
      }
    }

    expect(failures, JSON.stringify(failures)).toEqual([])
  })

  it("sets needsLore on every case the fixture marks for lore", async () => {
    const loreCases = cases.filter((entry) => entry.needsLore === true)
    // The count the router's own calibration is measured on, so a fixture edit
    // cannot silently shrink this test to a vacuous pass.
    expect(loreCases).toHaveLength(11)

    const runs = await pipelineRuns()
    const byQuery = new Map(runs.map((run) => [run.q, run]))
    const missed = loreCases
      .filter((entry) => byQuery.get(entry.q)?.plan.needsLore !== true)
      .map((entry) => entry.q)

    expect(missed, JSON.stringify(missed)).toEqual([])
  })
})
