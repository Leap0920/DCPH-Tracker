"use client"

/*
  RedStringsCanvas — the /characters graph, as a canvas.

  This is a thin host, deliberately. Everything the board looks like and
  everything it does — camera, label placement, hit-testing, drag, wheel,
  keyboard, the legend tray, the search panel, the case-file dossier and the
  screen-reader mirror — belongs to `lib/red-strings/engine.ts` and the art
  direction in `lib/red-strings/theme.ts`. React's only jobs are to put the
  element skeleton on the page, create the engine once, and destroy it on
  unmount.

  It must not re-render the graph. The engine paints from its own loop into a
  single canvas and mutates its own DOM in place; a React render that rebuilt
  the scene would re-bake 94 portraits and reset the camera on every parent
  state change. So the engine is created in a mount-only effect and every
  changing input reaches it through a ref or an imperative call, never through
  the effect's dependency list.
*/

import { useEffect, useMemo, useRef } from "react"
import { createEngine } from "@/lib/red-strings/engine"
import { createThemeA } from "@/lib/red-strings/theme"
import { authoredGraphFrom } from "@/lib/red-strings/data"
import { boardFontVars } from "@/lib/red-strings/fonts"
import type { Engine } from "@/lib/red-strings/types"
import type { Character, Relationship } from "@/lib/characters-guide"
import { cn } from "@/lib/utils"

import "@/lib/red-strings/red-strings.css"

export interface RedStringsCanvasProps {
  characters: Character[]
  relationships: Relationship[]
  /** Fired on every selection change, with `null` when the board is cleared. */
  onSelectCharacter?: (character: Character | null) => void
  /** Controlled selection. The engine ignores a repeat of what it already has. */
  selectedCharacterId?: string | null
  /** Hide the bottom chrome while the mobile case-file sheet is open, so the
   *  sheet does not cover the search panel and tool dock it needs to leave. */
  hideChrome?: boolean
  className?: string
}

export default function RedStringsCanvas({
  characters,
  relationships,
  onSelectCharacter,
  selectedCharacterId,
  hideChrome = false,
  className,
}: RedStringsCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const dossierRef = useRef<HTMLElement>(null)
  const a11yRef = useRef<HTMLUListElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)

  const graph = useMemo(
    () => authoredGraphFrom(characters, relationships),
    [characters, relationships],
  )

  /*
    One theme instance for the life of the component. `createThemeA` precomputes
    every relationship's strokes at factory time, so rebuilding it per render
    would be real work, and rebuilding it per app-theme toggle would recreate
    the engine and re-home the camera.

    `isDark: true` is not the app's theme — it is the board's. The case board is
    cork in a dark room: its material, its manila nameplates and its near-black
    ground are fixed, so its thread colours must be the dark-canvas variants
    whatever the surrounding chrome is doing. Passing the app's theme here would
    lift the threads for a light background that the board never draws.
  */
  const rsTheme = useMemo(() => createThemeA({ isDark: true }), [])

  /* Latest-callback ref: the engine calls this from its own event handlers, and
     it must see the current closure without the engine being rebuilt. */
  const onSelectRef = useRef(onSelectCharacter)
  onSelectRef.current = onSelectCharacter
  /* The id the engine last reported, so a controlled `selectedCharacterId` that
     merely echoes a click does not call back into the engine. */
  const reportedRef = useRef<string | null>(null)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const engine = createEngine({
      theme: rsTheme,
      data: graph,
      root: stage,
      canvas,
      bg: bgRef.current,
      dossier: dossierRef.current,
      a11y: a11yRef.current,
      slots: {
        title: titleRef.current,
        legend: legendRef.current,
        search: searchRef.current,
        tools: toolsRef.current,
        hud: hudRef.current,
      },
      onSelect: (id) => {
        reportedRef.current = id
        onSelectRef.current?.(
          id ? (characters.find((c) => c.id === id) ?? null) : null,
        )
      },
    })
    engineRef.current = engine

    /*
      The QA surface the renderer's acceptance table is written against:
      `stats()` to tell a layout bug from a paint bug, and `tick()` to advance
      the loop on a synthetic clock when no compositor is running. Kept in
      production too, because the same measurements are what make a performance
      claim checkable on a real build rather than only in dev.
    */
    ;(window as unknown as { __app?: Engine }).__app = engine

    return () => {
      engine.destroy()
      engineRef.current = null
      delete (window as unknown as { __app?: Engine }).__app
    }
  }, [graph, rsTheme, characters])

  /* Controlled selection in: only push a value the engine is not already on. */
  useEffect(() => {
    const id = selectedCharacterId ?? null
    if (id === reportedRef.current) return
    reportedRef.current = id
    engineRef.current?.select(id)
  }, [selectedCharacterId])

  return (
    <div
      ref={stageRef}
      className={cn(
        "stage dcph-rs",
        boardFontVars,
        hideChrome && "is-sheet-open",
        className,
      )}
      data-red-strings=""
    >
      <div ref={bgRef} className="bg" aria-hidden="true" />
      <div className="tile" aria-hidden="true">
        <i />
      </div>
      <canvas
        ref={canvasRef}
        className="canvas"
        role="img"
        aria-label="Detective Conan relationship graph — case board"
      />
      <div className="veil" aria-hidden="true" />

      <div className="chrome">
        <div ref={titleRef} className="slot-title" />
        <div ref={legendRef} className="slot-legend" />
        <div ref={searchRef} className="slot-search" />
        <div ref={toolsRef} className="slot-tools" />
        <div ref={hudRef} className="slot-hud" />
      </div>

      <aside
        ref={dossierRef}
        className="dossier"
        aria-hidden="true"
        aria-label="Case file"
      />
      <ul ref={a11yRef} className="a11y" aria-label="Character list" />
    </div>
  )
}
