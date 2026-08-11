"use client"

import { useState } from "react"
import Link from "next/link"
import { Eye, EyeOff, Check, RefreshCw, Heart, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ContentCardProps {
  entry: ContentEntry
  watchStatus?: WatchStatus | null
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
  /** Total times watched; shows a badge when > 1. */
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
}

const statusConfig: Record<WatchStatus | "none", { icon: typeof Eye; color: string; label: string }> = {
  unwatched: { icon: EyeOff, color: "text-ink-faint", label: "Unwatched" },
  watched: { icon: Check, color: "text-green-600", label: "Watched" },
  rewatched: { icon: RefreshCw, color: "text-ink", label: "Rewatched" },
  none: { icon: EyeOff, color: "text-ink-faint", label: "Unwatched" },
}

const typeBadgeClass: Record<string, string> = {
  movie: "bg-amber-100 text-amber-700 border-amber-300",
  special: "bg-rose-100 text-rose-700 border-rose-300",
  ova: "bg-violet-100 text-violet-700 border-violet-300",
  live_action: "bg-sky-100 text-sky-700 border-sky-300",
  magic_kaito: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  hanzawa: "bg-zinc-200 text-zinc-700 border-zinc-300",
  zero_tea_time: "bg-teal-100 text-teal-700 border-teal-300",
  episode: "bg-surface-muted text-ink-dim border-slate-300",
}

export function ContentCard({
  entry,
  watchStatus,
  onToggleStatus,
  watchCount = 0,
  favorite = false,
  onToggleFavorite,
  rating = 0,
  onSetRating,
  arc,
  flash = false,
}: ContentCardProps) {
  const status = watchStatus ?? "none"
  const config = statusConfig[status]
  const StatusIcon = config.icon
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
          ? "border-gray-900 ring-2 ring-gray-900/60 shadow-md"
          : "border-slate-200 hover:shadow-md"
      )}
    >
      {entry.type !== "movie" && (
        <span className="absolute top-2 right-2 z-10 bg-gray-900 text-white text-[10px] font-mono px-2 py-0.5 rounded">{displayNumber}</span>
      )}

      {/* Rewatch count badge */}
      {watchCount > 1 && (
        <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-gray-900 text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-card">
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
            <span className="font-display text-4xl text-gray-200 uppercase">
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
                ? "border-red-300 text-red-500 bg-red-50 hover:border-red-500"
                : "border-slate-300 text-ink-faint hover:border-red-400 hover:text-red-400"
            )}
            title={favorite ? "Remove from favorites" : "Add to favorites"}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
          </button>
        )}

        {/* Status overlay */}
        {onToggleStatus && (
          <button
            onClick={(e) => {
              e.preventDefault()
              onToggleStatus(entry.id, watchStatus ?? null)
            }}
            className={cn(
              "absolute bottom-2 right-2 h-8 w-8 rounded-full bg-surface border flex items-center justify-center transition-colors shadow-card",
              status === "watched"
                ? "border-green-500 text-green-600 bg-green-50"
                : status === "rewatched"
                  ? "border-gray-900 text-ink bg-surface-muted"
                  : "border-slate-300 text-ink-faint hover:border-ink hover:text-ink"
            )}
            title={config.label}
          >
            <StatusIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono",
            typeBadgeClass[entry.type] ?? typeBadgeClass.episode
          )}>
            {CONTENT_TYPE_LABELS[entry.type as ContentType]}
          </span>
          <span className="text-xs text-ink-dim">
            {new Date(entry.air_date).getFullYear()}
          </span>
        </div>

        <Link href={`/tracker/${entry.slug}`}>
          <h3 className="font-display text-sm tracking-tight text-ink group-hover:text-ink-dim transition-colors line-clamp-2">
            {entry.title}
          </h3>
        </Link>

        {/* Arc badge (episodes only) */}
        {entry.type === "episode" && arc && (
          <Link
            href={`/arcs/${arc.slug}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-surface-muted px-1.5 py-0.5 text-[9px] font-mono text-ink-faint hover:border-ink hover:text-ink transition-colors"
            title={`View the ${arc.title} story arc`}
          >
            <span className="h-1 w-1 rounded-full bg-accent" />
            {arc.title}
          </Link>
        )}

        {/* Star rating (signed-in only) */}
        {onSetRating && (
          <div
            className="mt-1.5 flex items-center gap-0.5"
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
                  className="p-0.5 transition-transform hover:scale-110"
                  title={`${active ? "Clear" : "Rate"} ${star} star${star > 1 ? "s" : ""}`}
                  aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5 transition-colors",
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
