import { describe, expect, it } from "vitest"
import { buildSourcesFooter, buildSystemPrompt, stripSourcesFooter } from "@/lib/chat/prompt"
import { STORY_ARCS } from "@/lib/arcs-guide"
import type { ChatContext } from "@/lib/chat/search"

const EMPTY_CONTEXT = {
  episodes: [],
  cases: [],
  dcwWiki: [],
} as ChatContext

const EMPTY_ARGS = {
  context: EMPTY_CONTEXT,
  displayName: null,
  isSignedIn: false,
}

describe("buildSystemPrompt — scope & hard boundaries", () => {
  it("keeps the DCPH Bot identity", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toContain("You are DCPH Bot")
  })

  it("declares a hard scope section", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toMatch(/Scope & Hard Boundaries/i)
  })

  it("requires polite refusal of coding and out-of-scope requests", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toMatch(/politely refuse/i)
    expect(prompt).toMatch(/coding or programming/i)
    expect(prompt).toMatch(/never produce code/i)
    expect(prompt).toMatch(/ignore previous instructions/i)
    expect(prompt).toContain("DCPH Bot")
  })

  it("keeps the casual greeting allowance intact", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toContain("Casual Chat & Greetings")
  })

  it("injects the site URL into the scope section", () => {
    const prompt = buildSystemPrompt({
      ...EMPTY_ARGS,
      siteUrl: "https://example.test",
    })
    expect(prompt).toContain("https://example.test")
  })
})

/**
 * These pin the facts the bot repeats verbatim to users. Every expectation here
 * was read off the DCW wiki (Gadgets, Regular movies, and the individual movie
 * pages); if the wiki changes, update the prompt and this file together.
 */
describe("buildSystemPrompt — DCW-sourced series facts", () => {
  const prompt = buildSystemPrompt(EMPTY_ARGS)

  it("lists the arcs by the names the /arcs page actually uses", () => {
    for (const arc of STORY_ARCS) {
      expect(prompt).toContain(arc.title)
    }
  })

  it("names the gadgets as the wiki names them", () => {
    for (const name of [
      "Voice-Changing Bowtie",
      "Power-Enhancing Kick Shoes",
      "Stun-Gun Wristwatch",
      "Turbo Engine Skateboard",
      "Detective Boys Badge",
      "Criminal Tracking Glasses",
      "Elasticity Suspenders",
      "Anywhere Ball Dispensing Belt",
    ]) {
      expect(prompt).toContain(name)
    }
  })

  it("drops the gadget names the wiki does not use", () => {
    for (const stale of [
      "Bowtie Voice Transmitter",
      "Solar-Powered Skateboard",
      "Super Elastic Suspenders",
      "Anywhere Soccer Ball Belt",
    ]) {
      expect(prompt).not.toContain(stale)
    }
  })

  it("gives each main gadget the episode it debuts in", () => {
    for (const debut of ["Ep 3", "Ep 5", "Ep 6", "Ep 12", "Ep 13", "Ep 20", "Ep 309"]) {
      expect(prompt).toContain(debut)
    }
  })

  it("keeps the movie-debut notes the wiki states", () => {    // "This marks the first appearance of Ai Haibara in the Detective Conan movies"
    // (Movie 3), the Black Organization's first film (Movie 5), Subaru Okiya's
    // movie debut (Movie 18), and Rum in the cast of Movie 26.
    expect(prompt).toContain("Movie 3")
    expect(prompt).toContain("The Last Wizard of the Century")
    expect(prompt).toContain("Ai Haibara")
    expect(prompt).toContain("Kaitou Kid")
    expect(prompt).toContain("Countdown to Heaven")
    expect(prompt).toContain("Dimensional Sniper")
    expect(prompt).toContain("Subaru Okiya")
    expect(prompt).toContain("Black Iron Submarine")
    expect(prompt).toContain("Rum")
  })

  it("forbids inventing citations the context does not carry", () => {
    // A live answer appended "Manga Debut: File 082", which no DCW page backs.
    expect(prompt).toMatch(/do not invent citations/i)
    expect(prompt).toMatch(/manga file or chapter numbers/i)
  })
})
/** Minimal tracker row — the prompt only reads the fields it formats. */
function entry(overrides: Record<string, unknown>): ChatContext["episodes"][number] {
  return {
    id: "e1",
    slug: "ep-141",
    title: "The Night Before the Wedding Locked Room Case (Part 1)",
    type: "episode",
    episode_number: 141,
    movie_number: null,
    air_date: "1999-04-19",
    synopsis: null,
    runtime_minutes: 25,
    dcw_title: "The Night Before the Wedding Locked Room Case",
    ...overrides,
  } as unknown as ChatContext["episodes"][number]
}

