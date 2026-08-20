"use client"

/**
 * Spoiler-mode switch + persistence for the Characters graph.
 *
 * The safe value ("spoiler-free") is what renders on first paint; the stored
 * preference is applied in an effect. Reading localStorage during render would
 * both desync hydration and risk painting the unsafe state for a frame.
 */

import { useCallback, useEffect, useState } from "react"
import { SPOILER_STORAGE_KEY } from "@/lib/characters-spoiler"

export interface SpoilerModeState {
  /** true = gating disabled, everything visible. */
  showEverything: boolean
  /** true once the stored preference has been read. */
  hydrated: boolean
  setShowEverything: (next: boolean) => void
  toggle: () => void
}

export function useSpoilerMode(): SpoilerModeState {
  const [showEverything, setShowEverythingState] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      setShowEverythingState(window.localStorage.getItem(SPOILER_STORAGE_KEY) === "all")
    } catch {
      // Private mode / blocked storage: stay spoiler-free.
    } finally {
      setHydrated(true)
    }
  }, [])

  const setShowEverything = useCallback((next: boolean) => {
    setShowEverythingState(next)
    try {
      window.localStorage.setItem(SPOILER_STORAGE_KEY, next ? "all" : "safe")
    } catch {
      // Preference is best-effort.
    }
  }, [])

  const toggle = useCallback(() => {
    setShowEverythingState((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SPOILER_STORAGE_KEY, next ? "all" : "safe")
      } catch {
        // Preference is best-effort.
      }
      return next
    })
  }, [])

  return { showEverything, hydrated, setShowEverything, toggle }
}

export interface SpoilerToggleProps {
  showEverything: boolean
  onChange: (next: boolean) => void
  lockedCount: number
  totalCount: number
  isSignedIn: boolean
  className?: string
}

export function SpoilerToggle({
  showEverything,
  onChange,
  lockedCount,
  totalCount,
  isSignedIn,
  className = "",
}: SpoilerToggleProps) {
  const [confirming, setConfirming] = useState(false)

  const revealed = Math.max(0, totalCount - lockedCount)

  const handleClick = () => {
    if (showEverything) {
      onChange(false)
      setConfirming(false)
      return
    }
    // Turning gating off is destructive to the experience — confirm once.
    if (!confirming) {
      setConfirming(true)
      return
    }
    onChange(true)
    setConfirming(false)
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        onBlur={() => setConfirming(false)}
        aria-pressed={showEverything}
        className={[
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
          "text-xs font-medium transition-colors",
          showEverything
            ? "border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20"
            : "border-white/10 bg-black/20 text-current hover:bg-black/30",
        ].join(" ")}
      >
        <span aria-hidden="true">{showEverything ? "👁" : "🔒"}</span>
        <span>
          {showEverything
            ? "Showing everything"
            : confirming
              ? "Reveal all spoilers?"
              : "Spoiler-free"}
        </span>
      </button>

      <p className="text-[11px] leading-tight opacity-70">
        {showEverything ? (
          <>All {totalCount} characters shown, spoilers included.</>
        ) : lockedCount > 0 ? (
          <>
            {revealed} of {totalCount} revealed
            {isSignedIn ? "" : " — sign in to unlock by progress"}
          </>
        ) : (
          <>All {totalCount} characters revealed by your progress.</>
        )}
      </p>
    </div>
  )
}
