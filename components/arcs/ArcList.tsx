"use client"

import Link from "next/link"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { padNumber } from "@/lib/utils"
import type { Database } from "@/types/database.types"

type Arc = Database["public"]["Tables"]["arcs"]["Row"]

export function ArcList({ arcs }: { arcs: Arc[] }) {
  if (arcs.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="font-display text-lg uppercase text-silver-steel">
          No arcs catalogued yet
        </p>
        <p className="text-sm text-dossier-cream-dim mt-2">
          Story arcs will appear here once added to the database.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {arcs.map((arc, i) => (
        <Link key={arc.id} href={`/arcs/${arc.slug}`}>
          <Card className="group h-full transition-colors hover:bg-case-file-raised">
            <CardContent className="p-6">
              <span className="dossier-stamp">
                EP {padNumber(arc.start_episode)}–{padNumber(arc.end_episode)}
              </span>

              {arc.image_url ? (
                <div className="aspect-video rounded-sm overflow-hidden mb-4 mt-4">
                  <img
                    src={arc.image_url}
                    alt={arc.title}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </div>
              ) : (
                <div className="aspect-video rounded-sm bg-case-file-raised flex items-center justify-center mb-4 mt-4">
                  <span className="font-display text-3xl text-white/5">
                    ARC {padNumber(i + 1)}
                  </span>
                </div>
              )}

              <CardTitle className="group-hover:text-gold-seal transition-colors">
                {arc.title}
              </CardTitle>

              {arc.description && (
                <p className="mt-2 text-sm text-dossier-cream-dim line-clamp-2">
                  {arc.description}
                </p>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
