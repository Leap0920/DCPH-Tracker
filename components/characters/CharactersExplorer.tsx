"use client"

/*
  CharactersExplorer — the /characters page's interactive orchestrator.

  Owns the two pieces of interactive state (the selected character + the
  active relationship-type filter) and switches the layout on the same ≤767px
  breakpoint that CharactersWeb uses internally:

  - Desktop: RelationshipLegend above the SVG red-strings web on the left,
    with the CharacterDetailPanel in a rail on the right. The rail is 24rem
    wide — not a narrower 320px default — because the verified panel's own
    sm:w-96 width (24rem) has to fit inside it without overflowing.
  - Mobile: CharactersWeb renders null, so a card-grid directory of every
    character takes over and the detail panel renders below the grid.

  All data arrives as props from the async server page (React 19 requires
  serializable server→client props). A character's threads are derived from
  the same `relationships` prop in both directions, so the panel always shows
  exactly what the page passed down; the active filter trims those threads.
*/

import { useState } from "react"
import CharactersWeb, {
  useMediaQuery,
} from "@/components/characters/CharactersWeb"
import {
  CharacterDetailPanel,
  RelationshipLegend,
} from "@/components/characters/CharacterDetailPanel"
import type {
  Character,
  Relationship,
  RelationshipType,
} from "@/lib/characters-guide"
import { cn } from "@/lib/utils"

type RelationshipMeta = Record<
  RelationshipType,
  { label: string; color: string; description: string }
>

export interface CharactersExplorerProps {
  characters: Character[]
  relationships: Relationship[]
  relationshipMeta: RelationshipMeta
}

export default function CharactersExplorer({
  characters,
  relationships,
  relationshipMeta,
}: CharactersExplorerProps) {
  const [selection, setSelection] = useState<Character | null>(null)
  const [filter, setFilter] = useState<RelationshipType | null>(null)
  const isMobile = useMediaQuery("(max-width: 767px)")

  /** A character's threads in both directions, trimmed by the active filter. */
  const threadsFor = (characterId: string): Relationship[] => {
    const all = relationships.filter(
      (r) => r.source === characterId || r.target === characterId
    )
    return filter ? all.filter((r) => r.type === filter) : all
  }

  const panelRelationships = selection ? threadsFor(selection.id) : []

  /* Mobile (≤767px): no SVG web — a card-grid directory, panel below. */
  if (isMobile) {
    return (
      <div className="mt-8">
        <RelationshipLegend activeFilter={filter} onFilterType={setFilter} />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              threads={threadsFor(character.id)}
              relationshipMeta={relationshipMeta}
              selected={selection?.id === character.id}
              onSelect={() => setSelection(character)}
            />
          ))}
        </div>
        {selection && (
          <div className="mt-6 flex justify-center">
            <CharacterDetailPanel
              character={selection}
              relationships={panelRelationships}
              onClose={() => setSelection(null)}
            />
          </div>
        )}
      </div>
    )
  }

  /* Desktop: legend + web on the left, character dossier in the right rail. */
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_24rem] lg:items-start">
      <div className="min-w-0">
        <RelationshipLegend activeFilter={filter} onFilterType={setFilter} />
        <div className="mt-5">
          <CharactersWeb onSelectCharacter={setSelection} />
        </div>
      </div>
      <div className="min-w-0 lg:sticky lg:top-6">
        {selection ? (
          <CharacterDetailPanel
            character={selection}
            relationships={panelRelationships}
            onClose={() => setSelection(null)}
          />
        ) : (
          <div className="dossier-card p-5">
            <span className="case-number">FILE NO. 009</span>
            <p className="mt-2 font-display text-base tracking-tight text-ink">
              No dossier open
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-dim">
              Click a node in the web above to open its dossier and read the
              red strings that bind it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Mobile directory card — dossier-styled entry for one character. */
function CharacterCard({
  character,
  threads,
  relationshipMeta,
  selected,
  onSelect,
}: {
  character: Character
  threads: Relationship[]
  relationshipMeta: RelationshipMeta
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "dossier-card p-5 text-left transition-colors",
        selected && "border-accent"
      )}
    >
      <span className="block font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {character.role}
      </span>
      <span className="mt-1 block font-display text-base font-semibold tracking-tight text-ink">
        {character.name}
      </span>
      <span className="mt-0.5 block text-xs text-ink-faint">
        {character.affiliation}
      </span>
      {threads.length > 0 && (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {threads.map((relationship) => {
            const meta = relationshipMeta[relationship.type]
            return (
              <span
                key={relationship.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-dim"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </span>
            )
          })}
        </span>
      )}
    </button>
  )
}
