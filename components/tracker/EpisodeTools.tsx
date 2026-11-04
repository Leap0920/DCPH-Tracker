"use client"

/**
 * The episode-number tools — ONE number, three verbs.
 *
 * Before: three identical `EP [No.]` fields in a row, each with its own button.
 * Nothing distinguished them but the micro-label above, so the row read as the
 * same control printed three times and the reader had to work out which of the
 * three inputs they had typed into. Three fields also meant three error lines,
 * three helper lines and three places to keep in sync.
 *
 * Now: a single episode number, then the three things you can do with it — go
 * to it, mark everything up to it watched, or bump the rewatch count on
 * everything up to it. The number is typed once; each write button reports its
 * own blast radius ("Mark 12", "Rewatch 12") so a destructive action still says
 * how many rows it will touch before you press it.
 */

import { useId, useState } from "react"
import { ArrowRight, Check, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

interface EpisodeToolsProps {
  maxEpisode: number
  /** Returns an error message, or null when the jump was accepted. */
  onJump: (episodeNumber: number) => string | null
  /** Returns an error message, or null when the bulk mark was accepted. */
  onMarkUpTo: (episodeNumber: number) => string | null
  /** How many episodes a bulk mark up to N would change. */
  unwatchedUpTo: (episodeNumber: number) => number
  /** Bulk mark is unavailable when signed out. */
  markDisabled?: boolean
  markDisabledReason?: string
  /** Returns an error message, or null when the bulk rewatch was accepted. */
  onRewatchUpTo: (episodeNumber: number) => string | null
  /** How many episodes a bulk rewatch up to N would bump. */
  rewatchableUpTo: (episodeNumber: number) => number
  /** Bulk rewatch is unavailable when signed out. */
  rewatchDisabled?: boolean
  rewatchDisabledReason?: string
}

function parseEpisode(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  return Number.isFinite(value) ? value : null
}

export function EpisodeTools({
  maxEpisode,
  onJump,
  onMarkUpTo,
  unwatchedUpTo,
  markDisabled = false,
  markDisabledReason,
  onRewatchUpTo,
  rewatchableUpTo,
  rewatchDisabled = false,
  rewatchDisabledReason,
}: EpisodeToolsProps) {
  const inputId = useId()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  const target = parseEpisode(value)
  const inRange = target !== null && target >= 1 && target <= maxEpisode
  const markCount = inRange ? unwatchedUpTo(target) : null
  const rewatchCount = inRange ? rewatchableUpTo(target) : null

  function run(action: (n: number) => string | null) {
    const parsed = parseEpisode(value)
    if (parsed === null) {
      setError(`Enter an episode number between 1 and ${maxEpisode}.`)
      return
    }
    const result = action(parsed)
    setError(result)
    if (!result) setValue("")
  }

  const disabledNote = markDisabled ? (markDisabledReason ?? "Sign in to change progress") : null

  const scope = inRange
    ? [
        markCount ? `${markCount} unwatched` : null,
        rewatchCount ? `${rewatchCount} rewatchable` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Nothing to change up to this episode"
    : `Any episode from 1 to ${maxEpisode}`

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0">
        <label
          htmlFor={inputId}
          className="block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-dim/80"
        >
          Episode
        </label>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span aria-hidden className="font-mono text-[10px] text-ink-faint">
            EP
          </span>
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder={`1–${maxEpisode}`}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                run(onJump)
              }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={`${inputId}-note`}
            className={cn(
              "h-8 w-[5.5rem] rounded-md bg-surface-muted px-2 font-mono text-[13px] tabular-nums text-ink ring-1 ring-inset",
              "placeholder:text-ink-faint focus:outline-none focus:ring-1",
              error ? "ring-danger/70" : "ring-line focus:ring-ink-faint"
            )}
          />
        </div>
      </div>

      {/* Three verbs, one number. Go is the only primary: it moves the view, not
          the data. The two writes are quieter and name their own scope. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => run(onJump)}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-ink px-3 text-[11px] font-medium text-page transition-opacity hover:opacity-85"
        >
          Go
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => run(onMarkUpTo)}
          disabled={markDisabled || markCount === 0}
          title={markDisabled ? markDisabledReason : "Mark every episode up to this number watched"}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-surface-muted px-3 text-[11px] font-medium text-ink transition-colors hover:bg-line disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-surface-muted"
        >
          <Check className="h-3 w-3" />
          {markCount && markCount > 0 ? `Mark ${markCount}` : "Mark watched"}
        </button>
        <button
          type="button"
          onClick={() => run(onRewatchUpTo)}
          disabled={rewatchDisabled || rewatchCount === 0}
          title={
            rewatchDisabled
              ? rewatchDisabledReason
              : "Add one rewatch to every watched episode up to this number"
          }
          className="inline-flex h-8 items-center gap-1 rounded-md bg-surface-muted px-3 text-[11px] font-medium text-ink-dim transition-colors hover:bg-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-surface-muted disabled:hover:text-ink-dim"
        >
          <RotateCcw className="h-3 w-3" />
          {rewatchCount && rewatchCount > 0 ? `Rewatch ${rewatchCount}` : "Rewatch"}
        </button>
      </div>

      {/* One note, not three. It only speaks when it has news: an error, a
          sign-in block, or the scope of the number currently typed. */}
      <p
        id={`${inputId}-note`}
        role={error ? "alert" : undefined}
        className={cn(
          "min-w-0 flex-1 basis-full pb-1.5 text-[10px] leading-snug sm:basis-auto",
          error ? "text-danger" : "text-ink-faint"
        )}
      >
        {error ?? disabledNote ?? scope}
      </p>
    </div>
  )
}
