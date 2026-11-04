"use client"

import { useState } from "react"
import Image from "next/image"
import { Check, ChevronRight, Eye, Heart, ImageOff, RefreshCw, Star } from "lucide-react"
import { cn, formatHours, padNumber } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import { TAG_KINDS, canonTagOf, type EpisodeTag } from "@/lib/episode-tags"
import { tagFacetStyle, tagStyle } from "@/components/tracker/tag-styles"
import { CanonBadge } from "@/components/tracker/CanonBadge"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

interface TrackerRowProps {
  entry: ContentEntry
  watchStatus?: WatchStatus | null
  onSetStatus?: (contentId: string, nextStatus: WatchStatus, currentCount: number) => void
  onIncrementRewatch?: (contentId: string, currentCount: number) => void
  watchCount?: number
  favorite?: boolean
  onToggleFavorite?: (contentId: string, current: boolean) => void
  /** DB units 2..10; 0 = unrated. */
  rating?: number
  /** Derived chips for this row (see lib/episode-tags.ts). */
  tags?: EpisodeTag[]
  /** Position in the full watch order; replaces the number when present. */
  ordinal?: number
  /** Brief highlight used by the jump-to-episode feature. */
  flash?: boolean
  onSelect?: (entry: ContentEntry) => void
  /** Clicking a chip filters the list by that tag. */
  onTagClick?: (tagKey: string) => void
  /** The section header already prints the air year, so the row can drop it. */
  hideYear?: boolean
}

/** How many chips a row shows before collapsing the rest into "+N". */
const MAX_VISIBLE_TAGS = 3

function rowNumber(entry: ContentEntry): string {
  if (entry.type === "episode") return `EP ${padNumber(entry.episode_number ?? 0, 3)}`
  if (entry.type === "movie") return `MOV ${padNumber(entry.movie_number ?? entry.release_order ?? 0, 2)}`
  return `#${padNumber(entry.release_order ?? 0, 2)}`
}

/**
 * One line of the tracker list.
 *
 * A row, not a card: the tracker is a list of ~1,200 things to tick off, and
 * posters in a five-column grid turn scanning into scrolling. The artwork, the
 * number, the title and the watched state sit on one axis so the eye can run
 * down the column; everything else (rewatch, favourite, open) is a small
 * control at the right edge.
 *
 * THE THUMBNAIL IS LOAD-BEARING
 * Every catalog row has an image (1,371 of 1,371), and the artwork is what makes
 * "have I seen this one?" answerable at a glance — a title alone does not. It
 * sits on the LEFT because that is where the eye lands when scanning a list,
 * and because the number, title and tags then share one left edge with it
 * instead of being pushed around by a variable-width image.
 *
 * A fixed box means a missing or broken image collapses to a neutral
 * placeholder at exactly the same size, so one dead URL cannot reflow the list.
 */
