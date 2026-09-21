/**
 * Character lookup against the curated cast, not against a model's memory.
 *
 * "Who is Ai Haibara?" has a fixed answer in lib/characters-guide.ts, including
 * the id the corpus documents are keyed by. Resolving it here means the bot
 * quotes real data instead of inventing a biography and a relationship list.
 */
import { normalizeText } from "@/lib/chat/query"
import {
  CHARACTERS,
  RELATIONSHIPS,
  RELATIONSHIP_META,
  getSpoilerMeta,
  type Character,
  type Relationship,
  type RelationshipType,
} from "@/lib/characters-guide"

export interface CharacterRelationshipView {
  id: string
  type: RelationshipType
  /** RELATIONSHIP_META[type].label */
  label: string
  direction: "outgoing" | "incoming"
  otherId: string
  otherName: string
  detail: string | null
}

export interface CharacterLookup {
  character: Character
  docId: string
  aliases: string[]
  debut: { episode: number | null; movie: number | null; label: string | null; spoiler: string }
  relationships: CharacterRelationshipView[]
}

type DebutMeta = NonNullable<ReturnType<typeof getSpoilerMeta>>["debut"]

/** "Episode 129", "Movie 1", or the data's own pre-rendered label. */
function debutLabel(debut: DebutMeta): string | null {
  if (!debut) return null
  if (debut.label) return debut.label
  if (debut.episode != null) return `Episode ${debut.episode}`
  if (debut.movie != null) return `Movie ${debut.movie}`
  return null
}

/**
 * Exact id, exact name, exact alias, then a substring of a name. Ambiguity at
 * any step returns null: "kudo" names three characters, so answering with one of
 * them would be a coin flip presented as a fact.
 */
function resolveCharacter(query: string, characters: Character[]): Character | null {
  const trimmed = query.trim()
  const normalized = normalizeText(query)
  // An empty query is a substring of every name — the opposite of a lookup.
  if (!trimmed || !normalized) return null

  const byId = characters.find((character) => character.id === trimmed.toLowerCase())
  if (byId) return byId

  const exactName = characters.filter((character) => normalizeText(character.name) === normalized)
  if (exactName.length > 0) return exactName.length === 1 ? exactName[0] : null

  const exactAlias = characters.filter((character) =>
    (character.aliases ?? []).some((alias) => normalizeText(alias) === normalized)
  )
  if (exactAlias.length > 0) return exactAlias.length === 1 ? exactAlias[0] : null

  const partial = characters.filter((character) =>
    normalizeText(character.name).includes(normalized)
  )
  return partial.length === 1 ? partial[0] : null
}

/** Resolution order: exact id, exact normalized name, exact alias, then a unique
 *  substring of a name. Returns null rather than guessing between two candidates. */
export function lookupCharacter(
  query: string,
  characters: Character[] = CHARACTERS,
  relationships: Relationship[] = RELATIONSHIPS
): CharacterLookup | null {
  const character = resolveCharacter(query, characters)
  if (!character) return null

  const byId = new Map(characters.map((entry) => [entry.id, entry]))
  const views: CharacterRelationshipView[] = []

  for (const relationship of relationships) {
    const outgoing = relationship.source === character.id
    if (!outgoing && relationship.target !== character.id) continue

    const otherId = outgoing ? relationship.target : relationship.source
    views.push({
      id: relationship.id,
      type: relationship.type,
      label: RELATIONSHIP_META[relationship.type].label,
      direction: outgoing ? "outgoing" : "incoming",
      otherId,
      // A dangling endpoint (a fixture, or a half-applied cast edit) still names
      // the id, because "undefined" in a relationship list reads as a bug.
      otherName: byId.get(otherId)?.name ?? otherId,
      detail: relationship.detail ?? null,
    })
  }

  const meta = getSpoilerMeta(character.id)

  return {
    character,
    docId: `character:${character.id}`,
    aliases: (character.aliases ?? []).map((alias) => alias.toLowerCase()),
    debut: {
      episode: meta?.debut?.episode ?? null,
      movie: meta?.debut?.movie ?? null,
      label: debutLabel(meta?.debut),
      // SpoilerLevel defaults to "none" when the data omits it.
      spoiler: meta?.spoiler ?? "none",
    },
    relationships: views,
  }
}
