import { describe, expect, it } from "vitest"
import {
  CRIME_SEVERITY,
  buildCrimeDistribution,
  caseRef,
  compareCrimes,
  crimeSeverity,
  primaryCrime,
  summarizeArchive,
  summarizeCoverage,
  groupFilesByType,
} from "@/lib/cases-view"
import { CRIME_GROUPS } from "@/lib/dcw-cases"

describe("crimeSeverity", () => {
  it("ranks murder above vandalism", () => {
    expect(crimeSeverity("murder")).toBeGreaterThan(crimeSeverity("vandalism"))
  })

  it("returns 0 for a missing slug so it never outranks a real crime", () => {
    expect(crimeSeverity(null)).toBe(0)
    expect(crimeSeverity(undefined)).toBe(0)
  })

  it("gives an unknown slug a low but non-zero rank", () => {
    const unknown = crimeSeverity("some-new-crime")
    expect(unknown).toBeGreaterThan(0)
    expect(unknown).toBeLessThan(crimeSeverity("vandalism"))
  })

  /**
   * The regression this table was rewritten for: it used to be keyed by raw
   * crime names (poisoning, arson, blackmail...) while the view stores GROUP
   * slugs, so those keys were dead and three real groups fell through to the
   * fallback. Every canonical group must have a deliberate rank.
   */
  it("covers every canonical crime group, so none falls back silently", () => {
    const missing = CRIME_GROUPS.filter((group) => CRIME_SEVERITY[group.slug] === undefined)
    expect(missing.map((g) => g.slug)).toEqual([])
  })

  it("carries no keys outside the canonical groups", () => {
    const known = new Set(CRIME_GROUPS.map((group) => group.slug))
    const extra = Object.keys(CRIME_SEVERITY).filter((slug) => !known.has(slug))
    expect(extra).toEqual([])
  })

  it("orders suicide above vandalism, which the fallback used to invert", () => {
    expect(crimeSeverity("suicide")).toBeGreaterThan(crimeSeverity("vandalism"))
  })
})

describe("compareCrimes", () => {
  it("puts the most severe crime first", () => {
    const sorted = [
      { slug: "vandalism", label: "Vandalism" },
      { slug: "murder", label: "Murder" },
      { slug: "robbery", label: "Robbery" },
    ].sort(compareCrimes)
    expect(sorted.map((c) => c.slug)).toEqual(["murder", "robbery", "vandalism"])
  })

  it("breaks ties by label so the order is stable", () => {
    const a = { slug: "other", label: "Alpha" }
    const b = { slug: "other", label: "Beta" }
    expect(compareCrimes(a, b)).toBeLessThan(0)
    expect(compareCrimes(b, a)).toBeGreaterThan(0)
  })
})

describe("primaryCrime", () => {
  it("returns the most severe crime in the file", () => {
    const primary = primaryCrime([
      { slug: "fraud", label: "Fraud" },
      { slug: "murder", label: "Murder" },
    ])
    expect(primary?.slug).toBe("murder")
  })

  it("returns null for an entry with no crime data", () => {
    expect(primaryCrime([])).toBeNull()
  })

  it("does not mutate the input array", () => {
    const input = [
      { slug: "fraud", label: "Fraud" },
      { slug: "murder", label: "Murder" },
    ]
    primaryCrime(input)
    expect(input[0].slug).toBe("fraud")
  })
})

