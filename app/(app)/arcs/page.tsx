import Link from "next/link"
import { ArrowRight, PlayCircle, Sparkles } from "lucide-react"
import {
  SERIES_PREMISE,
  HOW_IT_WORKS,
  STORY_ARCS,
  RECURRING_THREADS,
  WATCH_GUIDE,
} from "@/lib/arcs-guide"
import { computeArcProgress, getArcProgressData } from "@/lib/arcs-progress"
import { buildArcIndex, buildArcSegments, summarizeArcs } from "@/lib/arcs-view"
import { ArcSpine } from "@/components/arcs/ArcSpine"
import { ArcRow } from "@/components/arcs/ArcRow"

export const metadata = {
  title: "Story Arcs & Watch Guide · Detective Conan PH",
  description:
    "The full Detective Conan main plot from Season 1 to the latest episode, plus a newcomer watch guide.",
}

export default async function ArcsPage() {
  const { signedIn, watchedEpisodeNumbers, latestEpisodeNumber } = await getArcProgressData()

  const progressBySlug = new Map(
    STORY_ARCS.map((arc) => [
      arc.slug,
      computeArcProgress(arc, watchedEpisodeNumbers, latestEpisodeNumber),
    ])
  )

  const rows = buildArcIndex(STORY_ARCS, progressBySlug)
  const segments = buildArcSegments(rows)
  const summary = summarizeArcs(rows)

  return (
    <div className="px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* ── Masthead ────────────────────────────────────────────────────
            The page opens on what it is and how big it is. The premise is a
            lead paragraph rather than a card: it is two sentences of setup,
            and boxing it made it compete with the page title for the eye. */}
        <header>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              File 004
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <h1 className="mt-4 font-display text-3xl tracking-tight text-ink sm:text-4xl">
            Story Arcs
          </h1>

          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-dim">
            {SERIES_PREMISE.intro}
          </p>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-dim">
            {SERIES_PREMISE.body}
          </p>

          {/* The scale of the thing being indexed, stated once. */}
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            {summary.eras} eras · {summary.episodes.toLocaleString()} episodes ·{" "}
            {summary.firstYear}–{summary.lastYear}
          </p>
        </header>

        {/* ── The map ─────────────────────────────────────────────────────
            The one distinctive element on the page: seven contiguous eras,
            each as wide as its episode count. Everything below stays quiet so
            this reads as the thing worth looking at. */}
        <div className="mt-10">
          <ArcSpine
            segments={segments}
            signedIn={signedIn}
            firstEpisode={STORY_ARCS[0].episodeStart}
            lastEpisode={latestEpisodeNumber}
          />
        </div>

        {/* ── The eras ────────────────────────────────────────────────────
            One divided surface, not seven bordered cards. Each row is a fixed
            grid so the spans and the progress bars line up down the column. */}
        <section className="mt-8" aria-labelledby="eras-heading">
          <h2 id="eras-heading" className="sr-only">
            The seven eras
          </h2>
          <div className="divide-y divide-line overflow-clip rounded-lg border border-line bg-surface">
            {rows.map((row, i) => (
              <ArcRow key={row.slug} row={row} signedIn={signedIn} striped={i % 2 === 1} />
            ))}
          </div>
        </section>

        {/* ── Reference material ──────────────────────────────────────────
            Everything below is for a reader who has already found the map and
            wants the rules behind it. It is set denser and quieter so it does
            not compete with the eras above. */}
        <section className="mt-14" aria-labelledby="how-heading">
          <h2 id="how-heading" className="font-display text-lg tracking-tight text-ink">
            How the story works
          </h2>
          <dl className="mt-4 space-y-4">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.title} className="border-l border-line pl-4">
                <dt className="text-[13px] font-medium text-ink">{item.title}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-ink-dim">
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12" aria-labelledby="threads-heading">
          <h2
            id="threads-heading"
            className="flex items-center gap-2 font-display text-lg tracking-tight text-ink"
          >
            <Sparkles className="h-4 w-4 text-accent-bright" />
            Recurring threads
          </h2>
          <p className="mt-1 text-[13px] text-ink-dim">
            Side stories that pay off across hundreds of episodes.
          </p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {RECURRING_THREADS.map((thread) => (
              <li key={thread.slug} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-[13px] font-medium text-ink">{thread.title}</h3>
                  <span className="font-mono text-[10px] text-ink-faint">
                    from ep {thread.starterEpisodes}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
                  {thread.description}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="watch-heading">
          <h2
            id="watch-heading"
            className="flex items-center gap-2 font-display text-lg tracking-tight text-ink"
          >
            <PlayCircle className="h-4 w-4 text-accent-bright" />
            New here? How to watch
          </h2>
          <ol className="mt-4 space-y-3">
            {WATCH_GUIDE.map((step) => (
              <li key={step.step} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] text-ink-dim">
                  {step.step}
                </span>
                <div>
                  <h3 className="text-[13px] font-medium text-ink">{step.title}</h3>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-12 border-t border-line pt-5">
          <Link
            href="/tracker"
            className="group inline-flex items-center gap-2 text-[13px] text-ink-dim transition-colors hover:text-ink"
          >
            Open the tracker to mark what you have watched
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </footer>
      </div>
    </div>
  )
}
