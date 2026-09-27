/**
 * On-demand character dossiers.
 *
 * The full guide — every bio and all ~150 relationship descriptions — used to be
 * part of the page's first-load JavaScript, because the dossier panel statically
 * imported it. It is now reached through the dynamic `import()` below, so webpack
 * puts the guide in its own async chunk: a visitor who never taps a character
 * never downloads a single bio, and a visitor who taps Conan downloads the guide
 * once and gets Conan's dossier out of it.
 *
 * The portrait path is NOT here: it travels with the lightweight character the
 * server already sends (see `getLightweightCharacters`), so the panel can show
 * the picture as soon as the tap happens instead of waiting for this chunk.
 *
 * `import type` is erased at compile time, so naming the guide's types does not
 * pull the module back into the synchronous graph.
 */

import type { Character, RelationshipType } from "@/lib/characters-guide"

export interface DossierThread {
  id: string
  type: RelationshipType
  /** The prose description of this specific thread. */
  detail: string
  otherId: string
  otherName: string
  otherRole: string
}

export interface CharacterDossier {
  id: string
  bio: string
  threads: DossierThread[]
}

const cache = new Map<string, CharacterDossier>()

/**
 * Everything the dossier panel needs about ONE character. Resolves from the
 * cache on a repeat tap (the same object identity, so no re-render churn).
 */
export async function loadCharacterDossier(
  characterId: string
): Promise<CharacterDossier | null> {
  const cached = cache.get(characterId)
  if (cached) return cached

  const guide = await import("@/lib/characters-guide")
  const character = guide.getCharacterById(characterId)
  if (!character) return null

  const dossier: CharacterDossier = {
    id: characterId,
    bio: character.bio ?? "",
    threads: guide.getRelationshipsFor(characterId).map((relationship) => {
      const otherId =
        relationship.source === characterId ? relationship.target : relationship.source
      const other = guide.getCharacterById(otherId)
      return {
        id: relationship.id,
        type: relationship.type,
        detail: relationship.detail ?? "",
        otherId,
        otherName: other?.name ?? otherId,
        otherRole: other?.role ?? "",
      }
    }),
  }

  cache.set(characterId, dossier)
  return dossier
}

/** Syntactically safe for render: the synchronously cached dossier, if any. */
export function peekDossier(characterId: string): CharacterDossier | null {
  return cache.get(characterId) ?? null
}

/** Warm the guide chunk without asking for a dossier yet. */
export function warmCharacterGuide(): void {
  void import("@/lib/characters-guide")
}

/** Test seam: the cache would otherwise leak between test cases. */
export function clearDossierCache(): void {
  cache.clear()
}