describe("buildCrimeDistribution", () => {
  it("sums to exactly 100 so the strip fills its track", () => {
    const segments = buildCrimeDistribution([
      { slug: "murder", label: "Murder", count: 900 },
      { slug: "robbery", label: "Robbery", count: 60 },
      { slug: "fraud", label: "Fraud", count: 40 },
      { slug: "other", label: "Other", count: 3 },
    ])
    const total = segments.reduce((sum, s) => sum + s.widthPercent, 0)
    expect(total).toBeCloseTo(100, 5)
  })

  it("keeps the total when every share rounds awkwardly", () => {
    // 1/3 each: naive per-segment rounding gives 33.3 × 3 = 99.9.
    const segments = buildCrimeDistribution([
      { slug: "a", label: "A", count: 1 },
      { slug: "b", label: "B", count: 1 },
      { slug: "c", label: "C", count: 1 },
    ])
    expect(segments.reduce((sum, s) => sum + s.widthPercent, 0)).toBeCloseTo(100, 5)
  })

  it("gives a dominant category most of the width", () => {
    const segments = buildCrimeDistribution([
      { slug: "murder", label: "Murder", count: 95 },
      { slug: "other", label: "Other", count: 5 },
    ])
    expect(segments[0].widthPercent).toBeCloseTo(95, 1)
  })

  it("returns nothing when there are no crimes", () => {
    expect(buildCrimeDistribution([])).toEqual([])
    expect(buildCrimeDistribution([{ slug: "a", label: "A", count: 0 }])).toEqual([])
  })

  it("preserves the order it was given", () => {
    const segments = buildCrimeDistribution([
      { slug: "b", label: "B", count: 5 },
      { slug: "a", label: "A", count: 10 },
    ])
    expect(segments.map((s) => s.slug)).toEqual(["b", "a"])
  })
})

describe("caseRef", () => {
  it("uses the episode number for an episode", () => {
    expect(
      caseRef({
        entryType: "episode",
        entryEpisodeNumber: 128,
        entryReleaseOrder: null,
        pageTitle: "Some Case",
      })
    ).toBe("EP 128")
  })

  /**
   * The bug this replaces: the page printed "File no. NNNN" from the row's
   * position in the filtered set, so the same case was 0001 unfiltered and
   * 0002 under ?type=murder. The reference must not depend on position.
   */
  it("does not depend on position in the result set", () => {
    const file = {
      entryType: "episode",
      entryEpisodeNumber: 500,
      entryReleaseOrder: null,
      pageTitle: "X",
    }
    expect(caseRef(file)).toBe(caseRef({ ...file }))
  })

  it("falls back to the content type for a movie", () => {
    expect(
      caseRef({
        entryType: "movie",
        entryEpisodeNumber: null,
        entryReleaseOrder: 4,
        pageTitle: "Movie Case",
      })
    ).toBe("MOVIE")
  })

  it("returns null when there is nothing meaningful to show", () => {
    expect(
      caseRef({
        entryType: null,
        entryEpisodeNumber: null,
        entryReleaseOrder: null,
        pageTitle: "Orphan",
      })
    ).toBeNull()
  })

  it("returns null for an episode with no number rather than printing EP null", () => {
    expect(
      caseRef({
        entryType: "episode",
        entryEpisodeNumber: null,
        entryReleaseOrder: null,
        pageTitle: "Unnumbered",
      })
    ).toBeNull()
  })

  it("ignores an unknown content type", () => {
    expect(
      caseRef({
        entryType: "not-a-type",
        entryEpisodeNumber: null,
        entryReleaseOrder: null,
        pageTitle: "X",
      })
    ).toBeNull()
  })
})

