import { describe, expect, it } from "vitest"
import type { Database } from "@/types/database.types"
import { computePersonalStats, computeSeriesTotals } from "@/components/tracker/MotivationStats"
import { MAINLINE_MOVIES } from "@/lib/movies-guide"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

/**
 * Regression cover for the tracker's "Your Progress" rows. The movie row mixes
 * two sources — DB rows for the films that exist plus the films announced but
 * not yet in the table — so the bugs that show up here are: a per-type filter
 * that stops filtering by type (every watched entry counted as a film), and
 * non-mainline movies (crossovers, planetarium shorts) inflating the ratio.
 */

function row(partial: Partial<ContentEntry> & Pick<ContentEntry, "id" | "type" | "title">): ContentEntry {
  return {
    slug: partial.slug ?? partial.id,
    runtime_minutes: 25,
    episode_number: null,
    movie_number: null,
    air_date: "2020-01-01",
    ...partial,
  } as ContentEntry
}

const statuses = (...watched: string[]) =>
  new Map(watched.map((id) => [id, "watched" as const]))

describe("tracker per-type progress", () => {
  it("counts only films in the movie row, not every watched entry", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1" }),
      row({ id: "mov-1", type: "movie", title: "The Time-Bombed Skyscraper", slug: "mov-01", movie_number: 1, runtime_minutes: 95 }),
      row({ id: "ova-1", type: "ova", title: "OVA 1" }),
      row({ id: "sp-1", type: "special", title: "Special 1" }),
    ]

    const { perType } = computePersonalStats(entries, statuses("ep-1", "mov-1", "ova-1", "sp-1"))
    const movie = perType.find((s) => s.type === "movie")

    // Denominator is the canonical 29 films; numerator counts the one film that
    // was actually watched — the episodes/OVA/special beside it must not leak in.
    expect(movie?.total).toBe(MAINLINE_MOVIES.length)
    expect(movie?.watched).toBe(1)
  })

  it("keeps non-mainline movies out of both sides of the movie ratio", () => {
    const entries = [
      row({ id: "mov-1", type: "movie", title: "Mainline film", slug: "mov-01", movie_number: 1 }),
      // Crossover — in the catalog and watchable, but not one of the 29 films.
      row({ id: "mov-33", type: "movie", title: "Lupin III vs. Detective Conan", slug: "mov-33" }),
      // Movie row whose number column is empty cannot be matched to a mainline
      // film either, so it is excluded the same way.
      row({ id: "mov-x", type: "movie", title: "Unnumbered extra" }),
    ]

    const { perType } = computePersonalStats(entries, statuses("mov-1", "mov-33", "mov-x"))
    const movie = perType.find((s) => s.type === "movie")

    expect(movie?.watched).toBe(1)
    expect(movie?.total).toBe(MAINLINE_MOVIES.length)
  })

  it("leaves the films outstanding when only excluded rows are watched", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1" }),
      row({ id: "mov-33", type: "movie", title: "Crossover", slug: "mov-33" }),
      row({ id: "mov-41", type: "movie", title: "Manner short", slug: "mov-41" }),
    ]

    // Every catalog row is watched, but two of the three cannot be matched to a
    // mainline film, so progress is one episode against 1 episode + 29 films.
    const personal = computePersonalStats(entries, statuses("ep-1", "mov-33", "mov-41"))

    expect(personal.watched).toBe(1)
    expect(personal.percent).toBeLessThanOrEqual(100)
    expect(personal.remaining).toBe(29)
  })

  it("counts watched minutes from every entry type, including excluded films", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1", runtime_minutes: 25 }),
      row({ id: "mov-33", type: "movie", title: "Crossover", slug: "mov-33", runtime_minutes: 107 }),
    ]

    const { minutesWatched } = computePersonalStats(entries, statuses("ep-1", "mov-33"))

    expect(minutesWatched).toBe(132)
  })

  it("counts a rewatch as another pass through the runtime", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1", runtime_minutes: 25 }),
      row({ id: "ep-2", type: "episode", title: "Episode 2", runtime_minutes: 25 }),
    ]

    // Matches /analytics and /profile, which multiply by watch_count.
    const minutesWatched = computePersonalStats(
      entries,
      statuses("ep-1", "ep-2"),
      new Map([
        ["ep-1", 3],
        ["ep-2", 1],
      ])
    ).minutesWatched

    expect(minutesWatched).toBe(100)
  })

  it("still counts one view when the watch count is missing or zero", () => {
    const entries = [row({ id: "ep-1", type: "episode", title: "Episode 1", runtime_minutes: 25 })]

    // A seen entry cannot have been seen zero times, so a missing/zero count
    // must not silently erase the minutes the row itself proves were spent.
    expect(computePersonalStats(entries, statuses("ep-1")).minutesWatched).toBe(25)
    expect(
      computePersonalStats(entries, statuses("ep-1"), new Map([["ep-1", 0]])).minutesWatched
    ).toBe(25)
  })
})

describe("tracker series totals", () => {
  it("treats the film count as the canonical 29 regardless of catalog rows", () => {
    const entries = [
      row({ id: "ep-1", type: "episode", title: "Episode 1" }),
      row({ id: "ep-2", type: "episode", title: "Episode 2" }),
      row({ id: "mov-1", type: "movie", title: "Mainline film", slug: "mov-01", movie_number: 1 }),
      row({ id: "mov-33", type: "movie", title: "Crossover", slug: "mov-33" }),
    ]

    const totals = computeSeriesTotals(entries)

    expect(totals.movies).toBe(MAINLINE_MOVIES.length)
    expect(totals.episodes).toBe(2)
    // 2 episodes + the canonical 29 films — the crossover row is not part of
    // the mainline total, so it drops out on both sides.
    expect(totals.total).toBe(2 + MAINLINE_MOVIES.length)
  })
})
