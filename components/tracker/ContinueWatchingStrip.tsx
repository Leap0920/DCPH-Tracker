"use client"

import Link from "next/link"
import { Play } from "lucide-react"
import { cn, padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import type {
  ContinueWatchingEntry,
  NextUpEntry,
} from "@/lib/queries/client/continue-watching"

interface ContinueWatchingStripProps {
  /** Watched/rewatched entries, newest interaction first. */
  entries: ContinueWatchingEntry[]
  /** First canon-order entry the user hasn't touched yet, or null. */
  nextUp: NextUpEntry | null
}

/** Compact label shown on the card media area, e.g. "EP 123" / "MOVIE". */
function entryLabel(type: ContentType, episodeNumber: number | null, movieNumber: number | null): string {
  if (type === "movie") return "MOVIE"
  if (type === "episode") return `EP ${padNumber(episodeNumber ?? 0)}`
  return type.toUpperCase()
}

function StripCard({ entry, nextUp = false }: { entry: NextUpEntry; nextUp?: boolean }) {
  const type = entry.type as ContentType
  const label = entryLabel(type, entry.episode_number, entry.movie_number)

  return (
    <Link
      href={`/tracker/${entry.slug}`}
      className={cn(
        "snap-start w-40 shrink-0 block group rounded-lg border overflow-hidden bg-surface transition-all hover:shadow-md",
        nextUp ? "border-accent ring-1 ring-accent/30" : "border-ink-dim/20 hover:border-ink-dim/40"
      )}
    >
      <div className="relative aspect-[3/2] bg-surface-muted overflow-hidden">
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-display text-2xl text-ink-faint uppercase">{label}</span>
          </div>
        )}
        <span className="absolute top-2 right-2 z-10 bg-ink text-white text-[10px] font-mono px-2 py-0.5 rounded-md">
          {label}
        </span>
        {nextUp && (
          <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 bg-accent text-white text-[10px] font-mono px-2 py-0.5 rounded-md">
            <Play className="h-2.5 w-2.5" />
            UP NEXT
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="font-display text-xs tracking-tight text-ink line-clamp-2 group-hover:text-ink-dim transition-colors">
          {entry.title}
        </p>
        <p className="mt-1 text-[10px] font-mono text-ink-faint uppercase">
          {CONTENT_TYPE_LABELS[type]}
        </p>
      </div>
    </Link>
  )
}

/**
 * Horizontal scroll strip of the user's most-recently-watched entries plus a
 * distinct "Up Next" suggestion. Renders nothing (and no layout gap) when the
 * user has neither any watched entries nor an untouched entry.
 */
export function ContinueWatchingStrip({ entries, nextUp }: ContinueWatchingStripProps) {
  if (entries.length === 0 && !nextUp) return null

  return (
    <div className="bg-surface border border-ink-dim/20 rounded-lg overflow-hidden shadow-card">
      <div className="flex items-center gap-2.5 px-4 sm:px-6 py-4 border-b border-ink-dim/10">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-white shrink-0">
          <Play className="h-4 w-4" />
        </span>
        <h2 className="font-display text-sm tracking-tight text-ink">Continue Watching</h2>
        {entries.length > 0 && (
          <span className="font-mono text-xs text-ink-dim rounded-md bg-surface-muted px-1.5 py-0.5">
            {entries.length}
          </span>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto px-4 sm:px-6 py-4 snap-x">
        {entries.map((entry) => (
          <StripCard key={entry.id} entry={entry} />
        ))}
        {nextUp && <StripCard key={`next-${nextUp.id}`} entry={nextUp} nextUp />}
      </div>
    </div>
  )
}
