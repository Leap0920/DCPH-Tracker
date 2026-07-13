"use client"

import { useState } from "react"
import { ContentCard } from "./ContentCard"
import { FilterChips } from "./FilterChips"
import type { Database } from "@/types/database.types"
import type { WatchStatus } from "@/lib/constants"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface ContentGridProps {
  entries: ContentEntry[]
  userStatuses?: Map<string, WatchStatus>
  onToggleStatus?: (contentId: string, currentStatus: WatchStatus | null) => void
}

export function ContentGrid({ entries, userStatuses, onToggleStatus }: ContentGridProps) {
  const [filters, setFilters] = useState({
    type: "all",
    status: "all",
    sort: "air_date" as "air_date" | "canon_order",
    search: "",
  })

  // Client-side filtering
  let filtered = entries

  if (filters.type !== "all") {
    filtered = filtered.filter((e) => e.type === filters.type)
  }

  if (filters.status !== "all" && userStatuses) {
    filtered = filtered.filter((e) => userStatuses.get(e.id) === filters.status)
  }

  if (filters.search) {
    const q = filters.search.toLowerCase()
    filtered = filtered.filter((e) => e.title.toLowerCase().includes(q))
  }

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (filters.sort === "canon_order") {
      return a.canon_order - b.canon_order
    }
    return new Date(a.air_date).getTime() - new Date(b.air_date).getTime()
  })

  return (
    <div className="space-y-6">
      <FilterChips onFilterChange={setFilters} initialFilters={filters} />

      <div className="text-sm text-dossier-cream-dim">
        <span className="case-number">{filtered.length} CASES</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-display text-lg uppercase text-silver-steel">
            No case files found
          </p>
          <p className="text-sm text-dossier-cream-dim mt-2">
            Adjust your filters or check back later.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((entry) => (
            <ContentCard
              key={entry.id}
              entry={entry}
              watchStatus={userStatuses?.get(entry.id) ?? null}
              onToggleStatus={onToggleStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}
