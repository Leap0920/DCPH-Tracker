import { describe, expect, it, vi } from "vitest"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { DocumentSource, SearchHit } from "@/lib/ai/retrieval/source"
import {
  DEFAULT_LADDER_LIMIT,
  ENTITY_CANDIDATES,
  EVIDENCE_THRESHOLD,
  FUZZY_CANDIDATES,
  LADDER_BUDGET_MS,
  LADDER_CANDIDATES,
  runLadder,
  type WikiEvidence,
} from "@/lib/ai/retrieval/ladder"

/**
 * The ladder is the module Plan 4's orchestrator calls, and the two properties
 * that matter most are not about ranking at all.
 *
 * One: a broken branch must be indistinguishable from a working one only in the
 * answer it degrades, never in the record — "retrieval broke" and "nothing
 * matched" were indistinguishable before, so every round's outcome (ran,
 * skipped, failed) has to reach `steps`.
 *
 * Two: the evidence threshold counts distinct candidate ids, not hydrated
 * documents. Re-counting after hydration would let one missing row silently
 * re-run an expensive round.
 *
 * Nothing here uses a real clock: `now` is injected precisely so the budget can
 * be spent by moving a number, not by waiting.
 */

/** One entry document — enough for the scorer to rank on title and air date. */
function entryDoc(index: number, title: string, airDate = "2000-01-01"): CorpusDocument {
  return {
    id: `entry:ep-${index}`,
    source: "content_entries",
    title,
    body: "",
    url: null,
    metadata: { air_date: airDate },
    episodeNumber: index,
  }
}

const haibaraDoc: CorpusDocument = {
  id: "character:ai-haibara",
  source: "characters",
  title: "Ai Haibara",
  body: "A former Black Organization chemist.",
  url: null,
  metadata: {},
  aliases: ["sherry", "shiho"],
}

/** Hits in the order the branch claims them; the ladder never reads `score`. */
function hits(ids: string[]): SearchHit[] {
  return ids.map((id, index) => ({ id, score: ids.length - index }))
}

type ScriptedHits = SearchHit[] | (() => SearchHit[])

interface FakeSource {
  source: DocumentSource
  entityCalls: Array<{ numbers: number[]; names: string[]; limit: number }>
  fullTextCalls: Array<{ query: string; limit: number }>
  fuzzyCalls: Array<{ query: string; keywords: string[]; limit: number }>
  fetchCalls: string[][]
}

/**
 * A DocumentSource that records every call's arguments and returns scripted
 * hits. A scripted value may be a thunk, which is also how a branch is made to
 * reject. `onEntity` runs while R1 is in flight — the hook a test uses to move
 * the injected clock between rounds.
 */
function fakeSource(spec: {
  entity?: ScriptedHits
  fullText?: ScriptedHits
  fuzzy?: ScriptedHits
  /** Only these ids hydrate; anything else is a deliberate miss. */
  docs?: CorpusDocument[]
  onEntity?: () => void
}): FakeSource {
  const entityCalls: FakeSource["entityCalls"] = []
  const fullTextCalls: FakeSource["fullTextCalls"] = []
  const fuzzyCalls: FakeSource["fuzzyCalls"] = []
  const fetchCalls: FakeSource["fetchCalls"] = []

  const scripted = (value: ScriptedHits | undefined): SearchHit[] =>
    typeof value === "function" ? value() : (value ?? [])

  const byId = new Map((spec.docs ?? []).map((doc) => [doc.id, doc]))

  return {
    entityCalls,
    fullTextCalls,
    fuzzyCalls,
    fetchCalls,
    source: {
      async entity(input) {
        entityCalls.push(input)
        spec.onEntity?.()
        return scripted(spec.entity)
      },
      async fullText(query, limit) {
        fullTextCalls.push({ query, limit })
        return scripted(spec.fullText)
      },
      async fuzzy(query, keywords, limit) {
        fuzzyCalls.push({ query, keywords, limit })
        return scripted(spec.fuzzy)
      },
      async fetch(ids) {
        fetchCalls.push(ids)
        return ids.flatMap((id) => {
          const doc = byId.get(id)
          return doc ? [doc] : []
        })
      },
    },
  }
}

/** A clock the test drives by hand; the ladder only ever reads it. */
function fakeClock() {
  let time = 0
  return {
    now: () => time,
    set: (value: number) => {
      time = value
    },
  }
}

const noWiki = () => vi.fn(async (): Promise<WikiEvidence[]> => [])

