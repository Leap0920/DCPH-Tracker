import { describe, expect, it } from "vitest"
import { escapeLike, ilikeOr, quoteFilterValue } from "@/lib/postgrest-filter"

/**
 * The expected strings here were verified against the live PostgREST endpoint:
 * an unquoted value holding a comma is rejected (400 PGRST100), an unquoted
 * value holding brackets silently matches nothing, and a quoted value whose
 * backslashes are NOT doubled silently widens the LIKE pattern.
 */
describe("escapeLike", () => {
  it("neutralizes the LIKE wildcards", () => {
    expect(escapeLike("100%")).toBe("100\\%")
    expect(escapeLike("ep_1")).toBe("ep\\_1")
  })

  it("escapes the escape character itself", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b")
  })

  it("leaves ordinary text alone", () => {
    expect(escapeLike("hattori heiji")).toBe("hattori heiji")
  })
})

describe("quoteFilterValue", () => {
  it("wraps the value in double quotes", () => {
    expect(quoteFilterValue("%conan%")).toBe('"%conan%"')
  })

  it("doubles backslashes so LIKE escapes survive the quoted grammar", () => {
    // "%100\%%" would reach Postgres as "%100%%" (match anything with 100);
    // doubling keeps the backslash, which is what makes the % literal.
    expect(quoteFilterValue("%100\\%%")).toBe('"%100\\\\%%"')
  })

  it("escapes an embedded double quote", () => {
    expect(quoteFilterValue('a"b')).toBe('"a\\"b"')
  })
})

describe("ilikeOr", () => {
  it("builds one quoted ilike term per field", () => {
    expect(ilikeOr("conan", ["title", "slug"])).toBe(
      'title.ilike."%conan%",slug.ilike."%conan%"'
    )
  })

  it("keeps a bracketed title inside the quotes", () => {
    // Unquoted, this parsed as `title.ilike.%Detective Conan: The Movie (1997)%`
    // and returned zero rows instead of the film.
    expect(ilikeOr("The Movie (1997)", ["title"])).toBe(
      'title.ilike."%The Movie (1997)%"'
    )
  })

  it("keeps a comma inside the quotes", () => {
    const filter = ilikeOr("Conan, the", ["title", "synopsis"])
    expect(filter).toBe('title.ilike."%Conan, the%",synopsis.ilike."%Conan, the%"')
    // The query's own comma stays inside the quotes: the only unquoted ones are
    // the field separators, which is what PostgREST splits the grammar on.
    expect(filter.split('",')).toHaveLength(2)
  })

  it("neutralizes wildcards and still quotes the result", () => {
    expect(ilikeOr("100%", ["title"])).toBe('title.ilike."%100\\\\%%"')
  })

  it("handles the empty query", () => {
    expect(ilikeOr("", ["title"])).toBe('title.ilike."%%"')
  })
})
