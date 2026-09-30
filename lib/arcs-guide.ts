/**
 * Detective Conan Story Guide data
 *
 * A curated, self-contained guide to the main plot ("Black Organization")
 * arcs from Season 1 to the latest era, plus recurring story threads and a
 * newcomer watch guide. Episode ranges follow the original Japanese anime
 * numbering. Because the anime is 1100+ episodes and still ongoing, this
 * guide focuses on the canonical main-plot arcs rather than every episode.
 *
 * Sources: Case Closed / Detective Conan Wiki arc timeline.
 */

export interface ArcCharacter {
  name: string
  role: string
}

export interface ArcHighlight {
  /** e.g. "188-193" or "345" */
  episodes: string
  title: string
  note: string
}

export interface StoryArc {
  slug: string
  /** Sequence within the main plot (1-based) */
  order: number
  title: string
  /** Short label for the era, shown as a chip */
  era: string
  episodeStart: number
  /** null = still ongoing */
  episodeEnd: number | null
  /** Rough manga chapter range */
  mangaRange: string
  years: string
  status: "complete" | "ongoing"
  /** One-line hook */
  tagline: string
  /** Full description */
  summary: string
  keyCharacters: ArcCharacter[]
  highlights: ArcHighlight[]
}

export const SERIES_PREMISE = {
  title: "One Truth Prevails",
  intro:
    "Shinichi Kudo, a brilliant high-school detective, is force-fed an experimental poison by two men in black. Instead of killing him, APTX 4869 shrinks him back into a child.",
  body: "As Conan Edogawa, he moves in with Ran Mouri and her detective father Kogoro, solving cases from the shadows while he hunts the Black Organization for a way back to his real body.",
}

export const HOW_IT_WORKS = [
  {
    title: "Case-of-the-week + a hidden main plot",
    body: "Most episodes are standalone mysteries. Between them runs the main plot: Conan's war with the Black Organization. This guide tracks exactly that.",
  },
  {
    title: "Canon vs. filler",
    body: "Canon episodes adapt Gosho Aoyama's manga and move the story forward. Filler is anime-original. If you only want the main story, most filler is safe to skip.",
  },
  {
    title: "Arcs are named after the antagonist",
    body: "The main plot is divided into eras, each named for the Organization member in focus: Sherry, Vermouth, Kir, Bourbon, Rum, as the mystery escalates toward the boss.",
  },
  {
    title: "Recurring characters matter",
    body: "Watch for Kaitou Kid, Heiji Hattori, the FBI, and the Shinichi–Ran romance — their threads pay off across hundreds of episodes.",
  },
]

