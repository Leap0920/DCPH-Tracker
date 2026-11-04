import { describe, expect, it } from "vitest"
import {
  buildArcIndex,
  buildArcSegments,
  nextEpisodeLabel,
  summarizeArcs,
  type ArcIndexRow,
} from "@/lib/arcs-view"
import type { StoryArc } from "@/lib/arcs-guide"
import type { ArcProgressInfo } from "@/lib/arcs-progress"

function arc(over: Partial<StoryArc> & { slug: string; order: number }): StoryArc {
  return {
    title: `Arc ${over.order}`,
    era: `Era ${over.order}`,
    episodeStart: 1,
    episodeEnd: 100,
    mangaRange: "",
    years: "1996-1998",
    status: "complete",
    tagline: "",
    summary: "",
    keyCharacters: [],
    highlights: [],
    ...over,
  }
}

function progress(watched: number, total: number): ArcProgressInfo {
  return {
    watched,
    total,
    percent: total > 0 ? Math.round((watched / total) * 100) : 0,
    nextUnwatchedEpisode: watched < total ? watched + 1 : null,
  }
}

describe("buildArcIndex", () => {
  it("orders rows by story order regardless of input order", () => {
    const rows = buildArcIndex([arc({ slug: "b", order: 2 }), arc({ slug: "a", order: 1 })], new Map())
    expect(rows.map((r) => r.slug)).toEqual(["a", "b"])
  })

  it("zero-pads the ordinal so the column stays aligned", () => {
    const rows = buildArcIndex([arc({ slug: "a", order: 1 }), arc({ slug: "b", order: 12 })], new Map())
    expect(rows.map((r) => r.ordinal)).toEqual(["01", "12"])
  })

  it("renders an open-ended arc as 'Ep N+'", () => {
    const [row] = buildArcIndex([arc({ slug: "rum", order: 7, episodeStart: 784, episodeEnd: null })], new Map())
    expect(row.span).toBe("Ep 784+")
  })

  it("renders a closed arc as a range", () => {
    const [row] = buildArcIndex([arc({ slug: "conan", order: 1, episodeStart: 1, episodeEnd: 128 })], new Map())
    expect(row.span).toBe("Ep 1-128")
  })

  // A slug in the guide with no computed progress used to be read with `!`
  // and threw at render time. A zeroed row is recoverable; a crash is not.
  it("survives a slug with no progress entry", () => {
    const [row] = buildArcIndex([arc({ slug: "new", order: 9 })], new Map())
    expect(row.watched).toBe(0)
    expect(row.total).toBe(0)
    expect(row.percent).toBe(0)
  })

  it("carries the watched count and percent through", () => {
    const [row] = buildArcIndex(
      [arc({ slug: "conan", order: 1 })],
      new Map([["conan", progress(32, 128)]])
    )
    expect(row.watched).toBe(32)
    expect(row.total).toBe(128)
    expect(row.percent).toBe(25)
  })
})

describe("buildArcSegments", () => {
  const rows: ArcIndexRow[] = [
    { ...({} as ArcIndexRow), slug: "a", ordinal: "01", title: "A", episodes: 128 },
    { ...({} as ArcIndexRow), slug: "b", ordinal: "02", title: "B", episodes: 384 },
  ]

  it("scales each segment to its share of the whole plot", () => {
    const segs = buildArcSegments(rows)
    // 128 and 384 of 512 -> 25% and 75%.
    expect(segs[0].widthPercent).toBeCloseTo(25, 1)
    expect(segs[1].widthPercent).toBeCloseTo(75, 1)
  })

  it("sums to 100 so the spine reads as the whole show", () => {
    const segs = buildArcSegments(rows)
    const sum = segs.reduce((s, seg) => s + seg.widthPercent, 0)
    expect(sum).toBeCloseTo(100, 1)
  })

  // A 1-episode arc against a 1200-episode show is 0.08% wide: too narrow to
  // hold a two-character ordinal. The floor must hold in the RESULT, not just
  // be applied before a renormalise that shrinks it again — an earlier version
  // lifted to 7% then divided by the new total and landed back at 6.5%.
  it("holds the legibility floor in the result, not just as an input lift", () => {
    const tiny: ArcIndexRow[] = [
      { ...({} as ArcIndexRow), slug: "big", ordinal: "01", title: "Big", episodes: 1200 },
      { ...({} as ArcIndexRow), slug: "tiny", ordinal: "02", title: "Tiny", episodes: 1 },
    ]
    const segs = buildArcSegments(tiny)
    expect(segs[1].widthPercent).toBeGreaterThanOrEqual(4)
    expect(segs.reduce((s, seg) => s + seg.widthPercent, 0)).toBeCloseTo(100, 1)
    // The money comes off the segment that has room, so it stays widest.
    expect(segs[0].widthPercent).toBeGreaterThan(segs[1].widthPercent)
  })

  it("falls back to true proportions when the floor cannot fit every segment", () => {
    // 30 segments cannot each hold 4% of 100.
    const many: ArcIndexRow[] = Array.from({ length: 30 }, (_, i) => ({
      ...({} as ArcIndexRow),
      slug: `s${i}`,
      ordinal: String(i + 1).padStart(2, "0"),
      title: `S${i}`,
      episodes: 10,
    }))
    const segs = buildArcSegments(many)
    expect(segs.reduce((s, seg) => s + seg.widthPercent, 0)).toBeCloseTo(100, 0)
    expect(segs.every((seg) => seg.widthPercent > 0)).toBe(true)
  })

  it("returns nothing when there is no catalogue to scale", () => {
    expect(buildArcSegments([])).toEqual([])
    expect(
      buildArcSegments([{ ...({} as ArcIndexRow), slug: "a", ordinal: "01", title: "A", episodes: 0 }])
    ).toEqual([])
  })
})

describe("summarizeArcs", () => {
  it("counts eras and episodes and names the year span", () => {
    const rows = buildArcIndex(
      [
        arc({ slug: "a", order: 1, years: "1996-1998" }),
        arc({ slug: "b", order: 2, years: "2015-present", status: "ongoing" }),
      ],
      new Map([
        ["a", progress(0, 128)],
        ["b", progress(0, 400)],
      ])
    )
    const s = summarizeArcs(rows)
    expect(s.eras).toBe(2)
    expect(s.episodes).toBe(528)
    expect(s.ongoing).toBe(1)
    expect(s.firstYear).toBe("1996")
    expect(s.lastYear).toBe("present")
  })
})

describe("nextEpisodeLabel", () => {
  const row = buildArcIndex([arc({ slug: "a", order: 1 })], new Map([["a", progress(10, 128)]]))[0]

  it("names the next unwatched episode for a signed-in reader", () => {
    expect(nextEpisodeLabel(row, true)).toBe("Next: Ep 11")
  })

  it("says nothing to a signed-out reader", () => {
    expect(nextEpisodeLabel(row, false)).toBeNull()
  })

  it("says nothing once the arc is finished", () => {
    const done = buildArcIndex([arc({ slug: "a", order: 1 })], new Map([["a", progress(128, 128)]]))[0]
    expect(nextEpisodeLabel(done, true)).toBeNull()
  })
})
