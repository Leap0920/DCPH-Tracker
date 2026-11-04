"use client"

/**
 * The /tracker control surface.
 *
 * Everything above the list lives here: the category rail, search, the two
 * labelled dropdowns, the tag filter and the episode-number tools. Keeping it
 * out of ContentGrid is what lets the list component stay about the list.
 *
 * Layout follows one rule — a control that changes WHAT is listed sits above a
 * control that acts ON the list. So: category, search, order/status/tag, then
 * the jump / bulk-mark panel, which is the only thing here that writes rows.
 */

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import {
  VIEW_MODE_OPTIONS,
  WATCH_STATUS_LABELS,
  type ContentType,
  type ViewMode,
  type WatchStatus,
} from "@/lib/constants"
import type { EpisodeTag } from "@/lib/episode-tags"
import { cn } from "@/lib/utils"
import type { StatusFilter } from "@/lib/tracker-view"
import { TypeRail, type RailTab } from "@/components/tracker/TypeRail"
import { FilterSelect, type FilterOption } from "@/components/tracker/FilterSelect"
import { EpisodeTools } from "@/components/tracker/EpisodeTools"
import { TagFilter, TagFilterClear } from "@/components/tracker/TagFilter"

const STATUS_OPTIONS: FilterOption[] = [
  { value: "all", label: "Any status", hint: "No status filter applied." },
  { value: "unwatched", label: WATCH_STATUS_LABELS.unwatched, hint: "Everything you have not marked yet." },
  { value: "watched", label: WATCH_STATUS_LABELS.watched, hint: "Seen at least once." },
  { value: "rewatched", label: WATCH_STATUS_LABELS.rewatched, hint: "Seen more than once." },
]

interface TrackerToolbarProps {
  tabs: RailTab[]
  type: ContentType
  onTypeChange: (type: ContentType) => void

  search: string
  onSearchChange: (value: string) => void

  mode: ViewMode
  onModeChange: (mode: ViewMode) => void

  status: StatusFilter
  onStatusChange: (status: StatusFilter) => void

  facets: { tag: EpisodeTag; count: number }[]
  activeTag: string | null
  onTagChange: (tagKey: string | null) => void

  maxEpisode: number
  onJump: (episodeNumber: number) => string | null
  onMarkUpTo: (episodeNumber: number) => string | null
  unwatchedUpTo: (episodeNumber: number) => number
  markDisabled: boolean
  markDisabledReason?: string

  onRewatchUpTo: (episodeNumber: number) => string | null
  rewatchableUpTo: (episodeNumber: number) => number
  rewatchDisabled: boolean
  rewatchDisabledReason?: string
}

