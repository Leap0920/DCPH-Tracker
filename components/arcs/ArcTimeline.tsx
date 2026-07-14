"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { padNumber, formatDate } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export function ArcTimeline({ entries }: { entries: ContentEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="font-display text-lg uppercase text-silver-steel">
          No episodes in this arc yet
        </p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-white/10" />

      <div className="space-y-6">
        {entries
          .sort((a, b) => a.canon_order - b.canon_order)
          .map((entry) => (
            <div key={entry.id} className="relative pl-10">
              {/* Timeline dot */}
              <div className="absolute left-2.5 top-4 h-3 w-3 rounded-full border-2 border-poison-red bg-noir-black" />

              <Link href={`/tracker/${entry.slug}`} className="group">
                <div className="dossier-card p-4 transition-colors group-hover:bg-case-file-raised">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="case-number">
                      #{padNumber(entry.canon_order, 3)}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {CONTENT_TYPE_LABELS[entry.type as ContentType]}
                    </Badge>
                    <span className="case-number">
                      {formatDate(entry.air_date)}
                    </span>
                  </div>

                  <h3 className="font-display text-sm uppercase tracking-wide text-dossier-cream group-hover:text-gold-seal transition-colors">
                    {entry.title}
                  </h3>

                  {entry.synopsis && (
                    <p className="mt-1 text-xs text-dossier-cream-dim line-clamp-1">
                      {entry.synopsis}
                    </p>
                  )}
                </div>
              </Link>
            </div>
          ))}
      </div>
    </div>
  )
}
