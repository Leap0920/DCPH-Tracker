import { describe, expect, it } from "vitest"
import {
  DEFAULT_TYPE,
  PAGE_SIZE,
  WATCH_ORDER_KEY,
  buildSections,
  buildTypeTabs,
  canonSectionBucket,
  countRewatchableUpTo,
  countUnwatchedUpTo,
  entryNumber,
  jumpList,
  jumpSectionKey,
  matchesStatus,
  pageForEntry,
  parseTypeParam,
  type ContentEntry,
} from "../tracker-view"
import type { EpisodeTag } from "../episode-tags"

/** A content_entries row with only the columns the view-model reads. */
function row(partial: Partial<ContentEntry> & { id: string }): ContentEntry {
  return {
    type: "episode",
    title: `Title ${partial.id}`,
    air_date: "1996-01-08",
    episode_number: null,
    movie_number: null,
    release_order: null,
    canon_order: null,
    arc_id: null,
    runtime_minutes: 25,
    synopsis: null,
    ...partial,
  } as unknown as ContentEntry
}

function ep(n: number, airDate = "1996-01-08"): ContentEntry {
  return row({
    id: `ep-${n}`,
    episode_number: n,
    canon_order: n,
    air_date: airDate,
    title: `Episode ${n}`,
  })
}

const NO_TAGS = new Map<string, EpisodeTag[]>()

function sectionsFor(overrides: Partial<Parameters<typeof buildSections>[0]> = {}) {
  return buildSections({
    entries: [],
    mode: "year",
    type: DEFAULT_TYPE,
    status: "all",
    activeTag: null,
    tagsByContentId: NO_TAGS,
    watchOrder: [],
    subcat: {},
    ...overrides,
  })
}

describe("tracker-view: type parsing", () => {
  it("defaults to episodes when ?type= is absent", () => {
    expect(parseTypeParam(null)).toBe("episode")
  })

  /**
   * Old links and bookmarks carry ?type=all. "All" is no longer a category, so
   * it has to degrade to the default rather than render an empty list.
   */
  it("treats the retired ?type=all as the default category", () => {
    expect(parseTypeParam("all")).toBe("episode")
  })

  it("keeps a known category and rejects an unknown one", () => {
    expect(parseTypeParam("movie")).toBe("movie")
    expect(parseTypeParam("zero_tea_time")).toBe("zero_tea_time")
    expect(parseTypeParam("nonsense")).toBe("episode")
  })
})

describe("tracker-view: the category rail", () => {
  it("offers no 'all' tab", () => {
    const tabs = buildTypeTabs([ep(1), ep(2)])
    expect(tabs.map((tab) => tab.key)).toEqual(["episode"])
    expect((tabs as { key: string }[]).some((tab) => tab.key === "all")).toBe(false)
  })

  it("numbers tabs in catalogue order and drops empty categories", () => {
    const tabs = buildTypeTabs([
      ep(1),
      row({ id: "mov-1", type: "movie", movie_number: 1 }),
      row({ id: "ova-1", type: "ova", release_order: 1 }),
    ])
    expect(tabs.map((tab) => [tab.index, tab.key, tab.total])).toEqual([
      ["01", "episode", 1],
      ["02", "movie", 1],
      ["03", "ova", 1],
    ])
  })

  it("counts watched rows, treating rewatched as watched", () => {
    const statuses = new Map([
      ["ep-1", "watched"],
      ["ep-2", "rewatched"],
    ]) as never
    const [episodes] = buildTypeTabs([ep(1), ep(2), ep(3)], statuses)
    expect(episodes.watched).toBe(2)
    expect(episodes.total).toBe(3)
  })

  // A windowed fetch paging on a non-unique column handed the same row back
  // twice, and the tab rendered "1218 / 1216" — a fraction that cannot exist.
  it("counts a duplicated row once, so watched never exceeds total", () => {
    const duplicate = ep(1)
    const tabs = buildTypeTabs([duplicate, duplicate, ep(2), ep(3)])
    expect(tabs[0].total).toBe(3)
    expect(tabs[0].watched).toBeLessThanOrEqual(tabs[0].total)
  })

  it("clamps watched to total even if the status map over-reports", () => {
    const statuses = new Map([
      ["ep-1", "watched"],
      ["ep-2", "watched"],
      ["ep-3", "watched"],
    ]) as never
    const [episodes] = buildTypeTabs([ep(1), ep(1), ep(2)], statuses)
    expect(episodes.total).toBe(2)
    expect(episodes.watched).toBe(2)
  })
})

