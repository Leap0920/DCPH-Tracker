import Link from "next/link"
import {
  BookOpen,
  Sparkles,
  Layers,
  PlayCircle,
  ArrowRight,
  Compass,
  Clock,
  Users,
} from "lucide-react"
import {
  SERIES_PREMISE,
  HOW_IT_WORKS,
  STORY_ARCS,
  RECURRING_THREADS,
  WATCH_GUIDE,
  formatEpisodeRange,
} from "@/lib/arcs-guide"
import { computeArcProgress, getArcProgressData } from "@/lib/arcs-progress"

export const metadata = {
  title: "Story Arcs & Watch Guide · Detective Conan PH",
  description:
    "The full Detective Conan main plot from Season 1 to the latest episode, plus a newcomer watch guide.",
}

export default async function ArcsPage() {
  const { signedIn, watchedEpisodeNumbers } = await getArcProgressData()
  const progressBySlug = new Map(
    STORY_ARCS.map((arc) => [
      arc.slug,
      computeArcProgress(arc, watchedEpisodeNumbers),
    ])
  )
  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 004 STORY ARCS</span>
          <span className="redacted-bar w-16" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Story Arcs &amp; Watch Guide
        </h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          The full main plot of Detective Conan from Season 1 to the latest
          episode and how to actually watch it without drowning in 1,100+
          episodes.
        </p>

        {/* Premise */}
        <div className="mt-8 rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl tracking-tight text-ink">
                {SERIES_PREMISE.title}
              </h2>
              <p className="mt-2 text-sm text-ink-dim">{SERIES_PREMISE.intro}</p>
              <p className="mt-2 text-sm text-ink-dim">{SERIES_PREMISE.body}</p>
            </div>
          </div>
        </div>

        {/* How the story works */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Compass className="h-5 w-5 text-accent" />
            <h2 className="font-display text-2xl tracking-tight text-ink">
              How the story works
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-ink-dim/20 bg-surface p-5"
              >
                <h3 className="font-display text-base tracking-tight text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-ink-dim">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Main plot timeline */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-accent" />
            <h2 className="font-display text-2xl tracking-tight text-ink">
              The main plot: S1 to latest
            </h2>
          </div>
          <p className="mb-6 text-sm text-ink-dim">
            Seven eras, each named for the Black Organization member in focus.
            Episode ranges use the original Japanese numbering.
          </p>

          <ol className="relative space-y-4 border-l border-ink-dim/20 pl-6">
            {STORY_ARCS.map((arc) => {
              const progress = progressBySlug.get(arc.slug)!
              return (
              <li key={arc.slug} className="relative">
                <span className="absolute -left-[31px] top-5 h-3 w-3 rounded-full border-2 border-accent bg-surface" />
                <Link
                  href={`/arcs/${arc.slug}`}
                  className="group block rounded-lg border border-ink-dim/20 bg-surface p-5 shadow-card transition-colors hover:border-ink-dim/30 hover:bg-surface-muted"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-faint">
                      {arc.era}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${
                        arc.status === "ongoing"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-surface-muted text-ink-dim"
                      }`}
                    >
                      {arc.status === "ongoing" ? "Ongoing" : "Complete"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl tracking-tight text-ink group-hover:text-accent">
                      {arc.title}
                    </h3>
                    <span className="font-mono text-xs text-ink-faint">
                      {formatEpisodeRange(arc)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm font-medium text-accent">
                    {arc.tagline}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-ink-dim">
                    {arc.summary}
                  </p>

                  {/* Live per-arc progress */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-ink-faint">
                        {signedIn
                          ? `${progress.watched} / ${progress.total} watched`
                          : `${progress.total} episodes`}
                      </span>
                      <span className="font-mono text-[10px] text-ink-dim">
                        {progress.percent}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {arc.years}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {arc.keyCharacters.length} key figures
                    </span>
                    <span className="flex items-center gap-1">
                      <PlayCircle className="h-3.5 w-3.5" />
                      {arc.highlights.length} landmark eps
                    </span>
                  </div>
                </Link>
              </li>
              )
            })}
          </ol>
        </section>

        {/* Recurring threads */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <h2 className="font-display text-2xl tracking-tight text-ink">
              Recurring threads
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {RECURRING_THREADS.map((thread) => (
              <div
                key={thread.slug}
                className="rounded-lg border border-ink-dim/20 bg-surface p-5"
              >
                <h3 className="font-display text-lg tracking-tight text-ink">
                  {thread.title}
                </h3>
                <p className="mt-1 text-sm font-medium text-accent">
                  {thread.tagline}
                </p>
                <p className="mt-2 text-sm text-ink-dim">
                  {thread.description}
                </p>
                <p className="mt-3 font-mono text-xs text-ink-faint">
                  Start: {thread.starterEpisodes}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Watch guide */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-accent" />
            <h2 className="font-display text-2xl tracking-tight text-ink">
              New here? How to watch
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {WATCH_GUIDE.map((step) => (
              <div
                key={step.step}
                className="flex gap-4 rounded-lg border border-ink-dim/20 bg-surface p-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-sm text-white">
                  {step.step}
                </span>
                <div>
                  <h3 className="font-display text-base tracking-tight text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-dim">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-10 flex items-center gap-2 text-sm text-ink-faint">
          <ArrowRight className="h-4 w-4" />
          <span>
            Open any arc above for a detailed breakdown of its key episodes and
            characters.
          </span>
        </div>
      </div>
    </div>
  )
}
