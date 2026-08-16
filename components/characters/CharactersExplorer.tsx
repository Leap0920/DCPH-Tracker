"use client"

/*
  CharactersExplorer — Interactive Orchestrator for /characters

  Features:
  - Fullscreen Graph Mode: maximizes to 100vw x 100vh with floating controls & dossier
  - Mobile Responsiveness: Interactive Graph View on phone screens with a toggle to directory list
  - Real-time character dossier drawer and filter controls
*/

import { useState, useEffect } from "react"
import CharactersWeb, {
  useMediaQuery,
} from "@/components/characters/CharactersWeb"
import {
  CharacterDetailPanel,
  RelationshipLegend,
} from "@/components/characters/CharacterDetailPanel"
import { X, Network, LayoutGrid, Maximize2, Filter } from "lucide-react"
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
  const [legendOpen, setLegendOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [graphTheme, setGraphTheme] = useState<"light" | "dark">("light")
  const [mobileViewMode, setMobileViewMode] = useState<"graph" | "list">("graph")

  const isMobile = useMediaQuery("(max-width: 767px)")
  const isDark = graphTheme === "dark"

  const toggleTheme = () => setGraphTheme(graphTheme === "light" ? "dark" : "light")

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  /** A character's threads in both directions, trimmed by the active filter. */
  const threadsFor = (characterId: string): Relationship[] => {
    const all = relationships.filter(
      (r) => r.source === characterId || r.target === characterId
    )
    return filter ? all.filter((r) => r.type === filter) : all
  }

  const panelRelationships = selection ? threadsFor(selection.id) : []

  /* ========================================================================= */
  /* FULLSCREEN MODE                                                           */
  /* ========================================================================= */
  if (isFullscreen) {
    return (
      <div className={`fixed inset-0 z-50 flex flex-col overflow-hidden transition-colors duration-300 ${
        isDark ? "bg-slate-950 text-white" : "bg-page text-ink"
      }`}>
        {/* Fullscreen Graph Canvas */}
        <div className="relative h-full w-full flex-1">
          <CharactersWeb
            onSelectCharacter={setSelection}
            selectedCharacterId={selection?.id}
            activeFilter={filter}
            isFullscreen={true}
            onToggleFullscreen={() => setIsFullscreen(false)}
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
            <div className="absolute bottom-4 right-4 z-40 max-w-full sm:max-w-md w-full sm:w-96 px-3 sm:px-0">
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

  /* ========================================================================= */
  /* FULLSCREEN VIEW (Immediate Edge-to-Edge Canvas)                          */
  /* ========================================================================= */
  return (
    <div className={`relative h-full w-full overflow-hidden transition-colors duration-300 ${
      isDark ? "bg-slate-950 text-white" : "bg-page text-ink"
    }`}>
      {/* Mobile Mode Switcher Toggle (Floating Top Left overlay on Mobile) */}
      {isMobile && (
        <div className="absolute top-16 left-3 z-40">
          <div className={`inline-flex rounded-full p-1 border shadow-md backdrop-blur-md ${
            isDark ? "bg-slate-900/90 border-slate-700/80" : "bg-white/95 border-slate-200/90"
          }`}>
            <button
              type="button"
              onClick={() => setMobileViewMode("graph")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold font-display transition-all",
                mobileViewMode === "graph"
                  ? (isDark ? "bg-slate-800 text-white shadow-sm" : "bg-surface text-ink shadow-sm")
                  : (isDark ? "text-slate-400 hover:text-white" : "text-ink-dim hover:text-ink")
              )}
            >
              <Network className="h-3.5 w-3.5 text-accent" />
              Graph
            </button>
            <button
              type="button"
              onClick={() => setMobileViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold font-display transition-all",
                mobileViewMode === "list"
                  ? (isDark ? "bg-slate-800 text-white shadow-sm" : "bg-surface text-ink shadow-sm")
                  : (isDark ? "text-slate-400 hover:text-white" : "text-ink-dim hover:text-ink")
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-accent" />
              List
            </button>
          </div>
        </div>
      )}

      {/* Main Fullscreen Canvas Container */}
      {isMobile && mobileViewMode === "list" ? (
        /* Mobile Directory Cards View */
        <div className="h-full w-full overflow-y-auto p-4 pt-20 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 max-w-4xl mx-auto">
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
            <div className="fixed bottom-4 right-4 z-40 max-w-full sm:max-w-md w-full sm:w-96 px-3 sm:px-0">
              <CharacterDetailPanel
                character={selection}
                relationships={panelRelationships}
                onClose={() => setSelection(null)}
              />
            </div>
          )}
        </div>
      ) : (
        /* Fullscreen Interactive Graph View */
        <div className="h-full w-full relative">
          <CharactersWeb
            onSelectCharacter={setSelection}
            selectedCharacterId={selection?.id}
            activeFilter={filter}
            onFilterType={setFilter}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            theme={graphTheme}
            onToggleTheme={toggleTheme}
            className="h-full w-full rounded-none border-none"
          />

          {/* Floating Character Detail Panel on Right Side */}
          {selection && (
            <div className="absolute bottom-4 right-4 z-40 max-w-full sm:max-w-md w-full sm:w-96 px-3 sm:px-0">
              <CharacterDetailPanel
                character={selection}
                relationships={panelRelationships}
                onClose={() => setSelection(null)}
              />
            </div>
          )}
        </div>
      )}
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
