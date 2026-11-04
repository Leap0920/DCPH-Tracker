"use client"

/**
 * Scratch preview for the tracker redesign. Not linked from anywhere and not
 * part of the product — it exists so the list can be looked at without a
 * signed-in Supabase session, because /tracker is behind the auth gate.
 * Delete this route when the redesign lands.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ContentGrid } from "@/components/tracker/ContentGrid"
import { MotivationStats } from "@/components/tracker/MotivationStats"
import type { ContentType, ViewMode, WatchStatus } from "@/lib/constants"
import { parseTypeParam, type StatusFilter } from "@/lib/tracker-view"

type Row = {
  id: string
  slug: string
  title: string
  type: ContentType
  air_date: string
  episode_number: number | null
  movie_number: number | null
  release_order: number | null
  arc_id: string | null
  image_url: string | null
  synopsis: string | null
  canon_order: number | null
  runtime_minutes: number | null
}

/**
 * Real DCW artwork, so the thumbnails in the preview are the same shapes and
 * aspect ratios the live catalog serves. Using a handful of real URLs (rather
 * than nulls) is the point: a preview where every image is missing proves
 * nothing about the layout that ships.
 */
const IMAGES = [
  "https://www.detectiveconanworld.com/wiki/images/thumb/3/30/EP834-835_Case1.jpg/600px-EP834-835_Case1.jpg",
  "https://www.detectiveconanworld.com/wiki/images/4/44/MK_TV_Episode_7.jpg",
  "https://www.detectiveconanworld.com/wiki/images/7/77/MK_TV_Episode_9.jpg",
]

const TITLES = [
  "The Roller Coaster Murder Case",
  "The Kidnapped Girl",
  "The Moonlight Sonata Murder Case",
  "The Shinkansen Bullet Train Bombing",
  "The Man Who Died Twice",
  "The Mysterious Woman in Black",
]

/** Crime slugs per episode, mirroring what dcw_cases_view actually returns. */
const CRIMES: Record<number, string[]> = {
  1: ["murder"],
  2: ["kidnapping"],
  3: ["murder"],
  4: ["bombing"],
  5: ["murder", "attempted-murder"],
  6: ["robbery"],
  100: ["murder"],
  200: ["kidnapping", "murder"],
  300: ["fraud"],
  400: ["murder"],
  500: ["assault"],
  600: ["murder"],
  700: ["suicide"],
  800: ["murder"],
  900: ["robbery"],
  1000: ["murder"],
  1100: ["accident"],
}

function episodes(count = 60): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return {
      id: `ep-${n}`,
      slug: `episode-${n}`,
      title: `Episode ${n}: ${TITLES[i % TITLES.length]}`,
      type: "episode" as ContentType,
      air_date: `${1996 + Math.floor(i / 12)}-0${(i % 9) + 1}-15`,
      episode_number: n,
      movie_number: null,
      release_order: null,
      arc_id: null, // the live catalog has arc_id null on every row
      image_url: i % 7 === 5 ? null : IMAGES[i % IMAGES.length],
      synopsis: null,
      canon_order: n,
      // A couple of non-standard runtimes, as the real catalog has.
      runtime_minutes: n === 11 ? 46 : n === 24 ? 115 : 25,
    }
  })
}

function others(type: ContentType, count: number, label: string): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${type}-${i + 1}`,
    slug: `${type}-${i + 1}`,
    title: `${label} ${i + 1}: ${TITLES[i % TITLES.length]}`,
    type,
    air_date: `${1997 + i}-04-19`,
    episode_number: null,
    movie_number: type === "movie" ? i + 1 : null,
    release_order: i + 1,
    arc_id: null,
    image_url: IMAGES[(i + 1) % IMAGES.length],
    synopsis: null,
    canon_order: null,
    runtime_minutes: type === "movie" ? 95 : 25,
  }))
}

const ENTRIES = [
  ...episodes(),
  ...others("movie", 8, "Movie"),
  ...others("special", 5, "Special"),
  ...others("ova", 4, "OVA"),
  ...others("zero_tea_time", 4, "Zero's Tea Time"),
  ...others("magic_kaito", 3, "Magic Kaito"),
]

const CRIME_MAP = new Map<string, string[]>(
  Object.entries(CRIMES).map(([n, slugs]) => [`ep-${n}`, slugs])
)

function PreviewInner() {
  const params = useSearchParams()
  // Deep-linkable states so a screenshot can prove any of them:
  // /preview-tracker?type=movie&mode=order&status=unwatched
  const initialType = parseTypeParam(params.get("type"))
  const initialMode = (params.get("mode") ?? "year") as ViewMode
  const initialStatus = (params.get("status") ?? "all") as StatusFilter
  // Stateful, not fixtures: the preview is how the tracker's write paths get
  // exercised without a signed-in session, so a bulk action has to actually
  // move the numbers on screen.
  const [statuses, setStatuses] = useState(() => {
    const map = new Map<string, WatchStatus>()
    for (let i = 1; i <= 12; i++) map.set(`ep-${i}`, "watched")
    map.set("ep-3", "rewatched")
    map.set("movie-2", "watched")
    return map
  })
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map([["ep-3", 2]]))

  return (
    <div className="px-0 py-6 sm:py-10">
      {/* The dashboard, so the Series Totals card can be looked at in the same
          shell the product renders it in. */}
      <div className="mx-auto mb-6 max-w-7xl">
        <MotivationStats entries={ENTRIES as never} userStatuses={statuses} />
      </div>
      <div
        id="tracker-list"
        className="mx-auto max-w-7xl scroll-mt-20 overflow-clip rounded-lg border border-line bg-surface shadow-card"
      >
        <ContentGrid
          entries={ENTRIES as never}
          userStatuses={statuses}
          watchCounts={counts}
          favorites={new Map([["movie-2", true]])}
          ratings={new Map([["movie-2", 8]])}
          onSetStatus={(id, next) =>
            setStatuses((prev) => new Map(prev).set(id, next))
          }
          onIncrementRewatch={(id) => {
            setStatuses((prev) => new Map(prev).set(id, "rewatched"))
            setCounts((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1))
          }}
          onToggleFavorite={() => {}}
          onSetRating={() => {}}
          onMarkAll={(ids, status) => {
            setStatuses((prev) => {
              const next = new Map(prev)
              ids.forEach((id) => next.set(id, status))
              return next
            })
            setCounts((prev) => {
              const next = new Map(prev)
              ids.forEach((id) => next.set(id, Math.max(next.get(id) ?? 0, 1)))
              return next
            })
          }}
          onRewatchAll={(ids) => {
            setStatuses((prev) => {
              const next = new Map(prev)
              ids.forEach((id) => next.set(id, "rewatched"))
              return next
            })
            setCounts((prev) => {
              const next = new Map(prev)
              ids.forEach((id) => next.set(id, (next.get(id) ?? 0) + 1))
              return next
            })
          }}
          initialType={initialType}
          initialMode={initialMode}
          initialStatusFilter={initialStatus}
          arcMap={new Map()}
          crimeByContentId={CRIME_MAP}
          onSelect={() => {}}
        />
      </div>
    </div>
  )
}

export default function PreviewPage() {
  return (
    <Suspense fallback={<div className="p-10 text-ink-dim">Loading preview…</div>}>
      <PreviewInner />
    </Suspense>
  )
}
