import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseSeedEntries } from "@/lib/ai/corpus/seed-sql"

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const seedSql = readFileSync(new URL("../../supabase/seed-content.sql", import.meta.url), "utf8")

/** The lines the parser is expected to treat as candidate rows. */
function tupleLines(sql: string): string[] {
  return sql.split("\n").filter((line) => line.trimStart().startsWith("('"))
}

describe("parseSeedEntries on the real seed", () => {
  const result = parseSeedEntries(seedSql)

  it("parses the whole file with nothing skipped", () => {
    expect(result.rows.length).toBeGreaterThanOrEqual(1300)
    expect(result.skipped).toBe(0)
  })

  it("returns exactly one row per value tuple", () => {
    // Equality rather than a range: the seed is regenerated over time, but a row
    // dropped or double-counted by the parser has to fail here instead of
    // quietly shrinking the fixture every later task retrieves from.
    expect(result.rows.length).toBe(tupleLines(seedSql).length)
  })

  it("reads the ep-001 row field by field", () => {
    expect(result.rows.find((entry) => entry.slug === "ep-001")).toEqual({
      slug: "ep-001",
      title: "Roller Coaster Murder Case",
      type: "episode",
      episodeNumber: 1,
      movieNumber: null,
      airDate: "1996-01-08",
      canonOrder: 1,
      synopsis: null,
    })
  })

  it("unescapes the '' quote escape in a title", () => {
    expect(result.rows.find((entry) => entry.slug === "ep-002")?.title).toBe(
      "President's Daughter Kidnapping Case"
    )
  })

  it("keeps commas and parentheses that sit inside a quoted value", () => {
    // The Yaiba synopsis is the densest case in the file: two commas and a
    // parenthesised year, all inside one literal, next to unquoted NULLs.
    expect(result.rows.find((entry) => entry.slug === "yaiba-swordsman-legend-1993")?.synopsis).toBe(
      "Kenyu Densetsu Yaiba (1993), 52 eps, Pastel studio. MAL reference."
    )
  })

  it("has unique slugs", () => {
    expect(new Set(result.rows.map((entry) => entry.slug)).size).toBe(result.rows.length)
  })

  it("covers movie and special rows", () => {
    expect(result.rows.some((entry) => entry.type === "movie" && entry.movieNumber !== null)).toBe(
      true
    )
    expect(result.rows.some((entry) => entry.type === "special")).toBe(true)
  })

  it("covers the second insert statement's from (values ...) block", () => {
    const row = result.rows.find((entry) => entry.slug === "special-lupin-vs-conan-2009")
    expect(row?.type).toBe("special")
    expect(row?.synopsis).toContain("104-min TV special, TMS Entertainment")

    // The row exists in the file only in that indented block, so a parsed row
    // plus the indented source line is the proof the block is read at all.
    const sourceLines = seedSql
      .split("\n")
      .filter((line) => line.includes("'special-lupin-vs-conan-2009'"))
    expect(sourceLines).toHaveLength(1)
    expect(sourceLines[0].startsWith("    (")).toBe(true)
  })

  it("is deterministic", () => {
    expect(parseSeedEntries(seedSql)).toEqual(result)
  })
})

describe("parseSeedEntries on hand-written SQL", () => {
  it("counts a tuple under the arity floor as skipped", () => {
    expect(parseSeedEntries("('a', 'b')")).toEqual({ rows: [], skipped: 1 })
  })

  it("keeps the string 'NULL' distinct from the NULL keyword", () => {
    const result = parseSeedEntries(
      "('t', 'T', 'episode', 1, NULL, '1996-01-08', 1, NULL, 'NULL', 'u', NULL, 1)"
    )
    expect(result.rows[0]?.synopsis).toBe("NULL")
    expect(result.rows[0]?.movieNumber).toBeNull()
    expect(result.rows[0]?.episodeNumber).toBe(1)
  })

  it("skips an unterminated quote instead of throwing", () => {
    const result = parseSeedEntries("('x', 'unterminated, NULL, NULL, NULL, NULL, NULL, NULL, NULL)")
    expect(result.rows).toEqual([])
    expect(result.skipped).toBe(1)
  })

  it("skips a tuple that never closes instead of throwing", () => {
    const result = parseSeedEntries("('x', 'X', 'episode', 1, NULL, '2000-01-01', 1, NULL, NULL")
    expect(result.rows).toEqual([])
    expect(result.skipped).toBe(1)
  })

  it("returns nothing for empty input", () => {
    expect(parseSeedEntries("")).toEqual({ rows: [], skipped: 0 })
  })

  it("parses a tuple with and without a trailing comma", () => {
    const row = "('a','A','episode',1,NULL,'2000-01-01',1,NULL,NULL,'u',NULL,1)"
    expect(parseSeedEntries(`${row},`).rows).toHaveLength(1)
    expect(parseSeedEntries(row).rows).toHaveLength(1)
  })

  it("ignores parentheses that are not value tuples", () => {
    // The real file also holds a column list and CTE expressions that begin with
    // "(". They are not rows: counting them as skipped would make `skipped === 0`
    // impossible on a file that has all 1,331 of its rows intact.
    const columnList = "  (slug, title, type, episode_number, movie_number, air_date,"
    const expression = "  (last.m + n) as canon_order, arc_id::uuid, synopsis, image_url,"
    expect(parseSeedEntries(`${columnList}\n${expression}`)).toEqual({ rows: [], skipped: 0 })
  })
})
