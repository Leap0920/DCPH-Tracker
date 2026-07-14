"use client"

import Link from "next/link"
import { ArrowLeft, Calendar, Clock, Film } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { formatDate, padNumber } from "@/lib/utils"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"] & {
  arcs: Database["public"]["Tables"]["arcs"]["Row"] | null
}

const typeBadgeVariant: Record<string, "default" | "secondary" | "outline" | "gold"> = {
  movie: "gold",
  special: "default",
  ova: "secondary",
  episode: "outline",
}

export function ContentDetail({ entry }: { entry: ContentEntry }) {
  const displayNumber = entry.type === "movie"
    ? `MOV ${padNumber(entry.movie_number ?? 0)}`
    : entry.type === "episode"
      ? `EP ${padNumber(entry.episode_number ?? 0)}`
      : entry.type.toUpperCase()

  return (
    <div>
      <Link href="/tracker" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />
        Back to Case Files
      </Link>

      <div className="relative bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <span className="absolute top-2 right-2 z-10 bg-gray-900 text-white text-[10px] font-mono px-2 py-0.5 rounded">{displayNumber}</span>

        {/* Image */}
        <div className="relative aspect-video bg-gray-100">
          {entry.image_url ? (
            <img
              src={entry.image_url}
              alt={entry.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-display text-6xl text-gray-200 uppercase">
                {displayNumber}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge variant={typeBadgeVariant[entry.type] ?? "outline"}>
              {CONTENT_TYPE_LABELS[entry.type as ContentType]}
            </Badge>
            <span className="text-xs text-gray-500 font-mono">
              CANON #{padNumber(entry.canon_order, 3)}
            </span>
          </div>

          <h1 className="font-display text-2xl sm:text-4xl uppercase tracking-wide text-gray-900 mb-4">
            {entry.title}
          </h1>

          <div className="flex flex-wrap gap-6 mb-6 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-900" />
              <span>{formatDate(entry.air_date)}</span>
            </div>
            {entry.runtime_minutes && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-900" />
                <span>{entry.runtime_minutes} min</span>
              </div>
            )}
            {entry.arcs && (
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-gray-900" />
                <Link
                  href={`/arcs/${entry.arcs.slug}`}
                  className="hover:text-gray-900 transition-colors"
                >
                  {entry.arcs.title}
                </Link>
              </div>
            )}
          </div>

          {entry.synopsis && (
            <div className="border-t border-gray-200 pt-6">
              <h2 className="font-display text-sm uppercase tracking-wide text-gray-500 mb-3">
                Synopsis
              </h2>
              <p className="font-body text-gray-600 leading-relaxed">
                {entry.synopsis}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
