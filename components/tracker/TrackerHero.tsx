"use client"

import Image from "next/image"
import { Info, Play } from "lucide-react"
import { padNumber } from "@/lib/utils"
import type { CatalogueSummary } from "@/lib/tracker-view"

/**
 * The tracker's billboard — PARKED, not mounted.
 *
 * This component is not imported anywhere: the tracker page opens on your
 * progress and the list, as it did before, and the streaming treatment lives
 * inside the list card. Kept so a compact banner can be built from it without
 * starting over.
 *
 * Netflix's show page opens on one enormous piece of art with the title, a
 * one-line pitch and two buttons — everything else is below the fold. The old
 * tracker opened on a 320px banner followed immediately by a toolbar, so the
 * first thing a reader met was controls rather than the show.
 *
 * Rules this keeps:
 * - the art is full-bleed and runs under the gutters; no card, no border
 * - text sits on a left-to-bottom scrim, never on the raw image, so the title
 *   stays legible over a bright frame
 * - exactly two actions, one filled and one translucent, because a third
 *   button turns the billboard into a toolbar
 */
export function TrackerHero({
  summary,
  nextEpisode,
  onContinue,
  onBrowse,
}: {
  summary: CatalogueSummary
  /** First unwatched episode, or null when the run is finished. */
  nextEpisode: { number: number | null; title: string } | null
  onContinue: () => void
  onBrowse: () => void
}) {
  const meta = [
    `${summary.years} years`,
    `${summary.episodes} episodes`,
    `${summary.movies} movies`,
  ]

  return (
    <section className="relative w-full" aria-label="Detective Conan">
      <div className="relative h-[58vh] min-h-[400px] w-full overflow-hidden sm:h-[68vh] sm:max-h-[760px]">
        <Image
          src="/New-poster.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_18%]"
        />

        {/* Three scrims, each with one job: the top one keeps the fixed nav
            legible, the left one carries the copy, the bottom one hands the
            hero over to the page without a hard edge. */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/40 to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-end px-4 pb-10 sm:px-8 sm:pb-14 lg:px-14">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-white/55">
            The complete case file
          </p>

          <h1 className="max-w-3xl font-display text-[2.05rem] font-bold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Detective Conan
          </h1>

          <p className="mt-2.5 line-clamp-2 max-w-xl text-[13px] leading-relaxed text-white/70 sm:mt-3 sm:line-clamp-none sm:text-sm">
            Poisoned by the Black Organization and shrunk into a child, Shinichi Kudo solves cases
            as Conan while hunting the syndicate that did it — and the antidote back to himself.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/70">
            {meta.map((item, index) => (
              <span key={item} className="inline-flex items-center gap-3">
                {index > 0 && <span className="text-white/30">·</span>}
                {item}
              </span>
            ))}
            <span className="text-white/30">·</span>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-white/25 px-1.5 py-0.5 text-[10px] text-white/70">
              {summary.watched} of {summary.total} watched
            </span>
          </div>

          <div className="mt-5 flex max-w-md items-center gap-3">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-700 ease-out"
                style={{ width: `${summary.percent}%` }}
              />
            </div>
            <span className="font-mono text-[11px] font-medium tabular-nums text-white/80">
              {summary.percent}%
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/85"
            >
              <Play className="h-4 w-4 fill-current" />
              {nextEpisode
                ? `Continue${nextEpisode.number ? ` EP ${padNumber(nextEpisode.number, 3)}` : ""}`
                : "Watch from the start"}
            </button>
            <button
              type="button"
              onClick={onBrowse}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-white/15 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Info className="h-4 w-4" />
              Browse episodes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
