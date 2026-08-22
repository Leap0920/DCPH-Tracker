import { describe, expect, it } from "vitest"
import {
  ANIME_CANON_RANGES,
  CANON_TYPES,
  CANON_TYPE_ORDER,
  FILLER_RANGES,
  MANGA_CANON_RANGES,
  MAX_EPISODE,
  canonRangeTotal,
  canonRangesFor,
  canonTypeForEpisode,
  formatEpisodeRange,
  validateCanonPartition,
} from "../canon-guide"

describe("canon-guide parsing", () => {
  it("covers episodes 1 through 1212", () => {
    expect(MAX_EPISODE).toBe(1212)
  })

  it("reads the first and last range of each category", () => {
    expect(MANGA_CANON_RANGES[0]).toEqual([1, 5])
    expect(MANGA_CANON_RANGES[MANGA_CANON_RANGES.length - 1]).toEqual([1204, 1205])
    expect(FILLER_RANGES[0]).toEqual([6, 6])
    expect(FILLER_RANGES[FILLER_RANGES.length - 1]).toEqual([1206, 1212])
    expect(ANIME_CANON_RANGES).toEqual([[1187, 1187]])
  })

  it("produces well-formed, strictly ascending, non-overlapping ranges per category", () => {
    for (const type of CANON_TYPE_ORDER) {
      const ranges = canonRangesFor(type)
      expect(ranges.length).toBeGreaterThan(0)
      let prevEnd = 0
      for (const [start, end] of ranges) {
        expect(start, `${type} range start`).toBeGreaterThan(prevEnd)
        expect(end, `${type} range [${start}-${end}]`).toBeGreaterThanOrEqual(start)
        prevEnd = end
      }
    }
  })

  it("formats ranges the way the source does", () => {
    expect(formatEpisodeRange([6, 6])).toBe("6")
    expect(formatEpisodeRange([1, 5])).toBe("1-5")
  })
})

describe("canon-guide partition invariant", () => {
  it("assigns every episode in 1..MAX_EPISODE to exactly one category", () => {
    const report = validateCanonPartition()
    expect(report.malformed).toEqual([])
    expect(report.duplicates).toEqual([])
    expect(report.missing).toEqual([])
    expect(report.ok).toBe(true)
  })

  it("has no episode classified by two categories (independent recount)", () => {
    const seen = new Map<number, string[]>()
    for (const type of CANON_TYPE_ORDER) {
      for (const [start, end] of canonRangesFor(type)) {
        for (let n = start; n <= end; n++) {
          const owners = seen.get(n)
          if (owners) owners.push(type)
          else seen.set(n, [type])
        }
      }
    }
    const conflicts = [...seen.entries()].filter(([, owners]) => owners.length > 1)
    expect(conflicts).toEqual([])
    expect(seen.size).toBe(MAX_EPISODE)
  })

  it("category totals sum to the full episode count", () => {
    const sum = CANON_TYPE_ORDER.reduce((acc, type) => acc + canonRangeTotal(type), 0)
    expect(sum).toBe(MAX_EPISODE)
  })

  it("classifies every episode in range and nothing outside it", () => {
    for (let n = 1; n <= MAX_EPISODE; n++) {
      expect(canonTypeForEpisode(n), `episode ${n}`).not.toBeNull()
    }
  })

  it("counts anime canon as exactly one episode", () => {
    expect(canonRangeTotal(CANON_TYPES.ANIME_CANON)).toBe(1)
  })
})

describe("canonTypeForEpisode boundaries", () => {
  const cases: [number, string][] = [
    [1, CANON_TYPES.MANGA],
    [5, CANON_TYPES.MANGA],
    [6, CANON_TYPES.FILLER],
    [7, CANON_TYPES.MANGA],
    [13, CANON_TYPES.MANGA],
    [14, CANON_TYPES.FILLER],
    [15, CANON_TYPES.MANGA],
    [1185, CANON_TYPES.MANGA],
    [1186, CANON_TYPES.FILLER],
    [1187, CANON_TYPES.ANIME_CANON],
    [1188, CANON_TYPES.FILLER],
    [1192, CANON_TYPES.FILLER],
    [1193, CANON_TYPES.MANGA],
    [1194, CANON_TYPES.MANGA],
    [1195, CANON_TYPES.FILLER],
    [1203, CANON_TYPES.FILLER],
    [1204, CANON_TYPES.MANGA],
    [1205, CANON_TYPES.MANGA],
    [1206, CANON_TYPES.FILLER],
    [1212, CANON_TYPES.FILLER],
  ]

  it.each(cases)("episode %i is %s", (n, expected) => {
    expect(canonTypeForEpisode(n)).toBe(expected)
  })

  it("returns null outside the known range or for non-integers", () => {
    expect(canonTypeForEpisode(0)).toBeNull()
    expect(canonTypeForEpisode(-1)).toBeNull()
    expect(canonTypeForEpisode(MAX_EPISODE + 1)).toBeNull()
    expect(canonTypeForEpisode(1213)).toBeNull()
    expect(canonTypeForEpisode(12.5)).toBeNull()
    expect(canonTypeForEpisode(Number.NaN)).toBeNull()
    expect(canonTypeForEpisode(null)).toBeNull()
    expect(canonTypeForEpisode(undefined)).toBeNull()
  })
})