export function TrackerToolbar({
  tabs,
  type,
  onTypeChange,
  search,
  onSearchChange,
  mode,
  onModeChange,
  status,
  onStatusChange,
  facets,
  activeTag,
  onTagChange,
  maxEpisode,
  onJump,
  onMarkUpTo,
  unwatchedUpTo,
  markDisabled,
  markDisabledReason,
  onRewatchUpTo,
  rewatchableUpTo,
  rewatchDisabled,
  rewatchDisabledReason,
}: TrackerToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  /**
   * Episode tools are collapsed on phones.
   *
   * Three labelled forms (jump / mark up to / rewatch up to) stack to roughly
   * 400px on a 390px-wide screen, which pushed the first episode most of a
   * screen below the fold. The list is the product; these are occasional bulk
   * actions. They stay permanently open from `sm` up, where there is room.
   */
  const [toolsOpen, setToolsOpen] = useState(false)

  // "/" focuses search from anywhere on the page, the shortcut every list with
  // a search box owes its readers. Ignored while typing in another field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const activeFacet = facets.find((facet) => facet.tag.key === activeTag)

  return (
    <>
      {/* Not sticky. A bar that follows the page costs the list ~110px of every
          screen and re-covers the rows the reader is trying to read; the
          controls belong to the top of the list, not to the viewport. */}
      <div className="border-b border-line">
        {/* Categories read as tabs across the top of a streaming page, not as
            boxes floating in a panel. They get their own row: sharing one line
            with search and three dropdowns cut the sixth category down to "06
            Ze…" and hid its counter. */}
        <div className="px-3 pt-1.5 sm:px-5">
          <TypeRail tabs={tabs} active={type} onChange={(key) => onTypeChange(key as ContentType)} />
        </div>

        {/* One control surface. Four bordered boxes stacked next to each other
            read as four unrelated widgets; a single bar with hairline dividers
            reads as one instrument, and the fields inside it lose their frames
            instead of repeating the card's border. */}
        <div className="px-3 pb-3 pt-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-muted/40 p-1 sm:flex-nowrap">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search episodes and films"
                aria-label="Search the catalogue"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    onSearchChange("")
                    event.currentTarget.blur()
                  }
                }}
                className="h-8 w-full rounded-md bg-transparent pl-8 pr-9 text-[12px] text-ink placeholder:text-ink-faint focus:bg-surface focus:outline-none focus:ring-1 focus:ring-white/25"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange("")
                      searchRef.current?.focus()
                    }}
                    aria-label="Clear search"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className="hidden rounded border border-line px-1 font-mono text-[9px] leading-4 text-ink-faint sm:block">
                    /
                  </kbd>
                )}
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:flex-nowrap">
              <FilterSelect
                label="Order"
                value={mode}
                options={VIEW_MODE_OPTIONS}
                onChange={(value) => onModeChange(value as ViewMode)}
                className="min-w-0 flex-1 basis-[calc(33.333%-0.35rem)] sm:w-[9.5rem] sm:flex-none sm:basis-auto"
              />
              <FilterSelect
                label="Status"
                value={status}
                options={STATUS_OPTIONS}
                onChange={(value) => onStatusChange(value as StatusFilter)}
                className="min-w-0 flex-1 basis-[calc(33.333%-0.35rem)] sm:w-[8.5rem] sm:flex-none sm:basis-auto"
              />
              <TagFilter
                facets={facets}
                activeTag={activeTag}
                onChange={onTagChange}
                className="min-w-0 flex-1 basis-[calc(33.333%-0.35rem)] sm:w-[8.5rem] sm:flex-none sm:basis-auto"
              />
            </div>
          </div>
        </div>

        {/* Active tag, removable — the filter state should be visible, not only
            implied by the value inside a closed dropdown. */}
        {activeFacet && (
          <div className="flex items-center gap-2 px-3 pb-2 sm:px-5">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
              Filtered
            </span>
            <TagFilterClear tag={activeFacet.tag} onClear={() => onTagChange(null)} />
          </div>
        )}
      </div>

      {/* Episode tools sit below the bar: they act on rows rather than
          deciding what is listed, and pinning them would cost the list a third
          of a phone screen for two inputs. On phones they are collapsed behind
          a disclosure for exactly that reason. */}
      <div className="border-b border-line px-3 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => setToolsOpen((open) => !open)}
          aria-expanded={toolsOpen}
          aria-controls="episode-tools"
          className="flex w-full items-center justify-between gap-2 sm:hidden"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
            Episode tools
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-dim">
            Jump · mark · rewatch
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                toolsOpen && "rotate-180"
              )}
            />
          </span>
        </button>

        <div
          id="episode-tools"
          className={cn(toolsOpen ? "mt-2 block" : "hidden sm:mt-0 sm:block")}
        >
          <EpisodeTools
            maxEpisode={maxEpisode}
            onJump={onJump}
            onMarkUpTo={onMarkUpTo}
            unwatchedUpTo={unwatchedUpTo}
            markDisabled={markDisabled}
            markDisabledReason={markDisabledReason}
            onRewatchUpTo={onRewatchUpTo}
            rewatchableUpTo={rewatchableUpTo}
            rewatchDisabled={rewatchDisabled}
            rewatchDisabledReason={rewatchDisabledReason}
          />
        </div>
      </div>
    </>
  )
}
