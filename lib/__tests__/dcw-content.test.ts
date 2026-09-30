import { describe, expect, it } from "vitest"
import {
  dcwLinkTitle,
  filterDcwItemsByYear,
  isDcwPlaceholderTitle,
  parseDcwAirDate,
  parseDcwMovieItems,
  parseDcwOvaItems,
  parseDcwSeasonItems,
  parseDcwSeasonPages,
  parseDcwSpecialItems,
  splitTemplateArgs,
  stripDcwMarkup,
} from "@/lib/dcw-content"

/** Captured from the live "TV Specials" page, trimmed to the shapes that matter. */
const SPECIALS_WIKITEXT = `
This is a list of all the TV specials produced for the [[Detective Conan]] series.

== List of TV specials ==
<onlyinclude>
{{BeginTable Special}}
{{SpecialItem|1|''[[Time Travel of the Silver Sky]]''|April 10, 2004<ref>http://kazu392.web.fc2.com/de/co/010.html</ref>|
|pmk=This special is about Kaitou Kid.
|summary=[[Hiroshi Agasa|Professor Agasa]] has created a computer program.}}

{{SpecialItem|4|''[[Fugitive: Kogoro Mouri]]''|April 23, 2014 <small>(On cellphone)</small><ref name="date">http://nconan.web.fc2.com/specials/</ref> <br> January 3, 2015 <small>(On TV)</small><ref name="date">http://nconan.web.fc2.com/specials/</ref>|
summary=[[Kogoro Mouri]] appears to be on the run.}}

{{SpecialItem|6|''[[Episode One: The Great Detective Turned Small]]''|December 9, 2016<ref>https://www.cinematoday.jp/news/N0087554</ref>|{{Inline icons|Bang Zoom}} December 7, 2019|
|pbo=This special contains new scenes.}}

{{SpecialItem|7|''[[Love Story at Police Headquarters ~Wedding Eve~]]''|April 15, 2022|
|summary=A romance.}}

{{SpecialItem|8|''[[The Gold-Star Answer]]''|June 6, 2026<ref name="yt">https://youtu.be/example</ref>|
|summary=The newest movie tie-in.}}

{{SpecialItem|9|''[[The Counterfeit Case of Ultra 30]]''|September 25, 2026|
|summary=The latest TV special.}}
{{EndTable}}
</onlyinclude>
`

/** Captured from "Season 31" (the 2026 season page), trimmed to the row shapes. */
const SEASON_WIKITEXT = `
{{Seasons}}
The '''thirty-first season''' of the [[Anime|''Detective Conan'' anime]] consists of the episodes aired in the year '''2026'''.

== List of episodes ==
{{BeginTable Season}}
{{SeasonItem|1187|1245-1246|[[Episode "ZERO" The Shinichi Kudo Aquarium Case|''Episode "ZERO" The Shinichi Kudo Aquarium Case'' <small>(1 Hour Special)</small>]]|January 3, 2026|
|summary=Conan visits the aquarium.}}

{{SeasonItem|1188|1247|''[[Follow Them! Detective Taxi 3]]''|January 10, 2026|
|pchar=The Detective Boys.}}

{{SeasonItem|1098<br>R162|1156|[[Chihaya Hagiwara, Goddess of the Wind|''Chihaya Hagiwara, Goddess of the Wind'' <small>(Part 1) (Remastered) <ref name="fremr"/></small>]]|February 7, 2026|
|pnew=None.}}

{{SeasonItem|P1|1244|[[The Gold-Star Answer]]|June 6, 2026|
|summary=A TV special, listed on the season table too.}}

{{SeasonItem|-|1245|[[The Counterfeit Case of Ultra 30]]|September 25, 2026|}}

{{SeasonItem|1216|1274|[[The Crimson Closing Day|''The Crimson Closing Day'' <small>(Last Day)</small>]]|October 10, 2026|}}

{{SeasonItem|-||The Murder of Thirty-One Island ({{tt|unconfirmed translation|Japanese}})|TBA|}}
{{EndTable}}
`

