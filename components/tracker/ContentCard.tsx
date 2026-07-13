"use client"

import Link from "next/link"
import { Eye, EyeOff, Play, Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ContentCardProps {
  entry: ContentEntry
  watchStatus?: WatchStatus | null
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
}

const statusConfig: Record<WatchStatus | "none", { icon: typeof Eye; color: string; label: string }> = {
  unwatched: { icon: EyeOff, color: "text-silver-steel", label: "Unwatched" },
  watching: { icon: Play, color: "text-poison-red-bright", label: "Watching" },
  watched: { icon: Check, color: "text-green-500", label: "Watched" },
  none: { icon: EyeOff, color: "text-silver-steel", label: "Unwatched" },
}

const typeBadgeVariant: Record<string, "default" | "secondary" | "outline" | "gold"> = {
  movie: "gold",
  special: "default",
  ova: "secondary",
  episode: "outline",
}

export function ContentCard({ entry, watchStatus, onToggleStatus }: ContentCardProps) {
  const status = watchStatus ?? "none"
  const config = statusConfig[status]
  const StatusIcon = config.icon

  const displayNumber = entry.type === "movie"
    ? `MOV ${padNumber(entry.movie_number ?? 0)}`
    : entry.type === "episode"
      ? `EP ${padNumber(entry.episode_number ?? 0)}`
      : entry.type.toUpperCase()

  return (
    <div className="dossier-card group">
      <span className="dossier-stamp">{displayNumber}</span>

      {/* Image area */}
      <div className="relative aspect-[3/2] bg-case-file-raised overflow-hidden">
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-display text-4xl text-white/5 uppercase">
              {displayNumber}
            </span>
          </div>
        )}

        {/* Status overlay */}
        {onToggleStatus && (
          <button
            onClick={(e) => {
              e.preventDefault()
              onToggleStatus(entry.id, watchStatus ?? null)
            }}
            className={cn(
              "absolute bottom-2 right-2 h-8 w-8 rounded-sm bg-noir-black/80 flex items-center justify-center transition-colors hover:bg-noir-black",
              config.color
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
          <Badge variant={typeBadgeVariant[entry.type] ?? "outline"}>
            {CONTENT_TYPE_LABELS[entry.type as ContentType]}
          </Badge>
          <span className="case-number">
            {new Date(entry.air_date).getFullYear()}
          </span>
        </div>

        <Link href={`/tracker/${entry.slug}`}>
          <h3 className="font-display text-sm uppercase tracking-wide text-dossier-cream group-hover:text-poison-red-bright transition-colors line-clamp-2">
            {entry.title}
          </h3>
        </Link>

        {entry.synopsis && (
          <p className="mt-2 text-xs text-dossier-cream-dim line-clamp-2">
            {entry.synopsis}
          </p>
        )}
      </div>
    </div>
  )
}