export const STORY_ARCS: StoryArc[] = [
  {
    slug: "conan-arc",
    order: 1,
    title: "Conan Arc",
    era: "The Beginning",
    episodeStart: 1,
    episodeEnd: 128,
    mangaRange: "Vol. 1-17 (Ch. 1-175)",
    years: "1996-1998",
    status: "complete",
    tagline: "A shrunken detective builds a new life and a secret mission.",
    summary:
      "The foundation. Shinichi becomes Conan, moves in with the Mouris, and perfects 'Sleeping Kogoro.' Professor Agasa builds his gadgets; the Detective Boys form. Standalone cases dominate, but Heiji Hattori and Kaitou Kid debut — and the Organization lurks at the edges.",
    keyCharacters: [
      { name: "Conan Edogawa / Shinichi Kudo", role: "The shrunken detective" },
      { name: "Ran Mouri", role: "Childhood friend, unaware of the truth" },
      { name: "Kogoro Mouri", role: "The 'sleeping' detective" },
      { name: "Professor Agasa", role: "Inventor of Conan's gadgets" },
      { name: "The Detective Boys", role: "Ayumi, Genta, Mitsuhiko" },
    ],
    highlights: [
      { episodes: "1", title: "The Roller Coaster Murder Case", note: "The origin: Shinichi is poisoned and becomes Conan." },
      { episodes: "11", title: "The Moonlight Sonata Murder Case", note: "An iconic, chilling early mystery on a remote island." },
      { episodes: "48-49", title: "The Diplomat Murder Case", note: "Debut of Osaka's high-school detective, Heiji Hattori." },
      { episodes: "76", title: "Kaitou Kid's debut", note: "The gentleman phantom thief enters the series." },
    ],
  },
  {
    slug: "sherry-arc",
    order: 2,
    title: "Sherry Arc",
    era: "Enter Sherry",
    episodeStart: 129,
    episodeEnd: 178,
    mangaRange: "Vol. 18-24 (Ch. 176-242)",
    years: "1998-2000",
    status: "complete",
    tagline: "A defector from the Organization joins Conan's side.",
    summary:
      "The main plot ignites. Shiho Miyano — code-named Sherry, creator of APTX 4869 — escapes the syndicate and shrinks, becoming Ai Haibara and Conan's first insider ally. It climaxes with the first face-off against Gin and Vodka.",
    keyCharacters: [
      { name: "Ai Haibara / Shiho Miyano (Sherry)", role: "Ex-Organization scientist, now Conan's ally" },
      { name: "Gin", role: "Ruthless senior Organization operative" },
      { name: "Vodka", role: "Gin's partner" },
    ],
    highlights: [
      { episodes: "129", title: "The Girl from the Black Organization", note: "Sherry / Ai Haibara is introduced." },
      { episodes: "176-178", title: "Reunion with the Black Organization", note: "The first major confrontation with Gin and Vodka." },
    ],
  },
  {
    slug: "vermouth-arc",
    order: 3,
    title: "Vermouth Arc",
    era: "The Silver Bullet",
    episodeStart: 179,
    episodeEnd: 345,
    mangaRange: "Vol. 25-42 (Ch. 243-434)",
    years: "2000-2003",
    status: "complete",
    tagline: "A master of disguise who somehow knows Conan's secret.",
    summary:
      "The emotional peak. The FBI joins the war, and Vermouth — a disguise artist who refuses to expose Conan and Haibara — takes center stage. Landmarks include 'The Desperate Revival' and her New York past, ending in a full-moon showdown.",
    keyCharacters: [
      { name: "Vermouth", role: "Master of disguise; calls Conan her 'Silver Bullet'" },
      { name: "Jodie Starling", role: "FBI agent hunting the Organization" },
      { name: "Shuichi Akai", role: "FBI sniper and Gin's rival" },
    ],
    highlights: [
      { episodes: "188-193", title: "The Desperate Revival", note: "Shinichi temporarily returns to his real body." },
      { episodes: "286-288", title: "Shinichi Kudo's New York Case", note: "The origin of Vermouth's obsession with Ran and Shinichi." },
      { episodes: "345", title: "Full-Moon Night's Duel", note: "A head-to-head match against the Organization." },
    ],
  },
  {
    slug: "cell-phone-arc",
    order: 4,
    title: "Cell Phone Arc",
    era: "A Number to the Boss",
    episodeStart: 346,
    episodeEnd: 424,
    mangaRange: "Vol. 43-50 (Ch. 435-498)",
    years: "2004-2006",
    status: "complete",
    tagline: "Conan gets dangerously close to the boss himself.",
    summary:
      "Short but pivotal. Conan finds a way to reach the Organization's boss — Haibara warns it is Pandora's Box. Clues mount, tension builds, and new deadly members wait in the wings.",
    keyCharacters: [
      { name: "Conan Edogawa", role: "Closing in on the boss" },
      { name: "Ai Haibara", role: "Warns of the danger ahead" },
      { name: "The Boss", role: "Identity still hidden" },
    ],
    highlights: [
      { episodes: "394", title: "The boss's number", note: "Conan deduces the boss's contact and the risk of using it." },
      { episodes: "425", title: "Black Impact!", note: "Bridge into the Kir Arc as new members appear." },
    ],
  },
  {
    slug: "kir-arc",
    order: 5,
    title: "Kir Arc",
    era: "Clash of Red and Black",
    episodeStart: 425,
    episodeEnd: 508,
    mangaRange: "Vol. 51-59 (Ch. 499-621)",
    years: "2006-2008",
    status: "complete",
    tagline: "A three-way war between the FBI, the CIA, and the Organization.",
    summary:
      "The scope explodes: snipers Chianti and Korn arrive, and the captured member Kir becomes a high-stakes double-agent gambit. It detonates in 'The Clash of Red and Black' — Akai's apparent death and a chess match pitting Conan and the FBI against Gin.",
    keyCharacters: [
      { name: "Kir / Hidemi Hondou", role: "Captured member turned FBI double agent" },
      { name: "Shuichi Akai", role: "The FBI's greatest weapon against the Organization" },
      { name: "Chianti & Korn", role: "Organization sniper duo" },
    ],
    highlights: [
      { episodes: "425", title: "Black Impact!", note: "Chianti, Korn, and Kir are introduced." },
      { episodes: "491-504", title: "The Clash of Red and Black", note: "A landmark saga and a devastating turning point for the FBI." },
    ],
  },
  {
    slug: "bourbon-arc",
    order: 6,
    title: "Bourbon Arc",
    era: "The Three Suspects",
    episodeStart: 509,
    episodeEnd: 783,
    mangaRange: "Vol. 60-85 (Ch. 622-898)",
    years: "2008-2015",
    status: "complete",
    tagline: "Who is Bourbon? Three newcomers, one hidden agent.",
    summary:
      "The longest era — a slow-burn mystery of identity. Bourbon hunts Sherry and the truth about Akai. Three newcomers (Sera, Okiya, Amuro) and the question of which is Bourbon drive the arc, resolved in a double reveal aboard the mystery train and 'The Scarlet Series.'",
    keyCharacters: [
      { name: "Tooru Amuro / Bourbon", role: "Triple agent: Organization, police, and PSB" },
      { name: "Subaru Okiya", role: "A calm lodger at the Kudo house" },
      { name: "Masumi Sera", role: "A high-school detective with secrets" },
    ],
    highlights: [
      { episodes: "701-704", title: "The Scarlet Return (Mystery Train)", note: "Bourbon and Vermouth strike; a major reveal." },
      { episodes: "779-783", title: "The Scarlet Series", note: "Akai's return and Bourbon's true identity confirmed." },
    ],
  },
  {
    slug: "rum-arc",
    order: 7,
    title: "Rum Arc: Scarlet Series",
    era: "The Boss's Right Hand",
    episodeStart: 784,
    episodeEnd: null,
    mangaRange: "Vol. 86-present (Ch. 899-present)",
    years: "2015-present",
    status: "ongoing",
    tagline: "The hunt for the No. 2 and the boss is finally named.",
    summary:
      "The current era. Rum — the Organization's No. 2 — has three suspects: Kuroda, Wakasa, Wakita. The Koji Haneda murder resurfaces, and the boss is finally named: Renya Karasuma. With Akai allied with Conan, the war heads for its endgame.",
    keyCharacters: [
      { name: "Rum", role: "The Organization's elusive number two" },
      { name: "Renya Karasuma", role: "The boss, finally named" },
      { name: "Shuichi Akai", role: "Back in the field, allied with Conan" },
    ],
    highlights: [
      { episodes: "784+", title: "The Scarlet era begins", note: "The search for Rum's true identity opens." },
      { episodes: "1077-1079", title: "The Black Organization's Scheme", note: "A brutal FBI-vs-Organization clash; Rum's identity in focus." },
    ],
  },
]

