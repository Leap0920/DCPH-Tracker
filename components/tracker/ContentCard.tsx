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
    <div className="relative bg-white border border-gray-200 rounded-lg overflow-hidden group hover:shadow-md transition-shadow">
      <span className="absolute top-2 right-2 z-10 bg-gray-900 text-white text-[10px] font-mono px-2 py-0.5 rounded">{displayNumber}</span>

      {/* Image area */}
      <div className="relative aspect-[3/2] bg-gray-100 overflow-hidden">
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

        {/* Status overlay */}
        {onToggleStatus && (
          <button
            onClick={(e) => {
              e.preventDefault()
              onToggleStatus(entry.id, watchStatus ?? null)
            }}
            className={cn(
              "absolute bottom-2 right-2 h-8 w-8 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center transition-colors hover:bg-white shadow-sm",
              status === "watched" ? "text-green-500" : status === "watching" ? "text-gray-900" : "text-gray-400"
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
          <span className="text-xs text-gray-500">
            {new Date(entry.air_date).getFullYear()}
          </span>
        </div>

        <Link href={`/tracker/${entry.slug}`}>
          <h3 className="font-display text-sm uppercase tracking-wide text-gray-900 group-hover:text-gray-600 transition-colors line-clamp-2">
            {entry.title}
          </h3>
        </Link>

        {entry.synopsis && (
          <p className="mt-2 text-xs text-gray-500 line-clamp-2">
            {entry.synopsis}
          </p>
        )}
      </div>
    </div>
  )
}
