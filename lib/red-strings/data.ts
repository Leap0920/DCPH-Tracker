/*
  red-strings/data — the renderer's graph, built from the app's own data.

  One source of truth. `lib/characters-guide.ts` holds the cast and the
  relationships, `components/characters/graph-theme.ts` holds the faction
  taxonomy, and this module assembles both into an `AuthoredGraph`. Nothing
  here is a generated copy, so the graph cannot drift from the guide.

  This module deliberately stops at the *authored* stage. `buildGraph` in
  `./engine` derives everything the renderer actually needs from it — degree,
  node radius, tier, the parallel-thread bow, adjacency, content bounds. A
  first attempt at this adapter recomputed all of that here, which meant two
  graph builders and, because it emitted the built shape, `NaN` coordinates:
  `buildGraph` reads `x`/`y`/`affiliation` off the node and `s`/`t` off the
  edge, and a pre-built node has none of them. Emit the authored record and let
  the engine do the rest.
*/

import {
  CHARACTERS,
  RELATIONSHIPS,
  getCharacterImage,
} from "@/lib/characters-guide"
import type { Character, Relationship } from "@/lib/characters-guide"
import { AFFILIATION_FACTION, FACTIONS } from "@/components/characters/graph-theme"
import { hash32 } from "./utils"
import type {
  AuthoredEdge,
  AuthoredGraph,
  AuthoredNode,
  Faction,
} from "./types"

/** The authored coordinate canvas. All 95 characters sit inside it. */
export const WORLD = { width: 2600, height: 1900 } as const

/** Node id the establishing shot centres on. */
export const HUB = "conan-edogawa"

/** Fallback faction for an affiliation the taxonomy does not name. */
export const DEFAULT_FACTION = "CIVILIAN"

/**
 * Deterministic golden-angle spiral for a character with no authored
 * coordinates. Ported from `lib/characters-graph-engine.ts`'s
 * `fallbackPosition` — neither the prototype's generator nor its engine carries
 * one, and this is the app's existing spiral, so it is reused rather than
 * invented. Every character in the guide is authored, so this is a safety net,
 * not a layout path.
 */
export function fallbackPosition(
  id: string,
  index: number,
): { x: number; y: number } {
  const seed = hash32(id)
  const angle = index * 2.3999632 + (seed % 628) / 100
  const radius = 240 + ((seed >>> 8) % 620)
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  }
}

/**
 * What the label draws for a character. The guide's `name` sometimes carries an
 * alternate after a slash ("Conan Edogawa / Shinichi Kudo"); the board labels
 * the primary name only, and the alternate is still on the node's aliases.
 */
export function nodeLabel(name: string): string {
  return name.split("/")[0].trim()
}

/**
 * Build the authored graph from the guide's records.
 *
 * Takes the records rather than reading `CHARACTERS`/`RELATIONSHIPS` directly
 * so the React component can build from the props it is handed — the route
 * passes lightweight characters, which is fine, because portraits resolve from
 * the id alone via `getCharacterImage` and the graph never needs `bio`.
 */
export function authoredGraphFrom(
  characters: readonly Character[],
  relationships: readonly Relationship[],
): AuthoredGraph {
  const nodes: AuthoredNode[] = characters.map((c, i) => {
    const pos =
      typeof c.x === "number" && typeof c.y === "number"
        ? { x: c.x, y: c.y }
        : fallbackPosition(c.id, i)
    return {
      id: c.id,
      name: c.name,
      label: nodeLabel(c.name),
      role: c.role,
      bio: c.bio ?? "",
      aliases: c.aliases ?? [],
      img: getCharacterImage(c.id) ?? "",
      affiliation: c.affiliation,
      faction: AFFILIATION_FACTION[c.affiliation] ?? DEFAULT_FACTION,
      x: pos.x,
      y: pos.y,
    }
  })

  const ids = new Set(nodes.map((n) => n.id))

  /*
    An edge naming an endpoint the cast does not contain is dropped here rather
    than in the engine, so the authored record never lies about its own
    topology. `buildGraph` drops it too; doing it once, at the source, keeps the
    two from disagreeing if the guide ever gains a dangling reference.
  */
  const edges: AuthoredEdge[] = []
  for (const r of relationships) {
    if (!ids.has(r.source) || !ids.has(r.target)) continue
    edges.push({
      id: r.id,
      type: r.type,
      s: r.source,
      t: r.target,
      detail: r.detail ?? "",
    })
  }

  return {
    nodes,
    edges,
    factions: { ...FACTIONS } as Record<string, Faction>,
    hub: HUB,
    world: { width: WORLD.width, height: WORLD.height },
  }
}

/*
  The guide is a module-level constant, so its graph is built once and reused.
  This is a convenience for non-React callers (tests, the QA harness), not a
  correctness requirement: `buildGraph` copies the authored records into its own
  node objects, so nothing mutates what is returned here.
*/
let cached: AuthoredGraph | null = null

/** The authored graph for the whole guide. Memoized (see above). */
export function buildRedStringsGraph(): AuthoredGraph {
  if (!cached) cached = authoredGraphFrom(CHARACTERS, RELATIONSHIPS)
  return cached
}
