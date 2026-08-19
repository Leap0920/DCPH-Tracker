"use client"

/*
  CharactersExplorer — orchestrator for /characters.

  The relationship filter chip and legend popover are handed to the graph as
  `topLeftSlot`, so they live in the SAME flex column as the search field and
  can no longer overlap it (they used to be independent absolutely-positioned
  siblings at top-4 and top-16).
*/

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import CharactersWeb from "@/components/characters/CharactersWeb"
import {
  CharacterDetailPanel,
  RelationshipLegend,
} from "@/components/characters/CharacterDetailPanel"
import { useTheme } from "@/components/theme-provider"
import { getRelationshipColor } from "@/components/characters/graph-theme"
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
}

const EASE = [0.16, 1, 0.3, 1] as const

export default function CharactersExplorer({
  characters,
  relationships,
  relationshipMeta,
}: CharactersExplorerProps) {
  const [selection, setSelection] = useState<Character | null>(null)
  const [filter, setFilter] = useState<RelationshipType | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)

  const { theme } = useTheme()
  const isDark = theme === "dark"

  const threadsFor = (characterId: string): Relationship[] => {
    const all = relationships.filter(
      (r) => r.source === characterId || r.target === characterId
    )
    return filter ? all.filter((r) => r.type === filter) : all
  }

  const panelRelationships = selection ? threadsFor(selection.id) : []

  const filterControls = (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setLegendOpen((v) => !v)}
        aria-expanded={legendOpen}
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all",
          "border-slate-200/90 bg-white/95 text-ink hover:border-slate-300 hover:bg-surface-muted",
          "dark:border-slate-700/80 dark:bg-slate-900/90 dark:text-white dark:hover:border-slate-500"
        )}
      >
        <Filter className="h-3.5 w-3.5 shrink-0 text-accent transition-transform duration-300 group-hover:rotate-12" />
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
            legendOpen && "rotate-180"
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
            <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white/98 p-3 text-ink shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 dark:text-white">
              <div className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-faint dark:text-slate-400">
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
  )

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden transition-colors duration-300",
        isDark ? "bg-slate-950 text-white" : "bg-page text-ink"
      )}
    >
      <CharactersWeb
        characters={characters}
        onSelectCharacter={setSelection}
        selectedCharacterId={selection?.id}
        activeFilter={filter}
        topLeftSlot={filterControls}
        theme={theme}
        className="h-full w-full rounded-none border-none"
      />

      {/* AnimatePresence so the dossier's exit transition actually plays —
          previously the conditional unmount skipped it entirely. */}
      <AnimatePresence>
        {selection && (
          <div
            key={selection.id}
            className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 w-full sm:absolute sm:inset-auto sm:bottom-4 sm:right-4 sm:w-96 sm:max-w-md"
          >
            <CharacterDetailPanel
              character={selection}
              relationships={panelRelationships}
              onClose={() => setSelection(null)}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
