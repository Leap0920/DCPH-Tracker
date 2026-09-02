"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Sentinel for "no filter" — Radix Select forbids empty-string item values. */
export const ANY = "all"

export interface FilterOption {
  value: string
  label: string
  /** Archive-wide count, shown in parentheses. */
  count?: number
}

interface CaseFilterBarProps {
  q: string
  /** content_entries.type; travels in the URL as ?format= */
  contentType: string
  typeSlug: string
  causeSlug: string
  link: string
  sort: string
  contentTypeOptions: FilterOption[]
  crimeOptions: FilterOption[]
  methodOptions: FilterOption[]
  linkOptions: FilterOption[]
  sortOptions: FilterOption[]
  /** Default sort — omitted from the URL when selected. */
  defaultSort: string
  /** e.g. "1–50 of 2,010 files" — composed by the server. */
  resultSummary: string
}

function optionLabel(option: FilterOption): string {
  return option.count === undefined ? option.label : `${option.label} (${option.count})`
}

export function CaseFilterBar({
  q,
  contentType,
  typeSlug,
  causeSlug,
  link,
  sort,
  contentTypeOptions,
  crimeOptions,
  methodOptions,
  linkOptions,
  sortOptions,
  defaultSort,
  resultSummary,
}: CaseFilterBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(q)
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the input in step with back/forward navigation and pill dismissal.
  useEffect(() => setSearch(q), [q])
  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  /**
   * Patch the query string, preserving params we don't touch. Any filter change
   * resets pagination — page 7 of a different filter is meaningless.
   */
  const pushPatch = useCallback(
    (patch: Record<string, string | null | undefined>, debounceMs = 0) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        // undefined means "leave this param alone" — distinct from null, which clears it.
        if (value === undefined) continue
        if (value === null || value === "" || value === ANY) next.delete(key)
        else next.set(key, value)
      }
      next.delete("page")
      const qs = next.toString()
      const url = qs ? `/cases?${qs}` : "/cases"
      if (debounce.current) clearTimeout(debounce.current)
      if (debounceMs > 0) {
        debounce.current = setTimeout(() => router.replace(url, { scroll: false }), debounceMs)
      } else {
        router.replace(url, { scroll: false })
      }
    },
    [router, searchParams]
  )

  /**
   * Every case with a content type is tracker-linked by definition, so "Wiki
   * only" would guarantee an empty page. Hide it while a content type is set.
   */
  const visibleLinkOptions =
    contentType && contentType !== ANY
      ? linkOptions.filter((option) => option.value !== "wiki")
      : linkOptions

  const activeFilters: { key: string; label: string }[] = []
  if (q) activeFilters.push({ key: "q", label: `"${q}"` })
  if (contentType && contentType !== ANY) {
    activeFilters.push({
      key: "format",
      label: contentTypeOptions.find((o) => o.value === contentType)?.label ?? contentType,
    })
  }
  if (typeSlug) {
    activeFilters.push({
      key: "type",
      label: crimeOptions.find((o) => o.value === typeSlug)?.label ?? typeSlug,
    })
  }
  if (causeSlug) {
    activeFilters.push({
      key: "cause",
      label: methodOptions.find((o) => o.value === causeSlug)?.label ?? causeSlug,
    })
  }
  if (link && link !== ANY) {
    activeFilters.push({
      key: "link",
      label: linkOptions.find((o) => o.value === link)?.label ?? link,
    })
  }

  const selectFiltersCount = [
    contentType && contentType !== ANY,
    Boolean(typeSlug),
    Boolean(causeSlug),
    link && link !== ANY,
    sort && sort !== defaultSort,
  ].filter(Boolean).length

  return (
    <div className="sticky top-16 z-20 -mx-4 border-y border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex shrink-0 items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-ink-faint" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Filter the archive
          </span>
        </div>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] tabular-nums text-ink-dim">
          {resultSummary}
        </span>
      </div>

      {/* Search and Mobile Filters Toggle */}
      <div className="flex items-center gap-2">
        <form
          action="/cases"
          onSubmit={(event) => {
            event.preventDefault()
            pushPatch({ q: search.trim() || null })
          }}
          className="relative min-w-0 flex-1"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            name="q"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              pushPatch({ q: event.target.value.trim() || null }, 350)
            }}
            placeholder="Search victim, case or location…"
            aria-label="Search victim, case or location"
            className="h-9 w-full rounded-lg border border-line bg-surface-muted pl-9 pr-9 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("")
                pushPatch({ q: null })
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        <button
          type="button"
          onClick={() => setIsMobileFiltersOpen((prev) => !prev)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-3 font-mono text-xs text-ink-dim transition-colors hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 sm:hidden"
          aria-expanded={isMobileFiltersOpen}
          aria-label="Toggle filter options"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Filters</span>
          {selectFiltersCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 font-mono text-[10px] font-medium text-accent-bright">
              {selectFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Five dropdowns — 2 columns on mobile, 5 columns on desktop */}
      <div
        className={cn(
          "mt-2.5 gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
          isMobileFiltersOpen ? "grid grid-cols-2" : "hidden"
        )}
      >
        <FilterSelect
          label="Content type"
          value={contentType || ANY}
          options={contentTypeOptions}
          allLabel="All content"
          onChange={(value) =>
            pushPatch({
              format: value,
              link: value !== ANY && link === "wiki" ? null : undefined,
            })
          }
        />
        <FilterSelect
          label="Crime type"
          value={typeSlug || ANY}
          options={crimeOptions}
          allLabel="All crime types"
          onChange={(value) => pushPatch({ type: value })}
        />
        <FilterSelect
          label="Method"
          value={causeSlug || ANY}
          options={methodOptions}
          allLabel="All methods"
          onChange={(value) => pushPatch({ cause: value })}
        />
        <FilterSelect
          label="Source"
          value={link || ANY}
          options={visibleLinkOptions}
          onChange={(value) => pushPatch({ link: value })}
        />
        <div className="col-span-2 sm:col-span-1">
          <FilterSelect
            label="Sort"
            value={sort}
            options={sortOptions}
            onChange={(value) => pushPatch({ sort: value === defaultSort ? null : value })}
          />
        </div>
      </div>

      {/* Active filters — visible at a glance. */}
      {activeFilters.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            Active
          </span>
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => pushPatch({ [filter.key]: null })}
              className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-bright transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            >
              {filter.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              pushPatch({ q: null, format: null, type: null, cause: null, link: null })
            }
            className="ml-1 font-mono text-[10px] text-ink-faint underline decoration-dotted transition-colors hover:text-ink"
          >
            clear all
          </button>
        </div>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string
  value: string
  options: FilterOption[]
  allLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full text-xs">
          <SelectValue placeholder={allLabel ?? label} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {allLabel && <SelectItem value={ANY}>{allLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

