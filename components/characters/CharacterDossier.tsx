"use client"

import { useEffect, useState } from "react"
import { AnimatePresence } from "framer-motion"
import { CharacterDetailPanel } from "@/components/characters/CharacterDetailPanel"
import type { RelationshipMeta } from "@/components/characters/RelationshipLegend"
import { loadCharacterDossier, peekDossier, type CharacterDossier } from "@/lib/characters-detail"
import type { Character, RelationshipType } from "@/lib/characters-guide"

/**
 * CharacterDossier — the lazily-loaded half of the explorer.
 *
 * This module exists so that everything the dossier needs (framer-motion and
 * the panel's own markup) stays out of the page's first load: the explorer
 * reaches it through `next/dynamic`, so it is fetched when the visitor first
 * taps a character. It also owns the AnimatePresence wrapper, which keeps the
 * panel's exit animation working even though the panel is only rendered while a
 * character is selected.
 *
 * The dossier text itself is fetched here too (and cached in lib/characters-detail),
 * so the panel can paint its header and portrait immediately and fill in the bio
 * and threads when they arrive.
 */
export default function CharacterDossier({
  character,
  meta,
  filter,
  onClose,
}: {
  character: Character | null
  meta: RelationshipMeta
  filter: RelationshipType | null
  onClose: () => void
}) {
  const id = character?.id ?? null
  const [dossier, setDossier] = useState<CharacterDossier | null>(() =>
    id ? peekDossier(id) : null
  )

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const ready = peekDossier(id)
    if (ready) {
      setDossier(ready)
      return
    }
    loadCharacterDossier(id)
      .then((next) => {
        if (!cancelled) setDossier(next)
      })
      .catch(() => {
        // The graph still works; the panel keeps its skeletons.
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <AnimatePresence>
      {character && (
        <div
          key={character.id}
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 w-full sm:absolute sm:inset-auto sm:bottom-4 sm:right-4 sm:w-96 sm:max-w-md"
        >
          <CharacterDetailPanel
            character={character}
            meta={meta}
            filter={filter}
            dossier={dossier?.id === character.id ? dossier : null}
            onClose={onClose}
          />
        </div>
      )}
    </AnimatePresence>
  )
}