describe("runLadder", () => {
  it("stops after R1 and R2 once the threshold is met", async () => {
    const clock = fakeClock()
    const docs = Array.from({ length: 8 }, (_, index) =>
      entryDoc(index + 1, `Mountain Lodge Case ${index + 1}`)
    )
    const fake = fakeSource({
      entity: hits(docs.slice(0, 4).map((doc) => doc.id)),
      fullText: hits(docs.slice(4).map((doc) => doc.id)),
      docs,
    })
    // needsLore is on purpose: with the evidence already in hand the wiki round
    // must not be spent, even though the caller would allow one.
    const wiki = noWiki()

    const result = await runLadder(
      { query: "mountain lodge", needsLore: true },
      { source: fake.source, wiki, now: clock.now }
    )

    expect(result.steps.map((step) => step.round)).toEqual([1, 2])
    expect(result.steps.every((step) => step.skipped === null)).toBe(true)
    expect(fake.fuzzyCalls).toEqual([])
    expect(wiki).not.toHaveBeenCalled()
    expect(result.wiki).toEqual([])
    expect(result.degraded).toBeNull()
    expect(result.docs.length).toBeGreaterThanOrEqual(EVIDENCE_THRESHOLD)
  })

  it("adds R3 when the first two rounds fall short and stops when it crosses the threshold", async () => {
    const clock = fakeClock()
    const docs = Array.from({ length: 6 }, (_, index) =>
      entryDoc(index + 1, `Mountain Lodge Case ${index + 1}`)
    )
    const fake = fakeSource({
      entity: hits([docs[0].id]),
      fullText: hits([docs[1].id]),
      fuzzy: hits([docs[2].id, docs[3].id, docs[4].id, docs[5].id]),
      docs,
    })
    const wiki = noWiki()

    const result = await runLadder(
      { query: "mountain lodge", needsLore: true },
      { source: fake.source, wiki, now: clock.now }
    )

    // Exactly the two candidates R1 and R2 found force R3; R3's four more reach
    // the threshold, so the wiki round is never reached.
    expect(result.steps.map((step) => step.round)).toEqual([1, 2, 3])
    expect(result.steps[2]).toMatchObject({ branch: "fuzzy", hits: 4, skipped: null })
    expect(fake.fuzzyCalls).toHaveLength(1)
    expect(wiki).not.toHaveBeenCalled()
    expect(result.docs).toHaveLength(6)
  })

  it("asks R1 for the entity pool with the normalized query and the derived numbers", async () => {
    const clock = fakeClock()
    const doc = entryDoc(500, "The Clash of Red and Black")
    const fake = fakeSource({ entity: hits([doc.id]), docs: [doc] })

    await runLadder({ query: "what happens in episode 500" }, { source: fake.source, now: clock.now })

    expect(fake.entityCalls).toEqual([
      {
        numbers: [500],
        names: ["what happens in episode 500", "500"],
        limit: ENTITY_CANDIDATES,
      },
    ])
    expect(fake.fullTextCalls).toEqual([
      { query: "what happens in episode 500", limit: LADDER_CANDIDATES },
    ])
  })

  it("derives R3's keywords from the query", async () => {
    const clock = fakeClock()
    const fake = fakeSource({
      fuzzy: hits([haibaraDoc.id]),
      docs: [haibaraDoc],
    })

    await runLadder({ query: "who is Ai Haibara" }, { source: fake.source, now: clock.now })

    // The keywords keep the query's word order, not the specificity order the
    // cap is decided by: the scorer's phrase bonus asks whether the user's words
    // appear together in the title, so the run has to be the run they typed.
    expect(fake.fuzzyCalls).toEqual([
      { query: "who is Ai Haibara", keywords: ["ai", "haibara"], limit: FUZZY_CANDIDATES },
    ])
    // R1's names are the normalized query plus the same keywords, in that order.
    expect(fake.entityCalls[0].names).toEqual(["who is ai haibara", "ai", "haibara"])
  })

  it("lets a supplied keywords array win over the derived one", async () => {
    const clock = fakeClock()
    const fake = fakeSource({
      fuzzy: hits([haibaraDoc.id]),
      docs: [haibaraDoc],
    })

    await runLadder(
      { query: "who is Ai Haibara", keywords: ["sherry"] },
      { source: fake.source, now: clock.now }
    )

    expect(fake.fuzzyCalls[0].keywords).toEqual(["sherry"])
    expect(fake.entityCalls[0].names).toEqual(["who is ai haibara", "sherry"])
  })

  it("records why the wiki round was skipped", async () => {
    const clock = fakeClock()
    const docs = [entryDoc(1, "Mountain Lodge Case"), entryDoc(2, "Lodge Mountain Case")]
    const fake = fakeSource({
      entity: hits([docs[0].id]),
      fullText: hits([docs[1].id]),
      fuzzy: [],
      docs,
    })

    // No wiki dependency at all: "no_lore_needed" still wins, because the
    // question never asked for lore.
    const noLore = await runLadder(
      { query: "mountain lodge" },
      { source: fake.source, now: clock.now }
    )
    expect(noLore.steps).toHaveLength(4)
    expect(noLore.steps[3]).toMatchObject({ round: 4, branch: "wiki", hits: 0, skipped: "no_lore_needed" })
    expect(noLore.degraded).toBeNull()

    const noSource = await runLadder(
      { query: "mountain lodge", needsLore: true },
      { source: fake.source, now: clock.now }
    )
    expect(noSource.steps[3]).toMatchObject({ hits: 0, skipped: "no_wiki_source" })
    expect(noSource.wiki).toEqual([])
  })

  it("spends the wiki round when lore is needed and the corpus fell short", async () => {
    const clock = fakeClock()
    const extracts: WikiEvidence[] = [
      {
        title: "Ai Haibara",
        url: "https://example.test/haibara",
        extract: "A former Black Organization chemist.",
        source: "dcw",
      },
      {
        title: "Sherry",
        url: "https://example.test/sherry",
        extract: "Haibara's codename.",
        source: "wikipedia",
      },
    ]
    const fake = fakeSource({ fuzzy: hits([haibaraDoc.id]), docs: [haibaraDoc] })
    const wiki = vi.fn(async () => extracts)

    const result = await runLadder(
      { query: "who is Ai Haibara", needsLore: true },
      { source: fake.source, wiki, now: clock.now }
    )

    expect(wiki).toHaveBeenCalledTimes(1)
    expect(wiki).toHaveBeenCalledWith("who is Ai Haibara")
    expect(result.wiki).toEqual(extracts)
    // hits is the number of extracts, not the number of wiki calls.
    expect(result.steps[3]).toMatchObject({ round: 4, branch: "wiki", hits: 2, skipped: null })
    expect(result.steps[3].ms).toBeGreaterThanOrEqual(0)
    expect(result.degraded).toBeNull()
  })

  it("skips the rounds it cannot afford and says so", async () => {
    const clock = fakeClock()
    const docs = [entryDoc(1, "Mountain Lodge Case"), entryDoc(2, "Lodge Mountain Case")]
    const fake = fakeSource({
      entity: hits([docs[0].id]),
      fullText: hits([docs[1].id]),
      docs,
      // The clock jumps while R1 is in flight: by the time R3 is decided, the
      // budget is gone. A real timer would make this test flaky and slow.
      onEntity: () => clock.set(LADDER_BUDGET_MS + 1),
    })
    const wiki = noWiki()

    const result = await runLadder(
      { query: "mountain lodge", needsLore: true },
      { source: fake.source, wiki, now: clock.now }
    )

    expect(fake.fuzzyCalls).toEqual([])
    expect(wiki).not.toHaveBeenCalled()
    expect(result.steps.map((step) => step.round)).toEqual([1, 2, 3, 4])
    expect(result.steps[2]).toMatchObject({ round: 3, branch: "fuzzy", hits: 0, skipped: "budget" })
    expect(result.steps[3]).toMatchObject({ round: 4, branch: "wiki", hits: 0, skipped: "budget" })
    expect(result.degraded).toBe("retrieval_budget")
    // The documents the two affordable rounds found are still returned.
    expect(result.docs).toHaveLength(2)
  })

  it("resolves when a branch rejects, with the failure visible in steps", async () => {
    const clock = fakeClock()
    const docs = [entryDoc(1, "Mountain Lodge Case"), entryDoc(2, "Lodge Mountain Case")]
    const fake = fakeSource({
      entity: () => {
        throw new Error("entity down")
      },
      fullText: hits(docs.map((doc) => doc.id)),
      docs,
    })

    const result = await runLadder({ query: "mountain lodge" }, { source: fake.source, now: clock.now })

    // The entity round exists even though it failed, with 0 hits and the reason;
    // the full-text results are what the answer is built from.
    expect(result.steps[0]).toMatchObject({ round: 1, branch: "entity", hits: 0, skipped: "error" })
    expect(result.steps[1]).toMatchObject({ round: 2, branch: "fts", hits: 2, skipped: null })
    expect(result.docs.map((entry) => entry.doc.id).sort()).toEqual([
      "entry:ep-1",
      "entry:ep-2",
    ])
    // A broken branch is not a budget problem, and must not claim to be one.
    expect(result.degraded).toBeNull()
  })

  it("keeps an R3 failure visible and the earlier rounds' documents", async () => {
    const clock = fakeClock()
    const docs = [entryDoc(1, "Mountain Lodge Case")]
    const fake = fakeSource({
      fullText: hits([docs[0].id]),
      fuzzy: () => {
        throw new Error("fuzzy down")
      },
      docs,
    })

    const result = await runLadder({ query: "mountain lodge" }, { source: fake.source, now: clock.now })

    expect(result.steps[2]).toMatchObject({ round: 3, branch: "fuzzy", hits: 0, skipped: "error" })
    expect(result.docs).toHaveLength(1)
    expect(result.degraded).toBeNull()
  })

  it("counts candidate ids, not hydrated documents, when deciding to escalate", async () => {
    const clock = fakeClock()
    const docs = Array.from({ length: 6 }, (_, index) =>
      entryDoc(index + 1, `Mountain Lodge Case ${index + 1}`)
    )
    // Only one of the six ids hydrates — a miss the threshold must ignore.
    const fake = fakeSource({
      entity: hits(docs.slice(0, 3).map((doc) => doc.id)),
      fullText: hits(docs.slice(3).map((doc) => doc.id)),
      docs: [docs[0]],
    })

    const result = await runLadder({ query: "mountain lodge" }, { source: fake.source, now: clock.now })

    expect(fake.fetchCalls).toHaveLength(1)
    expect(fake.fetchCalls[0]).toHaveLength(6)
    expect(fake.fuzzyCalls).toEqual([])
    expect(result.steps.map((step) => step.round)).toEqual([1, 2])
    expect(result.docs).toHaveLength(1)
  })

  it("caps the documents at limit and defaults to 12", async () => {
    const clock = fakeClock()
    const docs = Array.from({ length: 20 }, (_, index) =>
      entryDoc(index + 1, `Mountain Lodge Case ${index + 1}`)
    )
    const fake = fakeSource({ fullText: hits(docs.map((doc) => doc.id)), docs })

    const capped = await runLadder({ query: "mountain lodge" }, { source: fake.source, now: clock.now })
    expect(capped.docs).toHaveLength(DEFAULT_LADDER_LIMIT)

    const two = await runLadder(
      { query: "mountain lodge", limit: 2 },
      { source: fake.source, now: clock.now }
    )
    expect(two.docs).toHaveLength(2)
  })

  it("hands the derived chronological preference to the scorer", async () => {
    const clock = fakeClock()
    const debut = entryDoc(1, "Ai Haibara Arrives", "1997-01-08")
    const loud = entryDoc(2, "Haibara Debut Special", "2009-03-14")
    const fake = fakeSource({ fullText: hits([loud.id, debut.id]), docs: [debut, loud] })
    const query = "which episode is haibara's debut"

    const earliest = await runLadder({ query }, { source: fake.source, now: clock.now })
    expect(earliest.docs.map((entry) => entry.doc.id)).toEqual([debut.id, loud.id])

    // A supplied flag wins over the query's own wording ("debut" reads as
    // prefersEarliest), which is why the derivation uses ??.
    const supplied = await runLadder(
      { query, preferEarliest: false },
      { source: fake.source, now: clock.now }
    )
    expect(supplied.docs.map((entry) => entry.doc.id)).toEqual([loud.id, debut.id])
  })

  it("lists the rounds in ascending order with a non-negative ms", async () => {
    // A clock that moves on every read: every round has to measure a real,
    // non-negative duration even when the injected source returns instantly.
    let tick = 0
    const now = () => {
      tick += 1
      return tick
    }
    const docs = [entryDoc(1, "Mountain Lodge Case"), entryDoc(2, "Lodge Mountain Case")]
    const fake = fakeSource({
      entity: hits([docs[0].id]),
      fullText: hits([docs[1].id]),
      docs,
    })

    const result = await runLadder(
      { query: "mountain lodge", needsLore: true },
      { source: fake.source, wiki: noWiki(), now }
    )

    expect(result.steps.map((step) => step.round)).toEqual([1, 2, 3, 4])
    expect(result.steps.map((step) => step.branch)).toEqual(["entity", "fts", "fuzzy", "wiki"])
    expect(result.steps.every((step) => step.ms >= 0)).toBe(true)
  })

  it("honours a caller-supplied threshold", async () => {
    const clock = fakeClock()
    const doc = entryDoc(1, "Mountain Lodge Case")
    const fake = fakeSource({ fullText: hits([doc.id]), docs: [doc] })

    const result = await runLadder(
      { query: "mountain lodge" },
      { source: fake.source, now: clock.now, threshold: 1 }
    )

    expect(result.steps.map((step) => step.round)).toEqual([1, 2])
    expect(fake.fuzzyCalls).toEqual([])
  })
})