describe("tracker-view: status predicate", () => {
  const statuses = new Map([
    ["a", "watched"],
    ["b", "rewatched"],
    ["c", "unwatched"],
  ]) as never

  it("treats 'unwatched' as missing-or-explicitly-unwatched", () => {
    expect(matchesStatus(row({ id: "a" }), "unwatched", statuses)).toBe(false)
    expect(matchesStatus(row({ id: "c" }), "unwatched", statuses)).toBe(true)
    expect(matchesStatus(row({ id: "never-seen" }), "unwatched", statuses)).toBe(true)
  })

  it("counts a rewatch as watched but not the reverse", () => {
    expect(matchesStatus(row({ id: "b" }), "watched", statuses)).toBe(true)
    expect(matchesStatus(row({ id: "a" }), "rewatched", statuses)).toBe(false)
  })

  it("passes everything when no status is selected", () => {
    expect(matchesStatus(row({ id: "zzz" }), "all", statuses)).toBe(true)
  })
})

describe("tracker-view: sections", () => {
  it("groups episodes by air year, ascending", () => {
    const sections = sectionsFor({
      entries: [ep(2, "1997-03-01"), ep(1, "1996-01-08"), ep(3, "1997-04-01")],
    })
    expect(sections.map((section) => section.key)).toEqual(["year-1996", "year-1997"])
    expect(sections[1].entries.map((entry) => entry.episode_number)).toEqual([2, 3])
  })

  it("keeps the watched tally per section", () => {
    const sections = sectionsFor({
      entries: [ep(1), ep(2), ep(3)],
      statuses: new Map([["ep-1", "watched"], ["ep-2", "rewatched"]]) as never,
    })
    expect(sections[0].watched).toBe(2)
    expect(sections[0].total).toBe(3)
  })

  it("splits canon and filler, folding anime canon into the canon group", () => {
    const sections = sectionsFor({
      entries: [ep(1), ep(2), ep(3)],
      mode: "canon",
    })
    expect(sections[0].key).toBe("canon-manga_canon")
    expect(canonSectionBucket(2)).toBe("manga_canon")
    // Every episode must land in exactly one bucket, whatever the guide says.
    const placed = sections.flatMap((section) => section.entries.map((entry) => entry.id))
    expect(new Set(placed).size).toBe(3)
  })

  it("orders episodes by canon_order in Story Order", () => {
    const sections = sectionsFor({
      entries: [
        row({ id: "a", episode_number: 5, canon_order: 9 }),
        row({ id: "b", episode_number: 9, canon_order: 1 }),
      ],
      mode: "chronological",
    })
    expect(sections).toHaveLength(1)
    expect(sections[0].entries.map((entry) => entry.id)).toEqual(["b", "a"])
  })

  /**
   * Full Watch Order is scoped by the selected category — otherwise the rail
   * would be a dead control in that mode.
   */
  it("scopes the watch order to the selected category", () => {
    const episodes = [ep(1), ep(2)]
    const movie = row({ id: "mov-1", type: "movie", movie_number: 1 })
    const sections = sectionsFor({
      entries: [...episodes, movie],
      mode: "order",
      type: "episode",
      watchOrder: [movie, ...episodes],
    })
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe(WATCH_ORDER_KEY)
    expect(sections[0].entries.map((entry) => entry.id)).toEqual(["ep-1", "ep-2"])

    const moviesOnly = sectionsFor({
      entries: [...episodes, movie],
      mode: "order",
      type: "movie",
      watchOrder: [movie, ...episodes],
    })
    expect(moviesOnly[0].entries.map((entry) => entry.id)).toEqual(["mov-1"])
  })

  it("applies the tag filter to sections", () => {
    const tags = new Map<string, EpisodeTag[]>([
      ["ep-1", [{ key: "canon:filler", kind: "canon", label: "Filler", title: "", rank: 0 }]],
    ])
    const sections = sectionsFor({
      entries: [ep(1), ep(2)],
      tagsByContentId: tags,
      activeTag: "canon:filler",
    })
    expect(sections[0].entries.map((entry) => entry.id)).toEqual(["ep-1"])
  })

  it("keeps non-episode categories in their own sections", () => {
    const sections = sectionsFor({
      entries: [
        ep(1),
        row({ id: "mov-1", type: "movie", movie_number: 1, release_order: 1 }),
      ],
    })
    expect(sections.map((section) => section.type)).toEqual(["episode", "movie"])
    expect(sections[1].total).toBe(1)
  })
})

