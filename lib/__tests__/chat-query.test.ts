import { describe, expect, it } from "vitest"
import {
  buildOrFilter,
  buildWikiQueries,
  dedupeById,
  expandAliases,
  extractCulpritName,
  extractNumbers,
  firstWikiLinkTarget,
  isAppearancesTitle,
  isGalleryTitle,
  isJunkWikiExtract,
  isRelevantTitle,
  isSoftRedirect,
  matchCrimeMethod,
  matchSpecialKind,
  normalizeText,
  prefersEarliest,
  prefersList,
  prefersRecent,
  prioritizeResolution,
  queryWords,
  rankEntries,
  rankingTerms,
  scoreEntry,
  scoreWikiTitle,
  searchTermGroups,
  searchTerms,
  tokenize,
  translateTerms,
  wantsAppearances,
  wantsCulprit,
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

describe("scoreWikiTitle", () => {
  const words = queryWords("Who is Ai Haibara?")

  it("ranks the entity the question is about above pages that merely mention it", () => {
    // MediaWiki put the "List of characters who know…" page first.
    expect(scoreWikiTitle("Ai Haibara", words)).toBeGreaterThan(
      scoreWikiTitle("List of characters who know Ai Haibara's identity", words)
    )
  })

  it("demotes galleries, appearances and timelines", () => {
    expect(scoreWikiTitle("Vermouth", queryWords("Who is Vermouth?"))).toBeGreaterThan(
      scoreWikiTitle("Vermouth Appearances", queryWords("Who is Vermouth?"))
    )
    expect(scoreWikiTitle("Rum", queryWords("Who is Rum?"))).toBeGreaterThan(
      scoreWikiTitle("Rum/Gallery", queryWords("Who is Rum?"))
    )
  })

  it("still orders pages that match no full title", () => {
    const gadgetWords = queryWords("What does Conan's skateboard do?")
    expect(scoreWikiTitle("Turbo Engine Skateboard", gadgetWords)).toBeGreaterThan(
      scoreWikiTitle("Turbo Engine Skateboard Appearances", gadgetWords)
    )
  })

  it("scores an exact entity title highest", () => {
    expect(scoreWikiTitle("Gadgets", queryWords("What are Conan's gadgets?"))).toBe(10)
  })
})

describe("isGalleryTitle / isJunkWikiExtract / isSoftRedirect", () => {
  it("recognises gallery subpages", () => {
    expect(isGalleryTitle("The Black Organization's Scheme/Gallery")).toBe(true)
    expect(isGalleryTitle("Rum/Images")).toBe(true)
    expect(isGalleryTitle("Rum")).toBe(false)
    expect(isGalleryTitle("Gallery")).toBe(false)
  })

  it("recognises gallery blurbs", () => {
    expect(isJunkWikiExtract("This is a gallery of images for the episode: X.")).toBe(true)
    expect(isJunkWikiExtract("Vermouth is an actress and member of the Black Organization.")).toBe(false)
  })

  it("recognises spoiler soft redirects", () => {
    expect(isSoftRedirect("This soft redirect is meant to reduce the number of people who spoil themselves.")).toBe(true)
    expect(isSoftRedirect("Rum is the Black Organization's number two.")).toBe(false)
  })
})

describe("firstWikiLinkTarget", () => {
  it("skips the notice icon and returns the article", () => {
    const html = `<td><a href="/wiki/File:Ambox_content.png"><img src="x" /></a></td>
      <td><a href="/wiki/Kanenori_Wakita" title="Kanenori Wakita">Click to continue</a></td>`
    expect(firstWikiLinkTarget(html)).toBe("Kanenori Wakita")
  })

  it("returns null when there is no article link", () => {
    expect(firstWikiLinkTarget(`<p><a href="/wiki/File:Logo.png">logo</a></p>`)).toBe(null)
    expect(firstWikiLinkTarget("<p>no links here</p>")).toBe(null)
  })
})

describe("isAppearancesTitle", () => {
  it("matches the wiki's per-character appearance indexes", () => {
    expect(isAppearancesTitle("Vermouth Appearances")).toBe(true)
    expect(isAppearancesTitle("Ai Haibara Appearances")).toBe(true)
    expect(isAppearancesTitle("Vermouth")).toBe(false)
    expect(isAppearancesTitle("Appearances")).toBe(false)
  })
})

/**
 * The wiki's own "X Appearances" index is the answer to an appearance
 * question, so the wording of the question flips its ranking.
 */
describe("scoreWikiTitle with appearance questions", () => {
  const words = queryWords("list all of Vermouth's appearances")

  it("prefers the index when the user asked for appearances", () => {
    expect(scoreWikiTitle("Vermouth Appearances", words, { wantsAppearances: true })).toBeGreaterThan(
      scoreWikiTitle("Vermouth Appearances", words)
    )
  })

  it("still demotes non-appearance list pages", () => {
    expect(
      scoreWikiTitle("List of characters who know Ai Haibara's identity", words, {
        wantsAppearances: true,
      })
    ).toBeLessThan(0)
  })
})

describe("prefersList", () => {
  it("recognises list requests", () => {
    expect(prefersList("give me eps that have stabbing")).toBe(true)
    expect(prefersList("list all episodes with drowning")).toBe(true)
    expect(prefersList("which episodes have a locked room trick")).toBe(true)
    expect(prefersList("episodes where someone is poisoned")).toBe(true)
    expect(prefersList("how many episodes are there")).toBe(true)
  })

  it("does not fire on ordinary questions", () => {
    expect(prefersList("who is Ai Haibara")).toBe(false)
    expect(prefersList("summarise episode 141")).toBe(false)
    expect(prefersList("what happens in the ski lodge murder")).toBe(false)
  })
})

describe("matchCrimeMethod", () => {
  it("maps the user's wording onto the /cases filter slugs", () => {
    expect(matchCrimeMethod("give me eps that have stabbing")).toEqual({
      kind: "cause",
      slug: "stabbing",
      label: "Stabbing",
    })
    expect(matchCrimeMethod("episodes where someone was poisoned")).toEqual({
      kind: "cause",
      slug: "poisoning",
      label: "Poisoning",
    })
    expect(matchCrimeMethod("list all kidnapping cases")).toEqual({
      kind: "crime",
      slug: "kidnapping",
      label: "Kidnapping & Hostage",
    })
    expect(matchCrimeMethod("which episodes have a hangman's noose")).toBe(null)
  })

  it("ignores a generic crime without an explicit list request", () => {
    expect(matchCrimeMethod("what happened in the ski lodge murder")).toBe(null)
    expect(matchCrimeMethod("list all murder cases")?.slug).toBe("murder")
    expect(matchCrimeMethod("how many murder episodes are there")?.slug).toBe("murder")
  })
})

describe("matchSpecialKind", () => {
  it("recognises long-format requests", () => {
    expect(matchSpecialKind("list the 2-hour specials")).toBe("two-hour")
    expect(matchSpecialKind("which two hour episodes are there")).toBe("two-hour")
    expect(matchSpecialKind("what are the one-hour specials")).toBe("one-hour")
    expect(matchSpecialKind("list every special episode")).toBe("specials")
    expect(matchSpecialKind("which OVA episodes exist")).toBe("specials")
  })

  it("stays quiet on normal questions", () => {
    expect(matchSpecialKind("who is Rum")).toBe(null)
    expect(matchSpecialKind("summarise episode 141")).toBe(null)
  })

  it("ignores a named entry that merely calls itself special", () => {
    // Every one of these used to attach the 103-row long-format listing to an
    // answer about a single episode.
    expect(matchSpecialKind("what is the special episode 1209 about")).toBe(null)
    expect(matchSpecialKind("tell me about the 2-hour special episode 129")).toBe(null)
    expect(matchSpecialKind("summarise OVA 2")).toBe(null)
  })

  it("still recognises a set request even when an entry is named", () => {
    expect(matchSpecialKind("list all the 2-hour specials")).toBe("two-hour")
    expect(matchSpecialKind("give me all special episodes after episode 129")).toBe("specials")
    expect(matchSpecialKind("how many specials are there")).toBe("specials")
  })
})

describe("wantsCulprit / wantsAppearances", () => {
  it("recognises resolution questions", () => {
    expect(wantsCulprit("who is the murderer in episode 141")).toBe(true)
    expect(wantsCulprit("who killed the victim in the wedding case")).toBe(true)
    expect(wantsCulprit("how was the locked room trick done")).toBe(true)
    expect(wantsCulprit("what is episode 141 about")).toBe(false)
  })

  it("recognises appearance questions", () => {
    expect(wantsAppearances("all of Vermouth's appearances")).toBe(true)
    expect(wantsAppearances("when does Heiji first appear")).toBe(true)
    expect(wantsAppearances("who is Vermouth")).toBe(false)
  })
})

/**
 * The live failure these pin: asked "who is the murderer in episode 141", the
 * bot answered "Yuji Sakuraba" — the suspect the resolution's narrative accuses
 * first — while the same paragraph reveals Kikuhito Morizono as the real
 * culprit five sentences later.
 */
describe("prioritizeResolution / extractCulpritName", () => {
  const DCW_RESOLUTION =
    "Continuing the investigation, Heiji proclaims the family servant was the murderer and he is taken away, screaming his innocence. Heiji and Conan start their deduction. They revealed that the culprit is Sakuraba. Sakuraba is soon arrested. However, the murder weapon is still missing. The real culprit is revealed to be Kikuhito Morizono. Heiji and Conan fake him out by stating Sakuraba is the criminal."

  it("moves the reveal in front of the false accusation", () => {
    const ordered = prioritizeResolution(DCW_RESOLUTION)
    expect(ordered.startsWith("The real culprit is revealed to be Kikuhito Morizono.")).toBe(true)
    expect(ordered).toContain("They revealed that the culprit is Sakuraba")
  })

  it("reads the real culprit's name, not the first accused suspect", () => {
    expect(extractCulpritName(prioritizeResolution(DCW_RESOLUTION))).toBe("Kikuhito Morizono")
    expect(extractCulpritName("They revealed that the culprit is Sakuraba.")).not.toBe("Sakuraba")
  })

  it("handles the other reveal phrasings DCW uses", () => {
    expect(extractCulpritName("The true culprit was revealed to be Akemi Miyano.")).toBe("Akemi Miyano")
    expect(extractCulpritName("The culprit turned out to be Shinichi Kudo.")).toBe("Shinichi Kudo")
    expect(extractCulpritName("The murderer is revealed to be Kogoro Mouri.")).toBe("Kogoro Mouri")
  })

  it("returns null when the text never names a culprit", () => {
    expect(extractCulpritName("The episode ends with the Detective Boys going home.")).toBe(null)
  })

  it("keeps the whole text, only reordered", () => {
    const ordered = prioritizeResolution(DCW_RESOLUTION)
    expect(ordered).toContain("the murder weapon is still missing")
    expect(ordered).toContain("screaming his innocence")
  })
})

/**
 * These two questions were answered wrongly in production: the impostor one
 * named Ep 219 instead of "Murderer, Shinichi Kudo" (Ep 521), and the APTX one
 * reached the model with no APTX context at all because the tokenizer spent its
 * whole keyword budget on Tagalog filler.
 */
describe("Tagalog questions", () => {
  const IMPOSTOR =
    "Hi ano pong episode yung kung saan si shinichi yung naging kriminal? may nag disguise as shinichi at nag paretoke sya para makagawa ng mga krimen at isisi kay shinichi"
  const APTX =
    "GOOD DAY PO. Tanong ko lang po sana kung may list po kayo ng episodes kung sino sino po ang mga napaliit ng APTX-4869. Maraming salamat po."

  it("keeps the subject of the question as a keyword", () => {
    const keywords = tokenize(APTX)
    expect(keywords).toContain("aptx")
    expect(keywords).toContain("napaliit")
    // Filler must never crowd the real subject out of the budget.
    expect(keywords).not.toContain("maraming")
    expect(keywords).not.toContain("salamat")
    expect(keywords).not.toContain("tanong")
  })

  it("drops Tagalog function words from the impostor question", () => {
    const keywords = tokenize(IMPOSTOR)
    expect(keywords).toContain("shinichi")
    expect(keywords).toContain("kriminal")
    expect(keywords).toContain("isisi")
    expect(keywords).not.toContain("yung")
    expect(keywords).not.toContain("makagawa")
  })

  it("translates Tagalog content words, including affixed forms", () => {
    expect(translateTerms(["kriminal"])).toContain("murderer")
    expect(translateTerms(["krimen"])).toContain("crime")
    expect(translateTerms(["nagparetoke"])).toContain("surgery")
    expect(translateTerms(["isisi"])).toContain("frame")
    expect(translateTerms(["napaliit"])).toContain("shrink")
    expect(translateTerms(["saksak"])).toContain("stabbing")
    expect(translateTerms(["lasong"])).toContain("poisoning")
    // Nothing to add for an English question.
    expect(translateTerms(["haibara", "debut"])).toEqual([])
  })

  it("searches the translated terms as their own recall group", () => {
    const groups = searchTermGroups(tokenize(IMPOSTOR))
    const flat = groups.map((g) => g.join(" "))
    expect(flat.some((g) => g.includes("murderer"))).toBe(true)
    // The user's own words are still tried first.
    expect(groups[0]).toEqual(["shinichi", "kriminal"])
  })

  it("scores translated terms, so the right episode outranks a lookalike", () => {
    const terms = rankingTerms(tokenize(IMPOSTOR))
    const correct = scoreEntry(
      { title: "Murderer, Shinichi Kudo", dcw_title: "Murderer, Shinichi Kudo", episode_number: 521 },
      terms
    )
    const lookalike = scoreEntry(
      {
        title: "The Gathering of the Detectives! Shinichi Kudo vs. Kaitou Kid",
        episode_number: 219,
      },
      terms
    )
    const movie = scoreEntry({ title: "Detective Conan Movie 07: Crossroad in the Ancient Capital" }, terms)

    expect(correct).toBeGreaterThan(lookalike)
    expect(correct).toBeGreaterThan(movie)
  })

  it("accepts the English page title for a Tagalog question", () => {
    expect(isRelevantTitle("Murderer, Shinichi Kudo", searchTerms(tokenize(IMPOSTOR)))).toBe(true)
    expect(isRelevantTitle("APTX 4869", searchTerms(tokenize(APTX)))).toBe(true)
  })

  it("recognises a culprit question asked in Tagalog", () => {
    expect(wantsCulprit(IMPOSTOR)).toBe(true)
    expect(wantsCulprit("Sino po ang kriminal sa episode na iyon?")).toBe(true)
    expect(wantsCulprit("Sino po si Conan?")).toBe(false)
  })

  it("recognises a crime-method list asked in Tagalog", () => {
    expect(matchCrimeMethod("pwede po ba makita ang mga episode na may saksak?")).toEqual({
      kind: "cause",
      slug: "stabbing",
      label: "Stabbing",
    })
    expect(prefersList("pwede po ba makita ang mga episode na may saksak?")).toBe(true)
    // The APTX question is a list request too, but not a crime-method one.
    expect(prefersList(APTX)).toBe(true)
    expect(matchCrimeMethod(APTX)).toBe(null)
  })
})
