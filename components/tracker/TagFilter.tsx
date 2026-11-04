"use client"

/**
 * Tag filter, as a grouped menu instead of a scrolling chip strip.
 *
 * The strip version had a hard ceiling: 25 facets in a 1,200-row catalogue
 * meant a horizontal scroller with no labels, no grouping, and counts that read
 * as part of the tag name. Grouping by family ("Classification", "Story arc",
 * "Case type") turns the same data into three short lists a reader can aim at.
 *
 * Selecting is single-choice on purpose — canon + arc + crime are independent
 * axes, and intersecting three of them in one control would need a facet panel,
 * not a dropdown. The row chips are the entry point: click a chip on any
 * episode and the same filter applies here.
 */

import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "@/components/ui/select"
import { groupTagFacets, type EpisodeTag } from "@/lib/episode-tags"
import { TAG_FACET_STYLES, tagFacetStyle, tagStyle } from "@/components/tracker/tag-styles"

/** Sentinel for "no tag filter". Radix Select cannot hold an empty value. */
const ANY_TAG = "__any"

interface TagFilterProps {
  facets: { tag: EpisodeTag; count: number }[]
  activeTag: string | null
  onChange: (tagKey: string | null) => void
  className?: string
}

export function TagFilter({ facets, activeTag, onChange, className }: TagFilterProps) {
  if (facets.length === 0) return null

  const groups = groupTagFacets(facets)
  const active = facets.find((facet) => facet.tag.key === activeTag)?.tag
  // A canon filter wears the canon colour: a red frame around the word "Canon"
  // contradicts the green badge the filter was set from. Tags with no explicit
  // tone (arc, case type) keep the accent "this control is set" styling.
  const activeTone = active ? TAG_FACET_STYLES[active.key]?.chip : undefined

  return (
    <Select
      value={activeTag ?? ANY_TAG}
      onValueChange={(value) => onChange(value === ANY_TAG ? null : value)}
    >
      <SelectPrimitive.Trigger
        aria-label="Filter by tag"
        className={cn(
          "group flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-left transition-colors",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
          active
            ? (activeTone ?? "bg-surface-muted")
            : "hover:bg-surface-muted",
          className
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[8px] uppercase leading-none tracking-[0.14em] text-ink-faint">
            Tag
          </span>
          <span
            className={cn(
              "mt-1 block truncate text-[12px] font-medium leading-tight",
              active ? (activeTone ? "text-current" : "text-ink") : "text-ink"
            )}
          >
            {active ? active.label : "Any tag"}
          </span>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectContent
        position="popper"
        className="max-h-[min(26rem,70vh)] w-[var(--radix-select-trigger-width)] min-w-[17rem] rounded-xl border-line p-1.5"
      >
        <SelectItem value={ANY_TAG} className="rounded-lg py-2 pl-9 pr-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] leading-tight text-ink">Any tag</span>
            <span className="text-[11px] leading-snug text-ink-dim">
              {activeTag ? "Clears the tag filter" : "No tag filter"}
            </span>
          </span>
        </SelectItem>

        {groups.map((group) => (
          <SelectGroup key={group.kind}>
            <SelectLabel className="pl-9 pt-2 text-[10px] uppercase tracking-stamp text-ink-dim/70">
              {group.label}
            </SelectLabel>
            {group.facets.map(({ tag, count }) => {
              const facet = tagFacetStyle(tag)
              const Icon = facet.icon
              return (
                <SelectItem key={tag.key} value={tag.key} className="rounded-lg py-1.5 pl-9 pr-3">
                  <span className="flex w-full items-center gap-2">
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", facet.iconClass)} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
                      {tag.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-faint">
                      {count}
                    </span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Small "clear filter" affordance shown beside the trigger when a tag is on. */
export function TagFilterClear({ tag, onClear }: { tag: EpisodeTag; onClear: () => void }) {
  const facet = tagFacetStyle(tag)
  const Icon = facet.icon
  return (
    <button
      type="button"
      onClick={onClear}
      title={`Clear the ${tag.label} filter`}
      className={cn(
        "inline-flex items-center gap-1.5 self-center rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors hover:brightness-110",
        TAG_FACET_STYLES[tag.key]?.chip ?? tagStyle(tag.kind).chip,
        "rounded-full"
      )}
    >
      <Icon className="h-3 w-3" />
      {tag.label}
      <span aria-hidden className="text-[11px] leading-none">
        ×
      </span>
    </button>
  )
}
