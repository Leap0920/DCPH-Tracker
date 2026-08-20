"use client"

/**
 * Locked-state body for the character dossier. Shows how to unlock and nothing
 * that could spoil: no name, no bio, no threads, no affiliation.
 */

import Link from "next/link"
import type { SpoilerMeta, WatchProgress } from "@/lib/characters-spoiler"
import { unlockInstruction, unlockLabel } from "@/lib/characters-spoiler"

export interface LockedCharacterCardProps {
  meta: SpoilerMeta | undefined
  progress: WatchProgress
  /** Number of red strings this character has, safe to show as a teaser. */
  threadCount?: number
  onRevealAll?: () => void
}

export default function LockedCharacterCard({
  meta,
  progress,
  threadCount,
  onRevealAll,
}: LockedCharacterCardProps) {
  const label = unlockLabel(meta?.debut)

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-current/30 text-3xl opacity-60"
        aria-hidden="true"
      >
        🔒
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Not yet revealed</h2>
        <p className="text-sm opacity-70">{unlockInstruction(meta, progress)}</p>
      </div>

      {meta?.lockedHint ? (
        <p className="max-w-sm text-xs italic opacity-60">{meta.lockedHint}</p>
      ) : null}

      {typeof threadCount === "number" && threadCount > 0 ? (
        <p className="text-xs opacity-50">
          {threadCount} red string{threadCount === 1 ? "" : "s"} waiting.
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-2 pt-2">
        {progress.isSignedIn ? (
          <Link
            href="/tracker"
            className="rounded-full bg-accent-bright px-4 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            {label ? `Go to ${label} in the tracker` : "Open the tracker"}
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-accent-bright px-4 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            Sign in to track your progress
          </Link>
        )}

        {onRevealAll ? (
          <button
            type="button"
            onClick={onRevealAll}
            className="text-[11px] underline opacity-50 transition-opacity hover:opacity-80"
          >
            I don&apos;t mind spoilers — reveal everything
          </button>
        ) : null}
      </div>
    </div>
  )
}
