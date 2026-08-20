/**
 * Gating adapter: raw cast + viewer progress -> render-ready, redacted graph.
 *
 * The render layer receives ONLY what the viewer is allowed to see. Hidden
 * characters are dropped; silhouetted ones have their name, aliases, role,
 * affiliation, and bio replaced with placeholders BEFORE they reach any
 * component. No spoiler string can leak through a tooltip, a search index, or
 * the React DevTools tree, because the string is not there.
 */

import type { Character, Relationship, RelationshipType } from "@/lib/characters-guide"
import { getSpoilerMeta } from "@/lib/characters-debut"
import type { GateOptions, Visibility, WatchProgress } from "@/lib/characters-spoiler"
import {
  canRevealIdentity,
  characterVisibility,
  relationshipVisibility,
  unlockLabel,
} from "@/lib/characters-spoiler"

export const LOCKED_NAME = "???"
export const LOCKED_ROLE = "Not yet revealed"
export const LOCKED_AFFILIATION = "Unknown"
export const LOCKED_BIO =
  "This character has not appeared in the episodes you have marked as watched."

export interface GatedCharacter extends Character {
  visibility: Visibility
  locked: boolean
  /** "Episode 129" / "Movie 1", or null when un-gated. */
  unlockLabel: string | null
  /** Non-spoiling teaser for the locked card. */
  lockedHint?: string
  /** False when the character is visible but their identity is still secret. */
  identityRevealed: boolean
}

export interface GatedRelationship extends Relationship {
  visibility: Visibility
  locked: boolean
}

export interface GatedGraph {
  characters: GatedCharacter[]
  relationships: GatedRelationship[]
  stats: {
    total: number
    revealed: number
    locked: number
    hidden: number
  }
}

/**
 * Build the redacted graph. Memoise this per render — it is O(n + e) but
 * allocates, and every consumer must read the SAME result so nodes and edges
 * can never disagree about what is visible.
 */
export function gateGraph(
  characters: readonly Character[],
  relationships: readonly Relationship[],
  progress: WatchProgress,
  options: GateOptions = {},
): GatedGraph {
  const visibilityById = new Map<string, Visibility>()
  const gated: GatedCharacter[] = []
  const stats = { total: 0, revealed: 0, locked: 0, hidden: 0 }

  for (const character of characters) {
    const meta = getSpoilerMeta(character.id)
    const visibility = characterVisibility(meta, progress, options)
    visibilityById.set(character.id, visibility)
    stats.total += 1

    if (visibility === "hidden") {
      stats.hidden += 1
      continue
    }

    if (visibility === "visible") {
      stats.revealed += 1
      const identityRevealed = canRevealIdentity(meta, progress, options)
      gated.push({
        ...character,
        // Visible but pre-reveal: keep the public name, drop the codenames.
        aliases: identityRevealed ? character.aliases : undefined,
        visibility,
        locked: false,
        unlockLabel: unlockLabel(meta?.debut),
        lockedHint: meta?.lockedHint,
        identityRevealed,
      })
      continue
    }

    // Silhouette: redact everything identifying, keep only id and geometry.
    stats.locked += 1
    gated.push({
      id: character.id,
      name: LOCKED_NAME,
      aliases: undefined,
      role: LOCKED_ROLE,
      affiliation: LOCKED_AFFILIATION,
      bio: LOCKED_BIO,
      x: character.x,
      y: character.y,
      visibility,
      locked: true,
      unlockLabel: unlockLabel(meta?.debut),
      lockedHint: meta?.lockedHint,
      identityRevealed: false,
    })
  }

  const gatedRelationships: GatedRelationship[] = []
  for (const relationship of relationships) {
    const sourceVisibility = visibilityById.get(relationship.source) ?? "hidden"
    const targetVisibility = visibilityById.get(relationship.target) ?? "hidden"
    const visibility = relationshipVisibility(
      getSpoilerMeta(relationship.id),
      sourceVisibility,
      targetVisibility,
      progress,
      options,
    )

    if (visibility === "hidden") continue

    gatedRelationships.push({
      ...relationship,
      // A silhouetted string must not name its own nature.
      detail: visibility === "visible" ? relationship.detail : "",
      visibility,
      locked: visibility !== "visible",
    })
  }

  return { characters: gated, relationships: gatedRelationships, stats }
}

/** Ids safe to expose to search. Locked nodes must never be findable by name. */
export function searchableCharacters(graph: GatedGraph): GatedCharacter[] {
  return graph.characters.filter((character) => !character.locked)
}

/** Relationship types still present after gating, for the legend. */
export function activeRelationshipTypes(graph: GatedGraph): Set<RelationshipType> {
  const types = new Set<RelationshipType>()
  for (const relationship of graph.relationships) {
    if (!relationship.locked) types.add(relationship.type)
  }
  return types
}