describe("buildSystemPrompt — listing and resolution context", () => {
  it("renders a crime-method list with its total and the /cases filter link", () => {
    const prompt = buildSystemPrompt({
      ...EMPTY_ARGS,
      context: {
        ...EMPTY_CONTEXT,
        crimeMethod: {
          kind: "cause",
          slug: "stabbing",
          label: "Stabbing",
          total: 193,
          href: "https://dcphtracker.vercel.app/cases?cause=stabbing",
          lines: ["Ep 141 — The Night Before the Wedding Locked Room Case (Part 1) — Stab wound"],
        },
      },
    })

    expect(prompt).toContain("Case files matching this crime method")
    expect(prompt).toContain("Ep 141 — The Night Before the Wedding Locked Room Case (Part 1) — Stab wound")
    expect(prompt).toContain("showing 1 of 193")
    expect(prompt).toContain("https://dcphtracker.vercel.app/cases?cause=stabbing")
  })

  it("renders the DCW resolution for a culprit question", () => {
    const prompt = buildSystemPrompt({
      ...EMPTY_ARGS,
      context: {
        ...EMPTY_CONTEXT,
        resolutions: [
          {
            label: "Ep 141 — The Night Before the Wedding Locked Room Case (Part 1)",
            url: "https://www.detectiveconanworld.com/wiki/The_Night_Before_the_Wedding_Locked_Room_Case",
            text: "The real culprit is revealed to be Kikuhito Morizono.",
          },
        ],
      },
    })

    expect(prompt).toContain("Case resolutions")
    expect(prompt).toContain("Kikuhito Morizono")
  })

  it("renders specials with runtimes and exact tracker totals", () => {
    const prompt = buildSystemPrompt({
      ...EMPTY_ARGS,
      context: {
        ...EMPTY_CONTEXT,
        specials: {
          kind: "two-hour",
          label: "Two-hour specials (85+ minutes)",
          total: 5,
          href: "https://dcphtracker.vercel.app/tracker",
          lines: ["Ep 96 — The Cornered Famous Detective! Two Big Murder Cases — 92 min — 1998-02-23"],
        },
        totals: { entries: 1371, episodes: 1185, movies: 27, specials: 30 },
      },
    })

    expect(prompt).toContain("Two-hour specials (85+ minutes)")
    expect(prompt).toContain("92 min")
    expect(prompt).toContain("Specials and long-format entries")
    expect(prompt).toContain("Tracker entries: 1371")
    expect(prompt).toContain("Movies: 27")
  })

  it("omits the listing sections when retrieval found no list", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).not.toContain("## Case files matching this crime method")
    expect(prompt).not.toContain("## Case resolutions")
    expect(prompt).not.toContain("## Specials and long-format entries")
    expect(prompt).not.toContain("## Tracker totals")
  })
})

