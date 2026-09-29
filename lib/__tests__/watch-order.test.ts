import { describe, expect, it } from "vitest"
import {
  findUnresolvedSteps,
  resolveWatchOrder,
  type WatchOrderEntryLike,
} from "@/lib/watch-order"

/**
 * Regression cover for the "Full Watch Order" view. The steps are a curated
 * path, so the risks that matter are: a numbered film or TV special added after
 * the list was written silently disappearing, and selectors that resolve to
 * nothing because a row's number lives in its slug rather than its column.
 */

type Row = WatchOrderEntryLike & { slug: string }

function row(partial: Partial<Row> & Pick<Row, "id" | "type" | "title" | "slug">): Row {
  return {
    episode_number: null,
    movie_number: null,
    air_date: "2020-01-01",
    dcw_title: null,
    ...partial,
  }
}

function positionsFor(entries: Row[]) {
  const items = resolveWatchOrder(entries)
  return new Map(items.map((item) => [item.entry.id, item.position]))
}

describe("watch order — Magic Kaito 1412", () => {
  it("places episodes whose number is only in the slug", () => {
    // The live rows for 1412 episode 7+ carry episode_number = NULL; the number
    // survives in the slug, and the curated MK(7, 8) steps must still find them.
    const entries = [
      row({ id: "a", type: "magic_kaito", title: "Kuroba Kaito's Busy Holiday", slug: "mk-magic-kaito-1412-07" }),
      row({ id: "b", type: "magic_kaito", title: "Adult's Charm", slug: "mk-magic-kaito-1412-08" }),
      row({ id: "c", type: "magic_kaito", title: "Dark Knight", slug: "mk-magic-kaito-1412-20", episode_number: 20 }),
    ]

    const positions = positionsFor(entries)

    // Placed in episode order, which only happens if MK(7, 8) matched them.
    expect(positions.get("a")).toBeLessThan(positions.get("b") as number)
    expect(positions.get("b")).toBeLessThan(positions.get("c") as number)
    expect(positions.size).toBe(3)
  })
})

describe("watch order — tail sweeps", () => {
  it("keeps a film released after the curated list was written", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1", slug: "ep-001", episode_number: 1 }),
      row({ id: "m1", type: "movie", title: "Movie 1", slug: "mov-01", movie_number: 1 }),
      row({ id: "m29", type: "movie", title: "Fallen Angel of the Highway", slug: "mov-52", movie_number: 29 }),
    ]

    const positions = positionsFor(entries)

    expect(positions.get("m29")).toBeGreaterThan(positions.get("m1") as number)
  })

  it("keeps a TV special released after the eight ordinal slots", () => {
    const entries = [
      row({ id: "s1", type: "special", title: "Time Travel", slug: "sp-01", air_date: "2004-04-10" }),
      row({ id: "s9", type: "special", title: "The Counterfeit Case of Ultra 30", slug: "sp-03", air_date: "2026-09-25" }),
    ]

    const positions = positionsFor(entries)

    expect(positions.get("s1")).toBe(1)
    expect(positions.get("s9")).toBe(2)
  })

  it("leaves the unnumbered crossovers and compilations out of the curated path", () => {
    const entries = [
      row({ id: "m1", type: "movie", title: "Movie 1", slug: "mov-01", movie_number: 1 }),
      row({ id: "manner", type: "movie", title: "Detective Conan Manner Movie", slug: "mov-41" }),
      row({ id: "magician", type: "movie", title: "The Magician of Starlight", slug: "mov-33" }),
    ]

    const positions = positionsFor(entries)

    expect(positions.has("m1")).toBe(true)
    expect(positions.has("manner")).toBe(false)
    expect(positions.has("magician")).toBe(false)
  })

  it("does not re-add an entry an earlier step already claimed", () => {
    const entries = [
      row({ id: "cross", type: "movie", title: "Lupin III vs. Detective Conan: The Movie", slug: "mov-37" }),
    ]

    const items = resolveWatchOrder(entries)

    expect(items).toHaveLength(1)
    // Claimed by the title step, not by the numbered-film sweep at the tail.
    expect(items[0].stepIndex).toBeLessThan(200)
  })
})

describe("watch order — special ordinals", () => {
  it("numbers specials by air date, so SP(2) is the later of two", () => {
    const entries = [
      row({ id: "late", type: "special", title: "Late special", slug: "sp-03", air_date: "2016-01-01" }),
      row({ id: "early", type: "special", title: "Early special", slug: "sp-01", air_date: "2004-04-10" }),
    ]

    const items = resolveWatchOrder(entries)

    expect(items.map((i) => i.entry.id)).toEqual(["early", "late"])
  })

  it("skips an already-claimed ordinal instead of duplicating it", () => {
    const entries = [
      row({ id: "s1", type: "special", title: "Time Travel of the Silver Sky", slug: "sp-01", air_date: "2004-04-10" }),
      row({ id: "s2", type: "special", title: "Black History", slug: "sp-02", air_date: "2007-12-17" }),
    ]

    // The title step claims SP(2) first; the ordinal step for it must not repeat it.
    const items = resolveWatchOrder([
      { ...entries[0] },
      { ...entries[1] },
    ])

    expect(items.map((i) => i.entry.id)).toEqual(["s1", "s2"])
    expect(new Set(items.map((i) => i.entry.id)).size).toBe(items.length)
  })
})

describe("watch order — diagnostics", () => {
  it("reports a step that matched nothing", () => {
    const unresolved = findUnresolvedSteps([
      row({ id: "ep-1", type: "episode", title: "Episode 1", slug: "ep-001", episode_number: 1 }),
    ])

    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.every((s) => typeof s.label === "string" && s.label.length > 0)).toBe(true)
  })
})
