/**
 * The TypeScript half of the retrieval corpus: the curated guides, projected
 * into retrievable documents.
 *
 * The guides (`characters-guide`, `arcs-guide`, `canon-guide`, `movies-guide`)
 * are already the site's source of truth, so the corpus derives its documents
 * from them rather than restating the data in a second place. Every builder
 * takes its input as a parameter defaulting to the imported array: that is what
 * lets a test prove the builder is a pure function of its argument, and what
 * lets the eval build a corpus without touching the real data.
 *
 * IDS ARE STABLE ACROSS REBUILDS (`character:<id>`, `arc:<slug>`, `movie:<n>`,
 * ...) because the ingestion keys its `content_hash` comparison on them, and
 * because they are the citation ids the bot hands back to the user.
 */

import {
  CHARACTERS,
  RELATIONSHIPS,
  RELATIONSHIP_META,
  getSpoilerMeta,
  type Character,
  type Relationship,
} from "@/lib/characters-guide"
import {
  RECURRING_THREADS,
  STORY_ARCS,
  formatEpisodeRange,
  type RecurringThread,
  type StoryArc,
} from "@/lib/arcs-guide"
import { MAINLINE_MOVIES, type MainlineMovie } from "@/lib/movies-guide"
import {
  CANON_GUIDE_SOURCE,
  CANON_TYPES,
  CANON_TYPE_DESCRIPTIONS,
  CANON_TYPE_LABELS,
  MAX_EPISODE,
  canonRangeTotal,
} from "@/lib/canon-guide"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

/** The builders' common output. An alias rather than an empty interface: a seed *is* a document. */
export type CorpusDocumentSeed = CorpusDocument

// Re-exported so a caller can take the builders and the document type from the
// one module it already imports.
export type { CorpusDocument }

/** Joins the non-empty lines of a document body. */
function joinLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n")
}

/**
 * Lowercases each alias and adds its tokens of length >= 3, so "Shiho Miyano"
 * also matches a query that only ever says "shiho".
 */
function lowerAliases(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const lower = value.toLowerCase()
    for (const candidate of [lower, ...lower.split(/\s+/).filter((token) => token.length >= 3)]) {
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      out.push(candidate)
    }
  }

  return out
}

type SpoilerMetaValue = ReturnType<typeof getSpoilerMeta>

/** "Episode 129", "Movie 1", or the data's own pre-rendered label. */
function appearanceLabel(debut: NonNullable<SpoilerMetaValue>["debut"]): string | null {
  if (!debut) return null
  if (debut.label) return debut.label
  if (debut.episode != null) return `Episode ${debut.episode}`
  if (debut.movie != null) return `Movie ${debut.movie}`
  return null
}

export interface Gadget {
  name: string
  aliases: readonly string[]
  description: string
}

/**
 * The eight gadgets the system prompt used to hardcode (Plan 4 deletes that
 * block), so the corpus text is what the bot answers from.
 */
export const GADGETS: readonly Gadget[] = [
  {
    name: "Voice-Changing Bowtie",
    aliases: ["Bowtie Voice Transmitter", "Voice Changer Bowtie"],
    description:
      "A bowtie transmitter that modulates Conan's voice to imitate anyone, most famously Kogoro during the Sleeping Kogoro deduction.",
  },
  {
    name: "Stun-Gun Wristwatch",
    aliases: ["Tranquilizer Watch", "Stun Watch"],
    description: "A wristwatch that fires a tranquilizer dart to put Kogoro or a suspect to sleep.",
  },
  {
    name: "Power-Enhancing Kick Shoes",
    aliases: ["Kick Shoes", "Power Kick Shoes"],
    description:
      "Shoes that electrically stimulate the foot muscles, letting a kick land with devastating power.",
  },
  {
    name: "Solar-Powered Skateboard",
    aliases: ["Solar Skateboard", "Turbo Skateboard"],
    description:
      "A skateboard with high-speed solar-powered propulsion and a battery that stores the charge for cloudy days.",
  },
  {
    name: "Criminal Tracking Glasses",
    aliases: ["Tracking Glasses", "Radar Glasses"],
    description:
      "Glasses that display the direction and distance to a radar sticker and offer telescopic zoom.",
  },
  {
    name: "Super Elastic Suspenders",
    aliases: ["Elastic Suspenders"],
    description: "High-tensile elastic straps that lift heavy objects or sling Conan across a gap.",
  },
  {
    name: "Detective Boys Badge",
    aliases: ["Detective Badge", "Detective Boys Badges"],
    description:
      "A compact two-way walkie-talkie and signal beacon that keeps the Detective Boys in touch.",
  },
  {
    name: "Anywhere Soccer Ball Belt",
    aliases: ["Soccer Ball Belt"],
    description: "A belt buckle that inflates a soccer ball on demand.",
  },
]

export function buildCharacterDocs(characters: Character[] = CHARACTERS): CorpusDocument[] {
  return characters.map((character): CorpusDocument => {
    const meta = getSpoilerMeta(character.id)
    const debut = appearanceLabel(meta?.debut)
    const reveal = appearanceLabel(meta?.reveal)

    return {
      id: `character:${character.id}`,
      source: "characters",
      title: character.name,
      body: joinLines([
        `Role: ${character.role}`,
        `Affiliation: ${character.affiliation}`,
        character.bio ? `Bio: ${character.bio}` : null,
        character.aliases?.length ? `Also known as: ${character.aliases.join(", ")}` : null,
        debut ? `First appearance: ${debut}` : null,
        reveal ? `Revealed in: ${reveal}` : null,
      ]),
      url: "/characters",
      metadata: {
        role: character.role,
        affiliation: character.affiliation,
        debut_episode: meta?.debut?.episode ?? null,
        debut_movie: meta?.debut?.movie ?? null,
        reveal_episode: meta?.reveal?.episode ?? null,
        spoiler: meta?.spoiler,
      },
      aliases: lowerAliases(character.aliases ?? []),
      // episodeNumber is deliberately unset: this is not that episode.
    }
  })
}

