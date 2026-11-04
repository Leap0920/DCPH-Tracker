"use client"

import Image from "next/image"
import { Check, ImageOff, Play } from "lucide-react"
import { cn, formatHours, padNumber } from "@/lib/utils"
import type { EpisodeTag } from "@/lib/episode-tags"
import { isNonCanon } from "@/components/tracker/CanonBadge"
import { isWatched } from "@/lib/tracker-view"
import type { WatchStatus } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

/**
 * A 16:9 rail card.
 *
 * Landscape, not portrait, because these rows are episodes: Netflix's
 * continue-watching row is 16:9 with a progress line under the art, and a
 * portrait poster in that row is what makes a tracker look like a library
 * shelf instead of a streaming service.
 *
 * The canon verdict stays on the card — it is the one fact this product exists
 * to show — but as a quiet 8px pill over the art rather than a full chip, so a
 * row of twelve does not read as twelve warnings.
 */
export function PosterCard({
  entry,
  watchStatus,
  canon,
  onSelect,
}: {
  entry: ContentEntry
  watchStatus?: WatchStatus | null
  canon?: EpisodeTag | null
  onSelect?: (entry: ContentEntry) => void
}) {
  const seen = isWatched(watchStatus)
  const number = entry.episode_number ? `EP ${padNumber(entry.episode_number, 3)}` : null
  const runtime = entry.runtime_minutes && entry.runtime_minutes > 0 ? formatHours(entry.runtime_minutes) : null

  return (
    <div className="group w-[62vw] max-w-[252px] shrink-0 snap-start sm:w-[268px] sm:max-w-none">
      <button
        type="button"
        onClick={() => onSelect?.(entry)}
        className={cn(
          "relative block w-full overflow-hidden rounded-md border border-white/10 bg-surface-muted text-left",
          "transition duration-200 ease-out",
          "hover:border-white/30 hover:shadow-[0_18px_40px_-14px_rgba(0,0,0,0.95)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        )}
        aria-label={`${entry.title}${number ? `, ${number}` : ""}`}
      >
        <div className="relative aspect-video w-full">
          {entry.image_url ? (
            <Image
              src={entry.image_url}
              alt=""
              fill
              sizes="268px"
              loading="lazy"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            // No art: a ghost episode number on a soft wash reads as a designed
            // placeholder. The bare "image off" glyph read as a broken image.
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-surface-muted">
              <span
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(120%_120%_at_25%_0%,rgba(255,255,255,0.07),transparent_65%)]"
              />
              {entry.episode_number ? (
                <span
                  aria-hidden
                  className="relative font-display text-[46px] leading-none tracking-tight text-white/[0.13]"
                >
                  {padNumber(entry.episode_number, 3)}
                </span>
              ) : (
                <ImageOff className="relative h-5 w-5 text-ink-faint/30" />
              )}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

          {number && (
            <span className="absolute left-2 top-2 font-mono text-[10px] tracking-wide text-white/85 drop-shadow">
              {number}
              {runtime && <span className="text-white/55"> · {runtime}</span>}
            </span>
          )}

          {canon && (
            <span
              className={cn(
                "absolute right-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[8px] font-medium uppercase tracking-[0.1em] backdrop-blur-sm",
                isNonCanon(canon) ? "text-warning" : "text-success"
              )}
              title={canon.title}
            >
              {canon.label}
            </span>
          )}

          {seen && (
            <span
              className="absolute right-2 bottom-2 flex h-5 w-5 items-center justify-center rounded-full bg-success text-black shadow"
              title="Watched"
            >
              <Check className="h-3 w-3" strokeWidth={4} />
            </span>
          )}

          <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
              <Play className="h-4 w-4 fill-current" />
            </span>
          </span>

          <p className="absolute inset-x-0 bottom-0 line-clamp-2 pr-8 text-[11px] font-medium leading-tight text-white drop-shadow">
            <span className="block p-2">{entry.title}</span>
          </p>
        </div>
      </button>

      {/* Progress line under the art, the way a streaming row shows how far in
          you are. Full for watched, empty for untouched. */}
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full", seen ? "bg-white/80" : "bg-transparent")}
          style={{ width: seen ? "100%" : "0%" }}
        />
      </div>
    </div>
  )
}