describe("groupFilesByType", () => {
  const ORDER = ["episode", "movie", "special", "magic_kaito"] as const
  const LABELS = {
    episode: "Episode",
    movie: "Movie",
    special: "Special",
    magic_kaito: "Magic Kaito",
  }
  const file = (entryType: string | null, pageTitle: string) =>
    ({ pageTitle, entryType, dateText: null } as never)

  /**
   * The bug this exists for: Conan EP 1 and Magic Kaito EP 1 both sort on
   * entry_episode_number = 1, so they interleaved down the page. Grouping
   * keeps each series contiguous.
   */
  it("keeps one series contiguous instead of interleaving same-numbered episodes", () => {
    const sections = groupFilesByType(
      [
        file("magic_kaito", "MK 1"),
        file("episode", "EP 1"),
        file("magic_kaito", "MK 2"),
        file("episode", "EP 2"),
      ],
      ORDER,
      LABELS
    )
    expect(sections.map((s) => s.type)).toEqual(["episode", "magic_kaito"])
    expect(sections[0].files.map((f) => f.pageTitle)).toEqual(["EP 1", "EP 2"])
    expect(sections[1].files.map((f) => f.pageTitle)).toEqual(["MK 1", "MK 2"])
  })

  it("orders sections by the given domain order, not arrival order", () => {
    const sections = groupFilesByType(
      [file("movie", "M"), file("magic_kaito", "K"), file("episode", "E")],
      ORDER,
      LABELS
    )
    expect(sections.map((s) => s.type)).toEqual(["episode", "movie", "magic_kaito"])
  })

  it("labels each section from the supplied labels", () => {
    const sections = groupFilesByType([file("magic_kaito", "K")], ORDER, LABELS)
    expect(sections[0].label).toBe("Magic Kaito")
  })

  it("keeps files in the order they were given inside a section", () => {
    const sections = groupFilesByType(
      [file("episode", "EP 3"), file("episode", "EP 1"), file("episode", "EP 2")],
      ORDER,
      LABELS
    )
    expect(sections[0].files.map((f) => f.pageTitle)).toEqual(["EP 3", "EP 1", "EP 2"])
  })

  it("parks an unknown type after the known ones rather than dropping it", () => {
    const sections = groupFilesByType(
      [file("brand_new", "X"), file("episode", "E")],
      ORDER,
      LABELS
    )
    expect(sections.map((s) => s.type)).toEqual(["episode", "brand_new"])
    expect(sections[1].label).toBe("brand_new")
  })

  it("puts a typeless file in a trailing Other section", () => {
    const sections = groupFilesByType([file(null, "Z"), file("episode", "E")], ORDER, LABELS)
    expect(sections.map((s) => s.label)).toEqual(["Episode", "Other"])
  })

  it("returns nothing for an empty page", () => {
    expect(groupFilesByType([], ORDER, LABELS)).toEqual([])
  })
})

describe("summarizeCoverage", () => {
  it("counts distinct entries, not crime rows", () => {
    // One entry with three crimes is still one covered entry.
    const coverage = summarizeCoverage([
      { entry_id: "a", crime_slug: "murder" },
      { entry_id: "a", crime_slug: "robbery" },
      { entry_id: "a", crime_slug: "fraud" },
      { entry_id: "b", crime_slug: null },
    ])
    expect(coverage.covered).toBe(1)
    expect(coverage.total).toBe(2)
    expect(coverage.percent).toBe(50)
  })

  it("treats an entry with no crime rows as uncovered", () => {
    const coverage = summarizeCoverage([{ entry_id: "a", crime_slug: null }])
    expect(coverage.covered).toBe(0)
    expect(coverage.total).toBe(1)
    expect(coverage.percent).toBe(0)
  })

  it("returns zero rather than NaN for an empty archive", () => {
    expect(summarizeCoverage([])).toEqual({ covered: 0, total: 0, percent: 0 })
  })

  /**
   * The view carries "untracked" crimes — rows whose entry_id matches no
   * content entry — as null. Counting null as a distinct value reported 1,372
   * entries against 1,371 that exist.
   */
  it("ignores untracked crime rows with a null entry_id", () => {
    const coverage = summarizeCoverage([
      { entry_id: "a", crime_slug: "murder" },
      { entry_id: null, crime_slug: "robbery" },
      { entry_id: null, crime_slug: "fraud" },
    ])
    expect(coverage.total).toBe(1)
    expect(coverage.covered).toBe(1)
    expect(coverage.percent).toBe(100)
  })

  it("reports full coverage when every entry has a crime", () => {
    const coverage = summarizeCoverage([
      { entry_id: "a", crime_slug: "murder" },
      { entry_id: "b", crime_slug: "fraud" },
    ])
    expect(coverage.percent).toBe(100)
  })
})

describe("summarizeArchive", () => {
  it("formats large counts with separators", () => {
    const summary = summarizeArchive({ crimes: 2018, files: 1474, categories: 12, methods: 17 })
    expect(summary.crimes).toBe("2,018")
    expect(summary.files).toBe("1,474")
    expect(summary.categories).toBe(12)
  })
})
