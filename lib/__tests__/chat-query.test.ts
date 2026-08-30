import { describe, expect, it } from "vitest"
import {
  buildOrFilter,
  buildWikiQueries,
  dedupeById,
  expandAliases,
  extractNumbers,
  isRelevantTitle,
  normalizeText,
  prefersEarliest,
  prefersRecent,
  rankEntries,
  rankingTerms,
  scoreEntry,
  searchTermGroups,
  tokenize,
} from "@/lib/chat/query"

describe("normalizeText", () => {
  it("strips punctuation so keywords survive", () => {
    // The original tokenizer split on whitespace only, producing `haibara?`,
    // which matched zero rows and left the bot with no tracker context.
    expect(normalizeText("Who is Ai Haibara?")).toBe("who is ai haibara")
    expect(normalizeText("Movie 19: Sunflowers!!")).toBe("movie 19 sunflowers")
  })
})

describe("tokenize", () => {
  it("does not keep the trailing question mark", () => {
    const keywords = tokenize("Who is Ai Haibara?")
    expect(keywords).toContain("haibara")
    expect(keywords.some((k) => k.includes("?"))).toBe(false)
  })

  it("drops stopwords but keeps meaningful short names", () => {
    const keywords = tokenize("whats haibara first apperance")
    expect(keywords).toContain("haibara")
    expect(keywords).not.toContain("whats")
    expect(keywords).not.toContain("first")
  })

  it("keeps two-letter character names that users actually type", () => {
    expect(tokenize("who is ai")).toContain("ai")
  })

  it("drops two-letter noise", () => {
    expect(tokenize("ep 42 recap")).not.toContain("ep")
  })

  it("orders keywords longest-first so the cut keeps the selective ones", () => {
    const keywords = tokenize("which episode has the ski resort murder case")
    expect(keywords[0]!.length).toBeGreaterThanOrEqual(keywords[keywords.length - 1]!.length)
  })
})

describe("extractNumbers", () => {
  it("reads episode and movie numbers", () => {
    expect(extractNumbers("what happens in movie 19")).toEqual([19])
    expect(extractNumbers("episode 129")).toEqual([129])
  })

  it("ignores years, which are not episode numbers", () => {
    expect(extractNumbers("detective conan 2024")).toEqual([])
  })
})

describe("prefersRecent", () => {
  it("detects recency questions", () => {
    expect(prefersRecent("what is the incoming new movie")).toBe(true)
    expect(prefersRecent("latest movie")).toBe(true)
  })

  it("leaves 'first appearance' questions in chronological order", () => {
    expect(prefersRecent("haibara first apperance")).toBe(false)
  })
})

describe("prefersEarliest", () => {
  it("detects debut questions", () => {
    expect(prefersEarliest("whats haibara first apperance")).toBe(true)
    expect(prefersEarliest("which episode does heiji hattori first appear")).toBe(true)
  })

  it("does not fire for ordinary questions", () => {
    expect(prefersEarliest("whats the movie with the sunflower painting")).toBe(false)
  })
})

describe("expandAliases", () => {
  it("adds the names an episode might use instead", () => {
    // Haibara's debut (Ep 129) is filed as "Shiho Miyano", so a search for
    // "haibara" alone cannot reach it.
    expect(expandAliases(["haibara"])).toContain("shiho")
  })

  it("does not add the ambiguous family surname", () => {
    // "Miyano" also belongs to her sister Akemi, which pulled Ep 128 ahead of
    // the real debut.
    expect(expandAliases(["haibara"])).not.toContain("miyano")
  })

  it("never emits a term too short to be selective", () => {
    expect(expandAliases(["haibara"]).every((t) => t.length >= 3)).toBe(true)
  })

  it("does not alias unknown words", () => {
    expect(expandAliases(["sunflower"])).toEqual([])
  })
})

describe("searchTermGroups", () => {
  it("offers a selective group, a full group and an alias group", () => {
    const groups = searchTermGroups(["apperance", "haibara"])
    expect(groups[0]).toEqual(["apperance", "haibara"])
    expect(groups.some((g) => g.includes("shiho"))).toBe(true)
  })

  it("always returns at least one group", () => {
    expect(searchTermGroups([]).length).toBeGreaterThan(0)
  })
})

describe("rankingTerms", () => {
  it("keeps the user's words and appends aliases", () => {
    expect(rankingTerms(["haibara"])).toEqual(["haibara", "shiho", "sherry"])
  })
})

describe("scoreEntry with linked case text", () => {
  it("finds an episode through the text of its case record", () => {
    // Ep 57 has a null synopsis and never names Heiji in its title — it is only
    // reachable via "when Conan and Heiji looked inside the window".
    const episode = {
      title: "Holmes Freak Murder Case (Part 1)",
      episode_number: 57,
      air_date: "1997-05-05",
      synopsis: null,
    }
    expect(scoreEntry(episode, ["heiji"])).toBe(0)
    expect(scoreEntry({ ...episode, extra: "Conan and Heiji looked inside" }, ["heiji"])).toBeGreaterThan(0)
  })
})

