import { describe, expect, it } from "vitest"
import {
  DEFAULT_RRF_K,
  reciprocalRankFusion,
  type RankedList,
} from "@/lib/ai/retrieval/rrf"

/**
 * The three retrievers (entity, full-text, fuzzy) return scores that are not
 * comparable — `ts_rank_cd` is not `similarity` — so fusion counts ranks instead
 * of scores. These tests pin the arithmetic and, more importantly, the tie order:
 * small k makes ties common, and an unstable order would make the ladder's
 * downstream ranking non-reproducible.
 */
describe("reciprocalRankFusion", () => {
  it("preserves one list's order and reports 1-based ranks", () => {
    const fused = reciprocalRankFusion([{ source: "fts", ids: ["a", "b", "c"] }])

    expect(fused.map((candidate) => candidate.id)).toEqual(["a", "b", "c"])
    expect(fused.map((candidate) => candidate.ranks.fts)).toEqual([1, 2, 3])
    expect(fused[0].rrf).toBe(1 / (DEFAULT_RRF_K + 1))
  })

  it("ranks a consensus hit above a lone winner", () => {
    // b is second in both lists (1/52 + 1/52); a and c each win one list
    // (1/51). Being named twice beats being named first once.
    const fused = reciprocalRankFusion([
      { source: "fts", ids: ["a", "b"] },
      { source: "fuzzy", ids: ["c", "b"] },
    ])

    expect(fused.map((candidate) => candidate.id)).toEqual(["b", "a", "c"])
    const byId = new Map(fused.map((candidate) => [candidate.id, candidate]))
    expect(byId.get("b")!.rrf).toBeGreaterThan(byId.get("a")!.rrf)
  })

  it("counts an id once per list even when it repeats", () => {
    // A ranking, not a ballot box: the duplicate "a" must not be paid twice,
    // and it must not push "b" up to rank 2 either.
    const fused = reciprocalRankFusion([{ source: "fts", ids: ["a", "a", "b"] }])

    const byId = new Map(fused.map((candidate) => [candidate.id, candidate]))
    expect(byId.get("a")!.rrf).toBe(1 / 51)
    expect(byId.get("b")!.ranks.fts).toBe(3)
    expect(byId.get("b")!.rrf).toBe(1 / 53)
  })

  it("carries one ranks entry per source the id appeared in", () => {
    const fused = reciprocalRankFusion([
      { source: "fts", ids: ["a", "b"] },
      { source: "fuzzy", ids: ["c", "b"] },
    ])

    const byId = new Map(fused.map((candidate) => [candidate.id, candidate]))
    expect(byId.get("b")!.ranks).toEqual({ fts: 2, fuzzy: 2 })
    expect(byId.get("a")!.ranks).toEqual({ fts: 1 })
    expect(byId.get("c")!.ranks).toEqual({ fuzzy: 1 })
  })

  it("keeps the best rank when the same source name appears twice", () => {
    // Sources are expected to be distinct; if a caller reuses one, rrf should
    // still accumulate both contributions while `ranks` reports the best rank
    // rather than whichever list happened to be processed last.
    const lists: RankedList[] = [
      { source: "fts", ids: ["a", "b"] },
      { source: "fts", ids: ["b", "c"] },
    ]
    const fused = reciprocalRankFusion(lists)

    const byId = new Map(fused.map((candidate) => [candidate.id, candidate]))
    expect(byId.get("b")!.ranks.fts).toBe(1)
    expect(byId.get("b")!.rrf).toBe(1 / 52 + 1 / 51)
    expect(fused.map((candidate) => candidate.id)).toEqual(["b", "a", "c"])
  })

  it("returns only the first candidate when limit is 1", () => {
    const fused = reciprocalRankFusion(
      [{ source: "fts", ids: ["a", "b", "c"] }],
      { limit: 1 }
    )

    expect(fused.map((candidate) => candidate.id)).toEqual(["a"])
  })

  it("returns nothing for no lists", () => {
    expect(reciprocalRankFusion([])).toEqual([])
  })

  it("contributes nothing for a list with no ids", () => {
    const fused = reciprocalRankFusion([
      { source: "entity", ids: [] },
      { source: "fts", ids: ["a"] },
    ])

    expect(fused).toEqual([{ id: "a", rrf: 1 / 51, ranks: { fts: 1 } }])
  })

  it("breaks a perfect tie by id so the order is deterministic", () => {
    // Both ids are rank 1 in one list and rank 2 in the other, so rrf and the
    // best rank tie exactly; only the id comparison can decide.
    const fused = reciprocalRankFusion([
      { source: "fts", ids: ["a", "b"] },
      { source: "fuzzy", ids: ["b", "a"] },
    ])

    expect(fused.map((candidate) => candidate.id)).toEqual(["a", "b"])
    expect(fused[0].rrf).toBe(fused[1].rrf)
    // Mirrored ranks, so both the score and the best rank tie exactly.
    expect(fused[0].ranks).toEqual({ fts: 1, fuzzy: 2 })
    expect(fused[1].ranks).toEqual({ fts: 2, fuzzy: 1 })
  })

  it("with k 0, a lone rank-1 hit ties a rank-2-twice hit; with k 50 it does not", () => {
    const lists: RankedList[] = [
      { source: "fts", ids: ["a", "b"] },
      { source: "fuzzy", ids: ["c", "b"] },
    ]

    // k: 0 makes every contribution 1/rank, so a = 1, b = 1/2 + 1/2 = 1 and
    // c = 1 all tie at 1.0. b then loses the best-rank tie-break (2 against
    // 1) and lands last. At the literature's k = 50 the two half-contributions
    // outrank one full contribution, and b is first.
    expect(reciprocalRankFusion(lists, { k: 0 }).map((c) => c.id)).toEqual([
      "a",
      "c",
      "b",
    ])
    expect(reciprocalRankFusion(lists, { k: 50 }).map((c) => c.id)).toEqual([
      "b",
      "a",
      "c",
    ])
  })
})
