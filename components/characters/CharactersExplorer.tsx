"use client"

/*
  CharactersExplorer — Interactive Orchestrator for /characters

  Features:
  - Fullscreen Graph Mode: maximizes to 100vw x 100vh with floating controls & dossier
  - Mobile Responsiveness: Interactive Graph View on phone screens with a toggle to directory list
  - Real-time character dossier drawer and filter controls
*/

import { useState } from "react"
import CharactersWeb from "@/components/characters/CharactersWeb"
import {
  CharacterDetailPanel,
  RelationshipLegend,
} from "@/components/characters/CharacterDetailPanel"
import { X, Filter } from "lucide-react"
import type {
  Character,
  Relationship,
  RelationshipType,
} from "@/lib/characters-guide"

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
  const [legendOpen, setLegendOpen] = useState(false)
  const [graphTheme, setGraphTheme] = useState<"light" | "dark">("light")

  const isDark = graphTheme === "dark"

  const toggleTheme = () => setGraphTheme(graphTheme === "light" ? "dark" : "light")

  /** A character's threads in both directions, trimmed by the active filter. */
  const threadsFor = (characterId: string): Relationship[] => {
    const all = relationships.filter(
      (r) => r.source === characterId || r.target === characterId
    )
    return filter ? all.filter((r) => r.type === filter) : all
  }

  const panelRelationships = selection ? threadsFor(selection.id) : []

  return (
    <div className={`relative h-full w-full overflow-hidden transition-colors duration-300 ${
      isDark ? "bg-slate-950 text-white" : "bg-page text-ink"
    }`}>
      {/* Fullscreen Interactive Graph View */}
      <div className="h-full w-full relative">
        <CharactersWeb
          onSelectCharacter={setSelection}
          selectedCharacterId={selection?.id}
          activeFilter={filter}
          onFilterType={setFilter}
          theme={graphTheme}
          onToggleTheme={toggleTheme}
          className="h-full w-full rounded-none border-none"
        />

        {/* Floating Filter Button / Legend */}
        <div className="absolute top-16 left-3 z-30">
          <button
            type="button"
            onClick={() => setLegendOpen(!legendOpen)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all ${
              isDark
                ? "border-slate-700/80 bg-slate-900/90 text-white hover:border-slate-500"
                : "border-slate-200/90 bg-white/95 text-ink hover:bg-surface-muted hover:border-slate-300"
            }`}
          >
            <Filter className="h-3.5 w-3.5 text-accent" />
            {filter ? `Filter: ${relationshipMeta[filter].label}` : "All Relationships"}
          </button>

          {legendOpen && (
            <div className={`mt-2 w-72 sm:w-80 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl ${
              isDark ? "border-slate-800 bg-slate-900/95 text-white" : "border-slate-200 bg-white/98 text-ink"
            }`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${
                  isDark ? "text-slate-400" : "text-ink-faint"
                }`}>
                  Filter by Relationship
                </span>
                <button
                  type="button"
                  onClick={() => setLegendOpen(false)}
                  className={`p-1 ${isDark ? "text-slate-400 hover:text-white" : "text-ink-faint hover:text-ink"}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <RelationshipLegend activeFilter={filter} onFilterType={setFilter} />
            </div>
          )}
        </div>

        {/* Floating Character Detail Panel */}
        {selection && (
          <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:bottom-4 sm:right-4 z-40 w-full sm:w-96 sm:max-w-md pointer-events-auto">
            <CharacterDetailPanel
              character={selection}
              relationships={panelRelationships}
              onClose={() => setSelection(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
