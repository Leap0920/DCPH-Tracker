/**
 * QA route for the Story Arcs redesign — renders the signed-in state.
 *
 * `/arcs` is public, so it can be captured directly; but its progress bars and
 * the spine's wash only appear for an authenticated user, and the headless
 * capture harness has no session. This route mounts the same components with a
 * fixture watched-set that mimics a real halfway-through viewer, so the
 * signed-in layout can be inspected and measured.
 *
 * Fixtures only — no Supabase client, no auth, no environment reads.
 */

import { STORY_ARCS } from "@/lib/arcs-guide"
import { computeArcProgress } from "@/lib/arcs-progress"
import { buildArcIndex, buildArcSegments, summarizeArcs } from "@/lib/arcs-view"
import { ArcSpine } from "@/components/arcs/ArcSpine"
import { ArcRow } from "@/components/arcs/ArcRow"

export const metadata = { title: "Arcs preview (QA)", robots: { index: false } }

/**
 * A viewer with uneven progress: eras finished, one nearly done, one halfway,
 * one barely started. Deliberately ragged so a single capture shows the done,
 * partial and near-empty states of both the row bars and the spine wash — a
 * uniform fixture would make every era look identical and prove nothing.
 */
const WATCHED = new Set<number>()

/** Fill `from`..`upto` inclusive. */
function watch(from: number, upto: number) {
  for (let ep = from; ep <= upto; ep++) WATCHED.add(ep)
}

watch(1, 128) // Conan — finished
watch(129, 178) // Sherry — finished
watch(179, 344) // Vermouth — finished
watch(345, 424) // Kir — finished
watch(425, 550) // Black Organization — about half
watch(509, 700) // Bourbon — partly (overlaps 05 by design; set dedupes)
watch(784, 806) // Rum — barely started

const LATEST = 1216

export default function ArcsPreviewPage() {
  const progressBySlug = new Map(
    STORY_ARCS.map((arc) => [
      arc.slug,
      computeArcProgress(arc, WATCHED, LATEST),
    ])
  )

  const rows = buildArcIndex(STORY_ARCS, progressBySlug)
  const segments = buildArcSegments(rows)
  const summary = summarizeArcs(rows)

  return (
    <div className="px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            QA · signed-in preview
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <h1 className="mt-4 font-display text-3xl tracking-tight text-ink sm:text-4xl">
          Story Arcs
        </h1>

        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          {summary.eras} eras · {summary.episodes.toLocaleString()} episodes ·{" "}
          {summary.firstYear}–{summary.lastYear}
        </p>

        <div className="mt-10">
          <ArcSpine
            segments={segments}
            signedIn
            firstEpisode={STORY_ARCS[0].episodeStart}
            lastEpisode={LATEST}
          />
        </div>

        <section className="mt-8">
          <div className="divide-y divide-line overflow-clip rounded-lg border border-line bg-surface">
            {rows.map((row, i) => (
              <ArcRow key={row.slug} row={row} signedIn striped={i % 2 === 1} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