export interface RecurringThread {
  slug: string
  title: string
  tagline: string
  description: string
  starterEpisodes: string
}

/**
 * DB-sync arc rows for the `arcs` table (supabase/seed.sql + scripts/populate-arcs.mjs).
 * Derived from STORY_ARCS; episodeEnd null resolves to the latest episode (1209).
 */
export interface ArcDbRow {
  slug: string
  title: string
  description: string
  start_episode: number
  end_episode: number
}

export const ARC_DB_ROWS: ArcDbRow[] = STORY_ARCS.map((arc) => ({
  slug: arc.slug,
  title: arc.title,
  description: arc.tagline,
  start_episode: arc.episodeStart,
  end_episode: arc.episodeEnd ?? 1209,
}))

export const RECURRING_THREADS: RecurringThread[] = [
  {
    slug: "kaitou-kid",
    title: "Kaitou Kid",
    tagline: "The phantom thief and Conan's playful rival",
    description:
      "An international thief who announces his heists in advance and never harms anyone. His duels with Conan are fan-favorites, tied to the Magic Kaito spin-off.",
    starterEpisodes: "Ep 76, 219, 356",
  },
  {
    slug: "heiji-hattori",
    title: "Heiji Hattori",
    tagline: "The detective of the West",
    description:
      "Osaka's high-school detective — one of the few who knows Conan's secret, and his closest rival-turned-partner.",
    starterEpisodes: "Ep 48-49, 118-119",
  },
  {
    slug: "fbi-vs-bo",
    title: "FBI vs. the Organization",
    tagline: "The international war in the shadows",
    description:
      "A covert war against the syndicate, powered by Jodie, Akai, Camel, and Kir. Their operations carry the Vermouth, Kir, and Bourbon arcs.",
    starterEpisodes: "Ep 230-231, 491-504",
  },
  {
    slug: "shinichi-and-ran",
    title: "Shinichi & Ran",
    tagline: "The heart of the series",
    description:
      "The slow-burn canon romance — missed calls, near-misses, and a confession in London.",
    starterEpisodes: "Ep 188-193, 621-623",
  },
]