export function buildRelationshipDocs(
  relationships: Relationship[] = RELATIONSHIPS,
  characters: Character[] = CHARACTERS
): CorpusDocument[] {
  const byId = new Map(characters.map((character) => [character.id, character]))
  const docs: CorpusDocument[] = []

  for (const relationship of relationships) {
    const source = byId.get(relationship.source)
    const target = byId.get(relationship.target)
    // A dangling edge would publish "undefined and undefined". The curated data
    // has none, but a fixture (or a half-applied cast edit) can.
    if (!source || !target) continue

    docs.push({
      id: `relationship:${relationship.id}`,
      source: "relationships",
      title: `${source.name} and ${target.name}`,
      body: joinLines([RELATIONSHIP_META[relationship.type].label, relationship.detail]),
      url: "/characters",
      metadata: {},
      aliases: [],
    })
  }

  return docs
}

/**
 * An arc's episode range is a real alternate name for it ("the 179-345
 * stretch"), and R1's alias branch is the only rule that can match a number a
 * document does not own as its own `episode_number` -- an arc is not an episode.
 * Without these, "which arc covers episodes 179 to 345" is decided by the id
 * tie-break between seven arcs that all matched the word "arc".
 */
function arcAliases(arc: StoryArc): string[] {
  return [arc.episodeStart, arc.episodeEnd]
    .filter((value): value is number => value !== null)
    .map((value) => String(value))
}

export function buildArcDocs(arcs: StoryArc[] = STORY_ARCS): CorpusDocument[] {
  return arcs.map((arc): CorpusDocument => ({
    id: `arc:${arc.slug}`,
    source: "arcs",
    title: arc.title,
    aliases: arcAliases(arc),
    body: joinLines([
      arc.tagline,
      `${arc.era} — ${arc.years} — ${arc.status}`,
      formatEpisodeRange(arc),
      arc.summary,
      "Key characters:",
      ...arc.keyCharacters.map((entry) => `${entry.name} — ${entry.role}`),
      "Highlights:",
      ...arc.highlights.map((entry) => `${entry.episodes} — ${entry.title}: ${entry.note}`),
    ]),
    url: `/arcs/${arc.slug}`,
    metadata: {
      arc_slug: arc.slug,
      episode_start: arc.episodeStart,
      // `episode_end` is a number, and the ongoing arc's null means "no end
      // yet" — the body's "Ep 784+" carries that, so the key stays absent.
      episode_end: arc.episodeEnd ?? undefined,
      years: arc.years,
      status: arc.status,
    },
  }))
}

export function buildThreadDocs(threads: RecurringThread[] = RECURRING_THREADS): CorpusDocument[] {
  return threads.map((thread): CorpusDocument => ({
    id: `thread:${thread.slug}`,
    source: "threads",
    title: thread.title,
    body: joinLines([
      thread.tagline,
      thread.description,
      `Starter episodes: ${thread.starterEpisodes}`,
    ]),
    url: "/arcs",
    metadata: { kind: "thread" },
  }))
}

export function buildCanonDoc(): CorpusDocument[] {
  const byType = Object.values(CANON_TYPES).map((type) => {
    const count = canonRangeTotal(type)
    return `${CANON_TYPE_LABELS[type]} (${type}): ${CANON_TYPE_DESCRIPTIONS[type]} Episodes: ${count}.`
  })

  return [
    {
      id: "guide:canon",
      source: "canon",
      title: "Canon, filler and anime-original episodes",
      body: joinLines([
        ...byType,
        `Tracked range: episodes 1-${MAX_EPISODE}.`,
        `Classification source: ${CANON_GUIDE_SOURCE}`,
      ]),
      url: "/tracker",
      metadata: { kind: "canon_guide", max_episode: MAX_EPISODE },
    },
  ]
}

export function buildMovieDocs(movies: MainlineMovie[] = MAINLINE_MOVIES): CorpusDocument[] {
  return movies.map((movie): CorpusDocument => ({
    id: `movie:${movie.number}`,
    source: "movies",
    title: movie.english,
    body: `Movie ${movie.number} (${movie.year}): ${movie.english} / ${movie.japanese}.`,
    url: "/tracker",
    metadata: { movie_number: movie.number, japanese: movie.japanese, year: movie.year },
    movieNumber: movie.number,
    // The Japanese title is a real alternate name. Its tokens are expanded, but
    // "movie <n>" stays a phrase: a bare "movie" token would let any film match
    // a question that merely mentions movies.
    aliases: [...lowerAliases([movie.japanese]), `movie ${movie.number}`],
  }))
}

export function buildGadgetDocs(gadgets: readonly Gadget[] = GADGETS): CorpusDocument[] {
  return gadgets.map((gadget, index): CorpusDocument => ({
    id: `gadget:${index + 1}`,
    source: "gadgets",
    title: gadget.name,
    body: joinLines([
      gadget.name,
      gadget.aliases.length > 0 ? `Also known as: ${gadget.aliases.join(", ")}` : null,
      gadget.description,
    ]),
    url: null,
    metadata: {},
    aliases: lowerAliases(gadget.aliases),
  }))
}