export function TrackerRow({
  entry,
  watchStatus,
  onSetStatus,
  onIncrementRewatch,
  watchCount = 0,
  favorite = false,
  onToggleFavorite,
  rating = 0,
  tags = [],
  ordinal,
  flash = false,
  onSelect,
  onTagClick,
  hideYear = false,
}: TrackerRowProps) {
  const seen = watchStatus === "watched" || watchStatus === "rewatched"
  const stars = Math.round(rating / 2)
  // Netflix puts the length on the row, not only in the detail sheet: "do I have
  // time for this one" is a browsing question. formatHours keeps 25 as "25m"
  // and a 1h 55m film from reading as "115m".
  const runtime = entry.runtime_minutes && entry.runtime_minutes > 0 ? formatHours(entry.runtime_minutes) : null
  const year = entry.air_date ? new Date(entry.air_date).getFullYear() : null
  const typeLabel = CONTENT_TYPE_LABELS[entry.type as ContentType]
  const [imageFailed, setImageFailed] = useState(false)

  const open = () => onSelect?.(entry)
  const showImage = Boolean(entry.image_url) && !imageFailed
  // The canon verdict is pulled out of the chip list: it must appear on every
  // row, so it can never be one of the chips the overflow counter swallows.
  const canon = canonTagOf(tags)
  // Runtime chips are dropped here: the length now has its own column on the
  // right of every row ("25m", "1h 35m"), and the chip only fired for
  // non-standard lengths, so a 95-minute film printed the same fact twice and a
  // 25-minute episode printed it nowhere.
  const otherTags = tags.filter(
    (tag) => tag.kind !== TAG_KINDS.CANON && tag.kind !== TAG_KINDS.LENGTH
  )
  const visibleTags = otherTags.slice(0, MAX_VISIBLE_TAGS)
  const hiddenTags = otherTags.slice(MAX_VISIBLE_TAGS)
  const meta = [hideYear ? null : year ? String(year) : null, entry.type === "episode" ? null : typeLabel]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      id={`row-${entry.id}`}
      onClick={open}
      className={cn(
        // Two rows on a phone: the artwork and text get the full width, the
        // actions drop underneath. Inline actions squeezed the title to "Epis…".
        "group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 transition-colors last:border-b-0",
        "sm:flex sm:gap-4 sm:px-5 sm:py-3.5",
        flash ? "bg-accent-soft" : "hover:bg-surface-muted/70"
      )}
    >
      {/* ── Thumbnail ── */}
      <div
        className={cn(
          "relative aspect-[3/2] w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-muted sm:w-28",
          "transition-shadow duration-200 group-hover:shadow-card"
        )}
      >
        {showImage ? (
          <Image
            src={entry.image_url as string}
            alt=""
            fill
            sizes="(max-width: 640px) 96px, 112px"
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={cn(
              "object-cover transition-transform duration-300 group-hover:scale-[1.04]",
              // A watched episode is dimmed, not hidden: the artwork still
              // identifies the row, but the list reads as "done" at a glance.
              seen && "opacity-45 saturate-50"
            )}
          />
        ) : (
          // No number here: the number column already prints it, and two
          // "EP 06"s side by side reads as a rendering bug. An icon keeps the
          // row's geometry identical to an image row without pretending to be
          // artwork that failed to load.
          <span className="flex h-full w-full items-center justify-center bg-surface-muted text-ink-faint/50">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
        {seen && (
          // A corner badge, not a full-cover veil: the artwork still has to
          // identify the row, and the right-hand button already carries the
          // "watched" action.
          <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-success/90 text-page shadow-sm ring-1 ring-page/40">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* ── Number + title + tags ── */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        {/* The number is its own column so the title and the chips below it
            share one left edge; when the number lived inside the title row the
            chips started 56px further left and read as a second column. */}
        <span
          className={cn(
            "w-11 shrink-0 font-mono text-[10px] tabular-nums tracking-tight sm:w-14 sm:text-[11px]",
            seen ? "text-ink-dim" : "text-ink-faint"
          )}
        >
          {ordinal ? `#${padNumber(ordinal, 3)}` : rowNumber(entry)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <div className="flex items-baseline gap-2.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                open()
              }}
              className="block min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <span
                className={cn(
                  "block text-left font-display text-[15px] leading-snug tracking-tight transition-colors sm:text-[17px]",
                  "line-clamp-2 sm:line-clamp-1",
                  seen ? "text-ink-dim group-hover:text-ink" : "text-ink"
                )}
              >
                {entry.title}
              </span>
            </button>

            {runtime && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-faint sm:text-[11px]">
                {runtime}
              </span>
            )}

            {stars > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-accent-bright"
                title={`You rated this ${stars} of 5`}
              >
                <Star className="h-2.5 w-2.5 fill-current" />
                {stars}
              </span>
            )}
          </div>

          {/* Tags + meta. Wraps rather than truncates: a clipped "Attempted
              Murd…" is worse than a second line. */}
          <div className="flex flex-wrap items-center gap-1.5">
          {canon && <CanonBadge tag={canon} onClick={onTagClick} />}
          {visibleTags.map((tag) => {
            const style = tagStyle(tag.kind)
            const facet = tagFacetStyle(tag)
            const Icon = facet.icon
            const chipClass = cn(
              "inline-flex max-w-[13rem] shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] leading-[1.3]",
              facet.chip ?? style.chip
            )
            const body = (
              <>
                <Icon className={cn("h-3 w-3 shrink-0", facet.iconClass)} />
                <span className="truncate">{tag.label}</span>
              </>
            )
            return onTagClick ? (
              <button
                key={tag.key}
                type="button"
                title={`${tag.title} Click to filter by this tag.`}
                onClick={(event) => {
                  event.stopPropagation()
                  onTagClick(tag.key)
                }}
                className={cn(chipClass, "transition-colors hover:border-ink-faint/70")}
              >
                {body}
              </button>
            ) : (
              <span key={tag.key} title={tag.title} className={chipClass}>
                {body}
              </span>
            )
          })}
          {hiddenTags.length > 0 && (
            <span
              title={hiddenTags.map((tag) => tag.label).join(" · ")}
              className="inline-flex items-center rounded-md border border-line/80 px-1.5 py-1 font-mono text-[10px] text-ink-faint"
            >
              +{hiddenTags.length}
            </span>
          )}
          {meta && <span className="font-mono text-[10px] text-ink-faint/80">{meta}</span>}
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="col-span-2 flex shrink-0 items-center justify-end gap-1 sm:col-auto">
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(entry.id, favorite)
            }}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            title={favorite ? "Remove from favorites" : "Add to favorites"}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
              favorite
                ? "text-accent-bright hover:bg-accent-soft"
                : "text-ink-faint hover:bg-surface hover:text-ink"
            )}
          >
            <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
          </button>
        )}

        {seen && onIncrementRewatch && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onIncrementRewatch(entry.id, watchCount)
            }}
            aria-label={watchCount > 1 ? `Watched ${watchCount} times. Count another` : "Count another rewatch"}
            title={watchCount > 1 ? `Watched ${watchCount}× total. Count another` : "Watched this again"}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            {/* The count belongs on the control that changes it, not floating
                between the title and the buttons where it reads as a label. */}
            {watchCount > 1 && (
              <span className="absolute -right-0.5 -top-0.5 rounded-full bg-surface-muted px-1 font-mono text-[9px] leading-[14px] text-ink-dim ring-1 ring-line">
                {watchCount}
              </span>
            )}
          </button>
        )}

        {onSetStatus && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSetStatus(entry.id, seen ? "unwatched" : "watched", watchCount)
            }}
            aria-label={seen ? "Mark as unwatched" : "Mark as watched"}
            aria-pressed={seen}
            title={seen ? "Mark as unwatched" : "Mark as watched"}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
              seen
                ? "border-success/40 bg-success/10 text-success hover:border-success"
                : "border-line text-ink-faint hover:border-ink hover:text-ink"
            )}
          >
            {seen ? <Check className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}

        <ChevronRight className="ml-1.5 h-4 w-4 shrink-0 text-ink-faint/60 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-faint" />
      </div>
    </div>
  )
}
