"use client"

import { useState } from "react"
import Link from "next/link"
import { EyeOff, Check, RefreshCw, Heart, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ContentCardProps {
  entry: ContentEntry
  watchStatus?: WatchStatus | null
  /** Called with the explicit next status (watched/unwatched). */
  onSetStatus?: (contentId: string, nextStatus: WatchStatus, currentCount: number) => void
  /** Called to increment the rewatch counter (+1, status → rewatched). */
  onIncrementRewatch?: (contentId: string, currentCount: number) => void
  /** Total times watched; shows a badge when > 1 (only while watched/rewatched). */
  watchCount?: number
  /** Whether the user has favorited this entry. */
  favorite?: boolean
  onToggleFavorite?: (contentId: string, current: boolean) => void
  /** User rating in DB units (2,4,6,8,10); 0 = unrated. Display = rating / 2. */
  rating?: number
  /** Called with the star value 1-5; pass 0 to clear. */
  onSetRating?: (contentId: string, rating: number) => void
  /** Story arc for episodes, rendered as a badge linking to /arcs/[slug]. */
  arc?: { slug: string; title: string } | null
  /** Brief highlight ring, used by the jump-to-episode feature. */
  flash?: boolean
  /** Optional: intercept title clicks (e.g. open a detail modal instead of navigating). */
  onSelect?: (entry: ContentEntry) => void
}

const typeBadgeClass: Record<string, string> = {
  movie: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  special: "bg-rose-100 text-rose-700 border-rose-300",
  ova: "bg-violet-100 text-violet-700 border-violet-300",
  live_action: "bg-sky-100 text-sky-700 border-sky-300",
  magic_kaito: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  hanzawa: "bg-zinc-200 text-zinc-700 border-zinc-300",
  zero_tea_time: "bg-teal-100 text-teal-700 border-teal-300",
  episode: "bg-surface-muted text-ink-dim border-ink-dim/30",
}

export function ContentCard({
  entry,
  watchStatus,
  onSetStatus,
  onIncrementRewatch,
  watchCount = 0,
  favorite = false,
  onToggleFavorite,
  rating = 0,
  onSetRating,
  arc,
  flash = false,
  onSelect,
}: ContentCardProps) {
  const status = watchStatus ?? "none"
  const isSeen = status === "watched" || status === "rewatched"
  const [hoverStar, setHoverStar] = useState(0)

  const starValue = Math.round(rating / 2)

  const displayNumber = entry.type === "movie"
    ? "MOVIE"
    : entry.type === "episode"
      ? `EP ${padNumber(entry.episode_number ?? 0)}`
      : entry.type.toUpperCase()

  return (
    <div
      id={`card-${entry.id}`}
      className={cn(
        "relative bg-surface border rounded-lg overflow-hidden group transition-all",
        flash
          ? "border-ink ring-2 ring-ink/60 shadow-md"
          : "border-ink-dim/20 hover:border-ink-dim/30 hover:shadow-md"
      )}
    >
      {entry.type !== "movie" && (
        <span className="absolute top-2 right-2 z-10 bg-ink text-page text-[10px] font-mono px-2 py-0.5 rounded-md">{displayNumber}</span>
      )}

      {/* Rewatch count badge — only while the item is watched/rewatched (no stale ×N on unwatched) */}
      {watchCount > 1 && isSeen && (
        <span
          className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-ink text-page text-[10px] font-mono px-2 py-0.5 rounded-md shadow-card"
          title={`Watched ${watchCount} times`}
        >
          <RefreshCw className="h-2.5 w-2.5" />
          ×{watchCount}
        </span>
      )}

      {/* Image area */}
      <div className="relative aspect-[3/2] bg-surface-muted overflow-hidden">
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-display text-4xl text-ink-dim/15 uppercase">
              {displayNumber}
            </span>
          </div>
        )}

        {/* Favorite heart */}
        {onToggleFavorite && (
          <button
            onClick={(e) => {
              e.preventDefault()
              onToggleFavorite(entry.id, favorite)
            }}
            className={cn(
              "absolute bottom-2 left-2 h-8 w-8 rounded-full bg-surface border flex items-center justify-center transition-colors shadow-card",
              favorite
                ? "border-red-500/40 text-red-400 bg-red-500/10 hover:border-red-500"
                : "border-ink-dim/30 text-ink-faint hover:border-red-400 hover:text-red-400"
            )}
            title={favorite ? "Remove from favorites" : "Add to favorites"}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
          </button>
        )}

        {/* Status overlay — explicit two-button controls */}
        {onSetStatus && (
          <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
            {isSeen && onIncrementRewatch && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onIncrementRewatch(entry.id, watchCount)
                }}
                className="h-8 w-8 rounded-full bg-surface border flex items-center justify-center transition-colors shadow-card border-ink text-ink hover:bg-ink hover:text-page"
                title={watchCount > 0 ? `Rewatched ${watchCount}× total. Click to count another` : "I watched this again"}
                aria-label="Count another rewatch"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.preventDefault()
                onSetStatus(
                  entry.id,
                  status === "unwatched" || status === "none" ? "watched" : "unwatched",
                  watchCount
                )
              }}
              className={cn(
                "h-8 w-8 rounded-full bg-surface border flex items-center justify-center transition-colors shadow-card",
                isSeen
                  ? "border-green-500 text-green-400 bg-green-500/10 hover:border-green-600"
                  : "border-ink-dim/30 text-ink-faint hover:border-ink hover:text-ink"
              )}
              title={isSeen ? "Mark as unwatched" : "Mark as watched"}
              aria-label={isSeen ? "Mark as unwatched" : "Mark as watched"}
            >
              {isSeen ? <Check className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <span className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono",
            typeBadgeClass[entry.type] ?? typeBadgeClass.episode
          )}>
            {CONTENT_TYPE_LABELS[entry.type as ContentType]}
          </span>
          <span className="text-xs text-ink-dim tabular-nums">
            {new Date(entry.air_date).getFullYear()}
          </span>
        </div>

        <Link
          href={`/tracker/${entry.slug}`}
          onClick={(e) => {
            e.preventDefault()
            onSelect?.(entry)
          }}
        >
          <h3 className="font-display text-sm tracking-tight text-ink group-hover:text-ink-dim transition-colors line-clamp-2">
            {entry.title}
          </h3>
        </Link>

        {/* Arc badge (episodes only) */}
        {entry.type === "episode" && arc && (
          <Link
            href={`/arcs/${arc.slug}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-ink-dim/20 bg-surface-muted px-1.5 py-0.5 text-[9px] font-mono text-ink-faint hover:border-ink hover:text-ink transition-colors"
            title={`View the ${arc.title} story arc`}
          >
            <span className="h-1 w-1 rounded-full bg-accent" />
            {arc.title}
          </Link>
        )}

        {/* Star rating (signed-in only) */}
        {onSetRating && (
          <div
            className="mt-2 flex items-center gap-0.5"
            onMouseLeave={() => setHoverStar(0)}
            aria-label={`Rated ${starValue} of 5 stars`}
          >
            {[1, 2, 3, 4, 5].map((star) => {
              const active = (hoverStar > 0 ? hoverStar : starValue) >= star
              return (
                <button
                  key={star}
                  onClick={(e) => {
                    e.preventDefault()
                    onSetRating(entry.id, starValue === star ? 0 : star)
                  }}
                  onMouseEnter={() => setHoverStar(star)}
                  className="-mx-1 -my-2 p-2 transition-transform hover:scale-110"
                  title={`${active ? "Clear" : "Rate"} ${star} star${star > 1 ? "s" : ""}`}
                  aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                >
                  <Star
                    className={cn(
                      "h-4 w-4 transition-colors",
                      active ? "text-accent fill-current" : "text-ink-faint"
                    )}
                  />
                </button>
              )
            })}
          </div>
        )}

        {entry.synopsis && (
          <p className="mt-2 text-xs text-ink-dim line-clamp-2">
            {entry.synopsis}
          </p>
        )}
      </div>
    </div>
  )
}