/** Captured from "Regular movies", including the untitled placeholder row. */
const MOVIES_WIKITEXT = `
{{BeginTable Movie}}
{{MovieItem|1|''[[The Time-Bombed Skyscraper]]''|April 19, 1997|{{Inline icons|Funimation}} October 3, 2006|95 minutes|1.10 billion yen|
|pnew=First appearance of [[Ninzaburo Shiratori]].}}
{{MovieItem|29|''[[Fallen Angel of the Highway]]''|April 10, 2026|{{Inline icons|Crunchyroll}} October 1, 2026|110 minutes|
|summary=A 2026 film.}}
{{MovieItem|30|''[[Movie 30]]''|April 2027|
|summary=Announced but untitled.}}
{{EndTable}}
`

/** Captured from the OVA page, including its unnumbered rows. */
const OVAS_WIKITEXT = `
{{BeginTable OVA}}
{{OVAItem|1|''[[Conan vs. Kid vs. Yaiba - The Grand Battle for the Treasure Sword!!]]''|October 11, 2000<ref>https://example.com</ref>|
|pnew=First appearance of [[Akako Koizumi]].}}
{{OVAItem|10|''[[The Target is Kogoro Mouri!! The Detective Boys' Secret Investigation]]''|April 9, 2010|}}
{{OVAItem|Extra|''[[The Mysterious Murder Plan (The Making of Conan)]]''|December 22, 1999|}}
{{OVAItem|-|''[[Yaiba (pilot OVA)]]''|1991|}}
{{EndTable}}
`

describe("stripDcwMarkup", () => {
  it("drops refs, HTML and templates but keeps the prose", () => {
    expect(stripDcwMarkup("April 23, 2014 <small>(On cellphone)</small>")).toBe(
      "April 23, 2014 (On cellphone)"
    )
    expect(stripDcwMarkup("June 6, 2026<ref name=\"yt\">https://youtu.be/x</ref>")).toBe("June 6, 2026")
  })
})

describe("dcwLinkTitle", () => {
  it("unwraps a plain link and strips italics", () => {
    expect(dcwLinkTitle("''[[Time Travel of the Silver Sky]]''")).toBe("Time Travel of the Silver Sky")
  })

  it("prefers the display label of a piped link", () => {
    expect(dcwLinkTitle("''[[Meitantei Conan|Detective Conan]]''")).toBe("Detective Conan")
  })
})

describe("parseDcwAirDate", () => {
  it("parses the month-first form the wiki uses", () => {
    expect(parseDcwAirDate("April 10, 2004<ref>http://example.com</ref>")).toBe("2004-04-10")
  })

  it("takes the FIRST airing when a field lists several dates", () => {
    expect(
      parseDcwAirDate("April 23, 2014 <small>(On cellphone)</small> <br> January 3, 2015 <small>(On TV)</small>")
    ).toBe("2014-04-23")
  })

  it("accepts an ISO date and the day-first spelling", () => {
    expect(parseDcwAirDate("2026-09-25")).toBe("2026-09-25")
    expect(parseDcwAirDate("25 September 2026")).toBe("2026-09-25")
  })

  it("returns null for a field with no recognisable date", () => {
    expect(parseDcwAirDate("TBA")).toBeNull()
    expect(parseDcwAirDate("April 2027")).toBeNull()
  })
})

describe("splitTemplateArgs", () => {
  it("splits on top-level pipes only", () => {
    expect(splitTemplateArgs("1|''[[A|B]]''|{{Inline icons|Crunchyroll}} October 1, 2026")).toEqual([
      "1",
      "''[[A|B]]''",
      "{{Inline icons|Crunchyroll}} October 1, 2026",
    ])
  })
})