describe("rankEntries with chronological intent", () => {
  const entries = [
    { id: "loud", title: "Three Days with Hattori Heiji", air_date: "2007-07-16" },
    { id: "debut", title: "Holmes Freak Murder Case", air_date: "1997-05-05", extra: "Conan and Heiji" },
    { id: "mid", title: "Heiji Hattori's Desperate Situation!", air_date: "2003-06-09" },
  ]

  // tokenize() emits longest-first, so "hattori" precedes "heiji".
  const terms = ["hattori", "heiji"]

  it("puts the loudest title first by default", () => {
    expect(rankEntries(entries, terms)[0]!.id).toBe("loud")
  })

  it("puts the earliest first for debut questions", () => {
    expect(rankEntries(entries, terms, { preferEarliest: true })[0]!.id).toBe("debut")
  })

  it("puts the newest first for recency questions", () => {
    expect(rankEntries(entries, terms, { preferRecent: true })[0]!.id).toBe("loud")
  })
})

describe("buildOrFilter", () => {
  it("sanitises PostgREST control characters", () => {
    const filter = buildOrFilter(["a,b(c)"], ["title"])
    expect(filter).toBe("title.ilike.%a b c%")
  })
})

describe("scoreEntry", () => {
  it("weights a title hit above a synopsis mention", () => {
    const titleHit = scoreEntry({ title: "Sunflowers of Inferno" }, ["sunflower"])
    const synopsisHit = scoreEntry(
      { title: "Untitled", synopsis: "A painting of sunflowers is stolen." },
      ["sunflower"]
    )
    expect(titleHit).toBeGreaterThan(synopsisHit)
  })

  it("rewards matching several keywords over matching one", () => {
    const both = scoreEntry({ title: "Kaitou Kid and the Sunflowers" }, ["kaito", "sunflower"])
    const one = scoreEntry({ title: "The Sunflowers" }, ["kaito", "sunflower"])
    expect(both).toBeGreaterThan(one)
  })

  it("treats an exact number as decisive", () => {
    const exact = scoreEntry({ title: "Anything", movie_number: 19 }, ["unrelated"], [19])
    const fuzzy = scoreEntry({ title: "Movie 19 something" }, ["unrelated"], [19])
    expect(exact).toBeGreaterThan(0)
    expect(exact).toBeGreaterThan(fuzzy)
  })

  it("scores zero when nothing matches", () => {
    expect(scoreEntry({ title: "Moonlight Sonata" }, ["haibara"])).toBe(0)
  })
})

describe("rankEntries", () => {
  const entries = [
    { id: "a", title: "Episode 5", synopsis: "Heiji is mentioned once", air_date: "1996-02-05" },
    { id: "b", title: "Heiji Hattori debut", synopsis: "Heiji Hattori appears", air_date: "1997-05-19" },
    { id: "c", title: "Episode 7", synopsis: "Hattori is mentioned", air_date: "1996-02-19" },
    { id: "d", title: "Unrelated filler", synopsis: "Nothing relevant", air_date: "1996-01-08" },
  ]

  it("puts the most relevant entry first instead of the oldest", () => {
    const ranked = rankEntries(entries, ["heiji", "hattori"])
    expect(ranked[0]!.id).toBe("b")
  })

  it("drops entries that match nothing", () => {
    const ranked = rankEntries(entries, ["heiji", "hattori"])
    expect(ranked.map((e) => e.id)).not.toContain("d")
  })

  it("breaks score ties on air date, oldest first by default", () => {
    const tie = [
      { id: "old", title: "Heiji case", air_date: "1997-01-01" },
      { id: "new", title: "Heiji case", air_date: "2005-01-01" },
    ]
    expect(rankEntries(tie, ["heiji"]).map((e) => e.id)).toEqual(["old", "new"])
  })

  it("breaks score ties newest-first for recency questions", () => {
    const tie = [
      { id: "old", title: "Movie", air_date: "1997-01-01" },
      { id: "new", title: "Movie", air_date: "2005-01-01" },
    ]
    expect(rankEntries(tie, ["movie"], { preferRecent: true }).map((e) => e.id)).toEqual([
      "new",
      "old",
    ])
  })
})

describe("dedupeById", () => {
  it("keeps the first occurrence and preserves order", () => {
    const rows = [
      { id: "1", title: "a" },
      { id: "2", title: "b" },
      { id: "1", title: "a again" },
    ]
    expect(dedupeById(rows).map((r) => r.title)).toEqual(["a", "b"])
  })
})

describe("isRelevantTitle", () => {
  it("accepts a page that shares a keyword with the question", () => {
    expect(isRelevantTitle("Ai Haibara", ["haibara"])).toBe(true)
    expect(isRelevantTitle("Sunflowers of Inferno", ["sunflower", "painting"])).toBe(true)
  })

  it("rejects generic franchise pages that merely rank well", () => {
    expect(isRelevantTitle("Arthur Conan Doyle", ["ski", "resort", "murder"])).toBe(false)
  })

  it("rejects everything when there are no keywords to match", () => {
    expect(isRelevantTitle("Anything", [])).toBe(false)
  })
})

describe("buildWikiQueries", () => {
  it("falls back to single keywords, because MediaWiki ANDs every term", () => {
    const queries = buildWikiQueries(
      "whats the movie where kaito kid appeared with the sunflower painting"
    )
    // The full question matches nothing on the live wiki; a lone keyword does.
    expect(queries).toContain("sunflower")
    expect(queries).toContain("painting")
  })

  it("tries list pages first for recency questions", () => {
    const queries = buildWikiQueries("what is the incoming new movie")
    expect(queries[0]).toBe("List of Detective Conan movies")
  })

  it("never returns an empty query", () => {
    for (const q of buildWikiQueries("??? !!")) {
      expect(q.trim()).not.toBe("")
    }
  })
})