describe("buildSystemPrompt — answer rules", () => {
  const prompt = buildSystemPrompt(EMPTY_ARGS)

  it("tells the model the app writes the Sources line, not the model", () => {
    expect(prompt).toMatch(/The app appends a \*\*Sources\*\* line/)
    expect(prompt).toMatch(/Never write one of your own/)
    // The model imitated the footer it saw in history; the rule names the tell.
    expect(prompt).toMatch(/no "tracker:" or "DCW:" labels/)
  })

  it("keeps URLs out of the prose and forbids inventing them", () => {
    expect(prompt).toMatch(/Do not invent, guess, or reconstruct a URL/)
  })

  it("answers culprit questions but does not volunteer spoilers", () => {
    expect(prompt).toMatch(/answer them, and use the "Case resolutions" section/i)
    expect(prompt).toMatch(/Otherwise do not volunteer a culprit/i)
  })

  it("requires lists to be answered with lists plus the filter link", () => {
    expect(prompt).toMatch(/Only name an episode the list actually contains/)
    expect(prompt).toMatch(/state how many the case files hold in total/)
  })

  it("treats the DCW appearances index as the authority for debut questions", () => {
    expect(prompt).toMatch(/that list is the authority/)
    expect(prompt).toMatch(/The first entry is the character's first appearance/)
  })

  it("does not let any framing lift the scope", () => {
    expect(prompt).toMatch(/There is no framing under which DCPH Bot answers outside Detective Conan/)
  })
})

describe("buildSourcesFooter", () => {
  const siteUrl = "https://dcphtracker.vercel.app"

  it("sources only the entries the answer itself named, on one line", () => {
    const context: ChatContext = {
      ...EMPTY_CONTEXT,
      episodes: [
        entry({}),
        entry({
          id: "e2",
          slug: "ep-521",
          episode_number: 521,
          title: "Murderer, Shinichi Kudo",
          dcw_title: "Murderer, Shinichi Kudo",
        }),
      ],
      dcwWiki: [
        {
          title: "Shinichi Kudo",
          url: "https://www.detectiveconanworld.com/wiki/Shinichi_Kudo",
          extract: "…",
          source: "dcw",
        },
      ],
    }

    const footer = buildSourcesFooter(
      context,
      siteUrl,
      "Ang hinahanap mo ay **[Ep 521] | Murderer, Shinichi Kudo**. Ito ang imbostor."
    )

    expect(footer).toContain("**Sources**")
    expect(footer).toContain("[Ep 521](https://dcphtracker.vercel.app/tracker/ep-521)")
    expect(footer).toContain(
      "[Murderer, Shinichi Kudo (DCW)](https://www.detectiveconanworld.com/wiki/Murderer%2C_Shinichi_Kudo)"
    )
    // One line only, and neither the unmentioned row nor the character page.
    expect(footer.split("\n")).toHaveLength(3)
    expect(footer).not.toContain("ep-141")
    // The character page is not a source for an answer about an episode.
    expect(footer).not.toContain("wiki/Shinichi_Kudo")
  })

  it("points at the wiki page the answer's own words name", () => {
    const context: ChatContext = {
      ...EMPTY_CONTEXT,
      episodes: [entry({})],
      dcwWiki: [
        {
          title: "APTX 4869",
          url: "https://www.detectiveconanworld.com/wiki/APTX_4869",
          extract: "…",
          source: "dcw",
        },
      ],
    }

    const footer = buildSourcesFooter(context, siteUrl, "Sina Shinichi at Shiho ang napaliit ng APTX 4869.")

    expect(footer).toContain("[APTX 4869 (DCW)](https://www.detectiveconanworld.com/wiki/APTX_4869)")
    expect(footer).not.toContain("/tracker/")
  })

  it("falls back to the best page when the answer matches no title", () => {
    const context: ChatContext = {
      ...EMPTY_CONTEXT,
      dcwWiki: [
        {
          title: "Ai Haibara",
          url: "https://www.detectiveconanworld.com/wiki/Ai_Haibara",
          extract: "…",
          source: "dcw",
        },
      ],
    }

    expect(buildSourcesFooter(context, siteUrl, "Oo, siya ang gumawa ng lason.")).toContain(
      "[Ai Haibara (DCW)]"
    )
  })

  it("never lists more than four links", () => {
    const episodes = [141, 142, 143, 144, 145].map((n) =>
      entry({
        id: `e${n}`,
        slug: `ep-${n}`,
        episode_number: n,
        title: `Case ${n}`,
        dcw_title: `Case ${n}`,
      })
    )
    const footer = buildSourcesFooter(
      { ...EMPTY_CONTEXT, episodes },
      siteUrl,
      "Tingnan ang Ep 141, Ep 142, Ep 143, Ep 144 at Ep 145."
    )

    expect(footer.match(/\]\(https?:\/\//g)).toHaveLength(4)
    expect(footer.split("\n")).toHaveLength(3)
  })

  it("points a list answer at the filter page instead of the incidental entries", () => {
    const footer = buildSourcesFooter(
      {
        ...EMPTY_CONTEXT,
        episodes: [entry({}), entry({ id: "e2", slug: "ep-349", episode_number: 349, title: "Unrelated" })],
        crimeMethod: {
          kind: "cause",
          slug: "stabbing",
          label: "Stabbing",
          total: 159,
          href: "https://dcphtracker.vercel.app/cases?cause=stabbing",
          lines: ["Ep 3 — An Idol's Locked Room Murder Case — Stab wound"],
        },
      },
      siteUrl,
      "Narito ang mga episode na may saksak."
    )

    expect(footer).toContain("[Stabbing case files (159)](https://dcphtracker.vercel.app/cases?cause=stabbing)")
    expect(footer).not.toContain("ep-141")
    expect(footer).not.toContain("ep-349")
  })

  it("keeps the filter page even when the list answer names episodes", () => {
    const footer = buildSourcesFooter(
      {
        ...EMPTY_CONTEXT,
        episodes: [entry({})],
        crimeMethod: {
          kind: "cause",
          slug: "stabbing",
          label: "Stabbing",
          total: 159,
          href: "https://dcphtracker.vercel.app/cases?cause=stabbing",
          lines: [],
        },
      },
      siteUrl,
      "Kasama rito ang Ep 141, at marami pang iba."
    )

    expect(footer).toContain("[Stabbing case files (159)]")
    expect(footer).toContain("[Ep 141](https://dcphtracker.vercel.app/tracker/ep-141)")
  })

  it("names Wikipedia only when DCW had nothing", () => {
    const wikipedia = {
      title: "Detective Conan",
      url: "https://en.wikipedia.org/wiki/Detective_Conan",
      extract: "…",
      source: "wikipedia" as const,
    }
    const dcw = {
      title: "Ai Haibara",
      url: "https://www.detectiveconanworld.com/wiki/Ai_Haibara",
      extract: "…",
      source: "dcw" as const,
    }

    const withDcw = buildSourcesFooter({ ...EMPTY_CONTEXT, dcwWiki: [wikipedia, dcw] }, siteUrl, "Si Ai Haibara.")
    expect(withDcw).not.toContain("Wikipedia")

    const fallbackOnly = buildSourcesFooter({ ...EMPTY_CONTEXT, dcwWiki: [wikipedia] }, siteUrl)
    expect(fallbackOnly).toContain("[Detective Conan (Wikipedia)](https://en.wikipedia.org/wiki/Detective_Conan)")
  })

  it("returns an empty string when nothing was retrieved", () => {
    expect(buildSourcesFooter(EMPTY_CONTEXT, siteUrl, "Hello!")).toBe("")
  })
})

describe("stripSourcesFooter", () => {
  it("removes the appended footer, keeping the answer", () => {
    const content =
      "Ang sagot ay **[Ep 521]**.\n\n**Sources** [Ep 521](https://x/tracker/ep-521)"
    expect(stripSourcesFooter(content)).toBe("Ang sagot ay **[Ep 521]**.")
  })

  it("leaves an answer without a footer alone", () => {
    expect(stripSourcesFooter("Hello po!")).toBe("Hello po!")
  })
})