export interface WatchStep {
  step: number
  title: string
  detail: string
}

export const WATCH_GUIDE: WatchStep[] = [
  {
    step: 1,
    title: "Start with the essentials (Ep 1-5)",
    detail:
      "The first five episodes set the premise, cast, and Conan's method. After that, don't sweat the filler.",
  },
  {
    step: 2,
    title: "Follow the main plot arcs",
    detail:
      "Use the arcs above as a spine. Core story only? Prioritize the Sherry, Vermouth, Kir, Bourbon, and Rum eras.",
  },
  {
    step: 3,
    title: "Add recurring-character episodes",
    detail:
      "Add Kaitou Kid, Heiji, and FBI episodes — canon, rewarding, and often tied into the main plot.",
  },
  {
    step: 4,
    title: "Enjoy standalone cases at your pace",
    detail:
      "The standalone cases are the soul of the show. Watch as many as you like between main-plot arcs.",
  },
]

export function getArcBySlug(slug: string): StoryArc | undefined {
  return STORY_ARCS.find((a) => a.slug === slug)
}

/** Resolve which guide arc an episode belongs to by its episode number. */
export function getArcSlugForEpisode(episode?: number | null): string | null {
  if (episode == null) return null
  const arc = STORY_ARCS.find(
    (a) =>
      episode >= a.episodeStart &&
      (a.episodeEnd == null || episode <= a.episodeEnd)
  )
  return arc?.slug ?? null
}

export function getAdjacentArcs(slug: string): {
  prev: StoryArc | null
  next: StoryArc | null
} {
  const i = STORY_ARCS.findIndex((a) => a.slug === slug)
  return {
    prev: i > 0 ? STORY_ARCS[i - 1] : null,
    next: i >= 0 && i < STORY_ARCS.length - 1 ? STORY_ARCS[i + 1] : null,
  }
}

export function formatEpisodeRange(arc: StoryArc): string {
  return arc.episodeEnd === null
    ? `Ep ${arc.episodeStart}+`
    : `Ep ${arc.episodeStart}-${arc.episodeEnd}`
}
