"use client"

/*
  CharactersExplorer — orchestrator for /characters.

  It is thin on purpose. The board owns its own chrome now: the legend tray is
  the relationship filter, the search panel is the search, and the case-file
  dossier is the detail surface. Those used to be React siblings of the graph — a
  filter chip, a legend popover, a snapping detail sheet — that had to be kept in
  sync with it by hand. Explorer's remaining jobs are the two things the board
  cannot do for itself: tell the shared chrome store to get out of the way on a
  phone, and hold the selection as React state so the route can react to it.

  All characters and relationships are always visible and un-gated.
*/

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { setCharacterChromeHidden } from "@/lib/character-chrome"
import { useMediaQuery } from "@/lib/use-media-query"
import type { Character, Relationship } from "@/lib/characters-guide"

export interface CharactersExplorerProps {
  characters: Character[]
  relationships: Relationship[]
}

const RedStringsCanvas = dynamic(
  () => import("@/components/characters/RedStringsCanvas"),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full w-full items-center justify-center bg-page"
        aria-busy="true"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
      </div>
    ),
  },
)

export default function CharactersExplorer({
  characters,
  relationships,
}: CharactersExplorerProps) {
  const [selection, setSelection] = useState<Character | null>(null)

  // Sync matchMedia — correct on the first client render, so selecting a
  // character on a phone never flashes the desktop arrangement.
  //
  // 900px is the breakpoint the board's own stylesheet uses to turn the case
  // file into a bottom sheet, so it is also where the app chrome has to yield.
  // The two numbers must move together.
  const isMobile = useMediaQuery("(max-width: 900px)")

  /* Hide the app's own chrome while the case file is open on a phone: the sheet
     takes the bottom of the frame, and the global chat bubble and nav would sit
     on top of it. Publishes to the shared store consumed by the mounted
     ChatWidget; the cleanup also covers navigating away with the sheet open. */
  const hideControls = isMobile && selection != null
  useEffect(() => {
    setCharacterChromeHidden(hideControls)
    return () => setCharacterChromeHidden(false)
  }, [hideControls])

  return (
    <div className="relative h-full w-full overflow-hidden bg-page text-ink">
      <RedStringsCanvas
        characters={characters}
        relationships={relationships}
        onSelectCharacter={setSelection}
        selectedCharacterId={selection?.id ?? null}
        hideChrome={hideControls}
        className="h-full w-full"
      />
    </div>
  )
}