describe("tracker-view: jump maths", () => {
  const entries = [ep(1, "1996-01-08"), ep(2, "1996-01-15"), ep(3, "1997-02-01")]
  const watchOrder = [ep(1, "1996-01-08"), ep(2, "1996-01-15"), ep(3, "1997-02-01")]

  it("pages to the row inside the list the jump will render", () => {
    const list = jumpList("year", entries[2], entries, watchOrder)
    expect(list.map((entry) => entry.id)).toEqual(["ep-3"])
    expect(pageForEntry(list, "ep-3")).toBe(0)
  })

  it("computes a page index past the first page", () => {
    const long = Array.from({ length: PAGE_SIZE + 5 }, (_, index) => ep(index + 1))
    const target = long[PAGE_SIZE + 2]
    expect(pageForEntry(long, target.id)).toBe(1)
  })

  it("names the section a jump should open in each mode", () => {
    expect(jumpSectionKey("year", entries[0])).toBe("year-1996")
    expect(jumpSectionKey("canon", entries[0])).toBe("canon-manga_canon")
    expect(jumpSectionKey("chronological", entries[0])).toBe("episode")
    expect(jumpSectionKey("order", entries[0])).toBe(WATCH_ORDER_KEY)
  })
})

describe("tracker-view: bulk mark preview", () => {
  const entries = [ep(1), ep(2), ep(3), row({ id: "mov-1", type: "movie", movie_number: 1 })]

  it("counts only unwatched episodes at or below the target", () => {
    const statuses = new Map([["ep-1", "watched"]]) as never
    expect(countUnwatchedUpTo(entries, 3, statuses)).toBe(2)
    expect(countUnwatchedUpTo(entries, 1, statuses)).toBe(0)
  })

  it("never counts a movie", () => {
    expect(countUnwatchedUpTo(entries, 99)).toBe(3)
  })
})

describe("tracker-view: bulk rewatch preview", () => {
  const entries = [ep(1), ep(2), ep(3), row({ id: "mov-1", type: "movie", movie_number: 1 })]

  it("counts only watched episodes at or below the target", () => {
    const statuses = new Map([
      ["ep-1", "watched"],
      ["ep-2", "rewatched"],
    ]) as never
    expect(countRewatchableUpTo(entries, 3, statuses)).toBe(2)
    expect(countRewatchableUpTo(entries, 1, statuses)).toBe(1)
  })

  it("ignores unwatched episodes and movies", () => {
    expect(countRewatchableUpTo(entries, 99)).toBe(0)
  })
})

describe("tracker-view: entry numbers", () => {
  it("uses the number the reader recognises", () => {
    expect(entryNumber(ep(12))).toBe(12)
    expect(entryNumber(row({ id: "m", type: "movie", movie_number: 4 }))).toBe(4)
    expect(entryNumber(row({ id: "s", type: "special", release_order: 7 }))).toBe(7)
  })
})