describe("parseDcwSpecialItems", () => {
  const items = parseDcwSpecialItems(SPECIALS_WIKITEXT)

  it("reads every SpecialItem row in list order", () => {
    expect(items.map((i) => i.number)).toEqual([1, 4, 6, 7, 8, 9])
  })

  it("keeps titles and dates for the newest specials", () => {
    expect(items.at(-1)).toEqual({
      number: 9,
      title: "The Counterfeit Case of Ultra 30",
      airDate: "2026-09-25",
    })
    expect(items.at(-2)).toEqual({
      number: 8,
      title: "The Gold-Star Answer",
      airDate: "2026-06-06",
    })
  })

  it("ignores prose, table wrappers and summary fields", () => {
    expect(items.find((i) => i.title.includes("Agasa"))).toBeUndefined()
  })

  it("returns nothing for an empty or unrelated page", () => {
    expect(parseDcwSpecialItems("")).toEqual([])
    expect(parseDcwSpecialItems("#REDIRECT [[TV Specials]]")).toEqual([])
  })
})

describe("parseDcwSeasonItems", () => {
  const items = parseDcwSeasonItems(SEASON_WIKITEXT)

  it("reads numbered episodes and skips non-episode rows", () => {
    expect(items.map((i) => i.number)).toEqual([1098, 1187, 1188, 1216])
    expect(items.find((i) => i.title.includes("Gold-Star"))).toBeUndefined()
    expect(items.find((i) => i.title.includes("Ultra 30"))).toBeUndefined()
    expect(items.find((i) => i.title.includes("Thirty-One Island"))).toBeUndefined()
  })

  it("keeps the episode title, including its parenthetical, and the air date", () => {
    expect(items.find((i) => i.number === 1187)).toEqual({
      number: 1187,
      title: 'Episode "ZERO" The Shinichi Kudo Aquarium Case (1 Hour Special)',
      airDate: "2026-01-03",
      remastered: false,
    })
  })

  it("flags rebroadcasts, whose date is the rebroadcast's", () => {
    expect(items.find((i) => i.number === 1098)).toMatchObject({
      remastered: true,
      airDate: "2026-02-07",
    })
  })

  it("drops rebroadcasts from a current-year pull", () => {
    const currentYear = filterDcwItemsByYear(items, 2026).filter((i) => !i.remastered)
    expect(currentYear.map((i) => i.number)).toEqual([1187, 1188, 1216])
  })
})

describe("parseDcwSeasonPages", () => {
  it("keeps Season links and drops the non-season ones", () => {
    const index = `
{{Seasons}}
{{main|Season 1}}
{{main|Season 30}}
{{main|Season 31|thirty-first season}}
{{main|Chapters not yet scheduled to animate}}
`
    expect(parseDcwSeasonPages(index)).toEqual(["Season 1", "Season 30", "Season 31"])
  })
})

describe("parseDcwMovieItems", () => {
  const items = parseDcwMovieItems(MOVIES_WIKITEXT)

  it("reads numbered films with their theatrical release date", () => {
    expect(items).toEqual([
      { number: 1, title: "The Time-Bombed Skyscraper", airDate: "1997-04-19" },
      { number: 29, title: "Fallen Angel of the Highway", airDate: "2026-04-10" },
    ])
  })

  it("skips an announced-but-untitled placeholder row", () => {
    expect(items.find((i) => i.title === "Movie 30")).toBeUndefined()
  })
})

describe("parseDcwOvaItems", () => {
  it("reads numbered OVAs and drops the Extra/- rows", () => {
    expect(parseDcwOvaItems(OVAS_WIKITEXT).map((i) => i.number)).toEqual([1, 10])
  })
})

describe("isDcwPlaceholderTitle", () => {
  it("recognises untitled placeholders", () => {
    expect(isDcwPlaceholderTitle("Movie 30")).toBe(true)
    expect(isDcwPlaceholderTitle("TBA")).toBe(true)
    expect(isDcwPlaceholderTitle("Fallen Angel of the Highway")).toBe(false)
  })
})

describe("filterDcwItemsByYear", () => {
  it("keeps only items the wiki dates inside the year", () => {
    const items = [
      { number: 1, title: "A", airDate: "2026-04-10" },
      { number: 2, title: "B", airDate: "2025-12-31" },
      { number: 3, title: "C", airDate: null },
      { number: 4, title: "D", airDate: "2027-01-02" },
    ]
    expect(filterDcwItemsByYear(items, 2026).map((i) => i.number)).toEqual([1])
  })
})
