"use client"

/*
  CharactersExplorer — orchestrator for /characters.

  The relationship filter chip and legend popover are handed to the graph as
  `topLeftSlot`, so they live in the SAME flex column as the search field and
  can no longer overlap it (they used to be independent absolutely-positioned
  siblings at top-4 and top-16).

  `isDark` is still derived here, but only to resolve relationship colors from
  graph-theme (SVG/inline paint values cannot read CSS custom properties). All
  chrome is token-driven and theme-agnostic.

  Spoiler gating: the raw cast is filtered through gateGraph() using the
  viewer's watch progress (from the server) and the local spoiler-mode toggle.
  Hidden nodes are dropped; silhouetted ones are redacted to "???" before they
  ever reach the graph. The detail panel shows a LockedCharacterCard when the
  selected node is locked.
*/

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import CharactersWeb from "@/components/characters/CharactersWeb"
import {
  CharacterDetailPanel,
  RelationshipLegend,
} from "@/components/characters/CharacterDetailPanel"
import LockedCharacterCard from "@/components/characters/LockedCharacterCard"
import { useTheme } from "@/components/theme-provider"
import { getRelationshipColor } from "@/components/characters/graph-theme"
import { buildWatchProgress } from "@/lib/characters-spoiler"
import { gateGraph } from "@/lib/characters-visible"
import { getSpoilerMeta } from "@/lib/characters-debut"
import { SpoilerToggle, useSpoilerMode } from "@/components/characters/spoiler-mode"
import { ChevronDown, Filter } from "lucide-react"
import { cn } from "@/lib/utils"
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
  isSignedIn?: boolean
  watchedEpisodes?: number[]
  watchedMovies?: number[]
  highestEpisode?: number
}

const EASE = [0.16, 1, 0.3, 1] as const

export default function CharactersExplorer({
  characters,
  relationships,
  relationshipMeta,
  isSignedIn = false,
  watchedEpisodes = [],
  watchedMovies = [],
  highestEpisode = 0,
}: CharactersExplorerProps) {
  const [selection, setSelection] = useState<Character | null>(null)
  const [filter, setFilter] = useState<RelationshipType | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)

  const { theme } = useTheme()
  const isDark = theme === "dark"

  const { showEverything, toggle, setShowEverything } = useSpoilerMode()

  const progress = useMemo(
    () => buildWatchProgress({ isSignedIn, watchedEpisodes, watchedMovies }),
    [isSignedIn, watchedEpisodes, watchedMovies],
  )

  // Override highestEpisode from server if provided (server already computed it)
  // but buildWatchProgress also computes it; keep the max.
  const effectiveProgress = useMemo(() => {
    if (highestEpisode > progress.highestEpisode) {
      return { ...progress, highestEpisode }
    }
    return progress
  }, [progress, highestEpisode])

  const graph = useMemo(
    () => gateGraph(characters, relationships, effectiveProgress, { showEverything }),
    [characters, relationships, effectiveProgress, showEverything],
  )

  const threadsFor = (characterId: string): Relationship[] => {
    const all = graph.relationships.filter(
      (r) => r.source === characterId || r.target === characterId,
    )
    return filter ? all.filter((r) => r.type === filter) : all
  }

  const panelRelationships = selection ? threadsFor(selection.id) : []

  // Find if selected character is locked (silhouetted)
  const selectedGated = selection
    ? graph.characters.find((c) => c.id === selection.id) ?? null
    : null
  const isSelectionLocked = selectedGated?.locked ?? false
  const selectedMeta = selection ? getSpoilerMeta(selection.id) : undefined

  const lockedCount = graph.stats.locked + graph.stats.hidden
  const totalCount = graph.stats.total

  const filterControls = useMemo(
    () => (
      <div className="flex flex-col gap-2">
        <SpoilerToggle
          showEverything={showEverything}
          onChange={setShowEverything}
          lockedCount={lockedCount}
          totalCount={totalCount}
          isSignedIn={isSignedIn}
        />
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-lift backdrop-blur-md transition-all",
            "border-line bg-surface/90 text-ink hover:border-ink-faint/40 hover:bg-surface-muted",
          )}
        >
          {/* accent-bright, not accent: at icon size the plain crimson is only
              ~3.3:1 against the near-black surface. */}
          <Filter className="h-3.5 w-3.5 shrink-0 text-accent-bright transition-transform duration-300 group-hover:rotate-12" />
          <span className="min-w-0 flex-1 truncate text-left">
            {filter ? relationshipMeta[filter].label : "All Relationships"}
          </span>
          {filter && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getRelationshipColor(filter, isDark) }}
            />
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-300",
              legendOpen && "rotate-180",
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {legendOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-line bg-surface/95 p-3 text-ink shadow-lift backdrop-blur-xl">
                <div className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Filter by relationship
                </div>
                <RelationshipLegend
                  activeFilter={filter}
                  onFilterType={setFilter}
                  compact
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    ),
    [
      showEverything,
      setShowEverything,
      lockedCount,
      totalCount,
      isSignedIn,
      legendOpen,
      filter,
      relationshipMeta,
      isDark,
    ],
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-page text-ink transition-colors duration-300">
      <CharactersWeb
        characters={graph.characters}
        relationships={graph.relationships}
        onSelectCharacter={setSelection}
        selectedCharacterId={selection?.id}
        activeFilter={filter}
        topLeftSlot={filterControls}
        theme={theme}
        className="h-full w-full rounded-none border-none shadow-none"
      />

      {/* AnimatePresence so the dossier's exit transition actually plays —
          previously the conditional unmount skipped it entirely. */}
      <AnimatePresence>
        {selection && (
          <div
            key={selection.id}
            className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 w-full sm:absolute sm:inset-auto sm:bottom-4 sm:right-4 sm:w-96 sm:max-w-md"
          >
            {isSelectionLocked ? (
              <div className="rounded-2xl border border-line bg-surface/95 shadow-card backdrop-blur-xl">
                <LockedCharacterCard
                  meta={selectedMeta}
                  progress={effectiveProgress}
                  threadCount={panelRelationships.length}
                  onRevealAll={() => setShowEverything(true)}
                />
                <div className="flex justify-center p-3">
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <CharacterDetailPanel
                character={selectedGated ?? selection}
                relationships={panelRelationships}
                onClose={() => setSelection(null)}
              />
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
