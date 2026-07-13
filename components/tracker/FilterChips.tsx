"use client"

import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { FILTER_OPTIONS, type ContentType, type WatchStatus } from "@/lib/constants"

interface FilterChipsProps {
  onFilterChange: (filters: {
    type: string
    status: string
    sort: "air_date" | "canon_order"
    search: string
  }) => void
  initialFilters?: {
    type?: string
    status?: string
    sort?: "air_date" | "canon_order"
    search?: string
  }
}

export function FilterChips({ onFilterChange, initialFilters }: FilterChipsProps) {
  const [sort, setSort] = useState<"air_date" | "canon_order">(initialFilters?.sort ?? "air_date")
  const [type, setType] = useState(initialFilters?.type ?? "all")
  const [status, setStatus] = useState(initialFilters?.status ?? "all")
  const [search, setSearch] = useState(initialFilters?.search ?? "")

  const emitFilters = useCallback(
    (overrides: Partial<{ type: string; status: string; sort: "air_date" | "canon_order"; search: string }>) => {
      const next = { type, status, sort, search, ...overrides }
      onFilterChange(next)
    },
    [type, status, sort, search, onFilterChange]
  )

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search case files..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            emitFilters({ search: e.target.value })
          }}
          className="w-full h-10 rounded-sm border border-white/10 bg-case-file px-3 pl-10 text-sm text-dossier-cream placeholder:text-dossier-cream-dim focus:outline-none focus:ring-2 focus:ring-poison-red"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Sort chips */}
      <div className="flex flex-wrap gap-2">
        <span className="case-number self-center mr-1">ORDER:</span>
        {FILTER_OPTIONS.SORT_BY.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              setSort(option.value)
              emitFilters({ sort: option.value })
            }}
            className={cn(
              "px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wide transition-colors",
              sort === option.value
                ? "bg-poison-red text-dossier-cream"
                : "bg-case-file text-silver-steel hover:bg-case-file-raised hover:text-dossier-cream"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Type chips */}
      <div className="flex flex-wrap gap-2">
        <span className="case-number self-center mr-1">TYPE:</span>
        {FILTER_OPTIONS.TYPE.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              setType(option.value)
              emitFilters({ type: option.value })
            }}
            className={cn(
              "px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wide transition-colors",
              type === option.value
                ? "bg-poison-red text-dossier-cream"
                : "bg-case-file text-silver-steel hover:bg-case-file-raised hover:text-dossier-cream"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <span className="case-number self-center mr-1">STATUS:</span>
        {FILTER_OPTIONS.STATUS.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              setStatus(option.value)
              emitFilters({ status: option.value })
            }}
            className={cn(
              "px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wide transition-colors",
              status === option.value
                ? "bg-poison-red text-dossier-cream"
                : "bg-case-file text-silver-steel hover:bg-case-file-raised hover:text-dossier-cream"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
