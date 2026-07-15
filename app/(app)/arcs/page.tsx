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

export default function ArcsPage() {
  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 004 — STORY ARCS</span>
          <span className="redacted-bar w-16" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-gray-900">
          Story Arcs &amp; Watch Guide
        </h1>
        <p className="mt-2 max-w-2xl text-gray-500">
          The full main plot of Detective Conan — from Season 1 to the latest
          episode — and how to actually watch it without drowning in 1,100+
          episodes.
        </p>

        {/* Premise */}
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#7A1620]/10 text-[#7A1620]">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl uppercase tracking-wide text-gray-900">
                {SERIES_PREMISE.title}
              </h2>
              <p className="mt-2 text-sm text-gray-600">{SERIES_PREMISE.intro}</p>
              <p className="mt-2 text-sm text-gray-500">{SERIES_PREMISE.body}</p>
            </div>
          </div>
        </div>

        {/* How the story works */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Compass className="h-5 w-5 text-[#7A1620]" />
            <h2 className="font-display text-2xl uppercase tracking-wide text-gray-900">
              How the story works
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <h3 className="font-display text-base uppercase tracking-wide text-gray-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-gray-500">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Main plot timeline */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#7A1620]" />
            <h2 className="font-display text-2xl uppercase tracking-wide text-gray-900">
              The main plot — S1 to latest
            </h2>
          </div>
          <p className="mb-6 text-sm text-gray-500">
            Seven eras, each named for the Black Organization member in focus.
            Episode ranges use the original Japanese numbering.
          </p>

          <ol className="relative space-y-4 border-l border-gray-200 pl-6">
            {STORY_ARCS.map((arc) => (
              <li key={arc.slug} className="relative">
                <span className="absolute -left-[31px] top-5 h-3 w-3 rounded-full border-2 border-[#7A1620] bg-white" />
                <Link
                  href={`/arcs/${arc.slug}`}
                  className="group block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs uppercase tracking-wide text-gray-400">
                      {arc.era}
                    </span>
                    <span
                      className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                        arc.status === "ongoing"
                          ? "bg-green-50 text-green-600"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {arc.status === "ongoing" ? "Ongoing" : "Complete"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl uppercase tracking-wide text-gray-900 group-hover:text-[#7A1620]">
                      {arc.title}
                    </h3>
                    <span className="font-mono text-xs text-gray-400">
                      {formatEpisodeRange(arc)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm font-medium text-[#7A1620]">
                    {arc.tagline}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-gray-500">
                    {arc.summary}
                  </p>

                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
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
            ))}
          </ol>
        </section>

        {/* Recurring threads */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#7A1620]" />
            <h2 className="font-display text-2xl uppercase tracking-wide text-gray-900">
              Recurring threads
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {RECURRING_THREADS.map((thread) => (
              <div
                key={thread.slug}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <h3 className="font-display text-lg uppercase tracking-wide text-gray-900">
                  {thread.title}
                </h3>
                <p className="mt-1 text-sm font-medium text-[#7A1620]">
                  {thread.tagline}
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  {thread.description}
                </p>
                <p className="mt-3 font-mono text-xs text-gray-400">
                  Start: {thread.starterEpisodes}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Watch guide */}
        <section className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-[#7A1620]" />
            <h2 className="font-display text-2xl uppercase tracking-wide text-gray-900">
              New here? How to watch
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {WATCH_GUIDE.map((step) => (
              <div
                key={step.step}
                className="flex gap-4 rounded-lg border border-gray-200 bg-white p-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7A1620] font-mono text-sm text-white">
                  {step.step}
                </span>
                <div>
                  <h3 className="font-display text-base uppercase tracking-wide text-gray-900">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-10 flex items-center gap-2 text-sm text-gray-400">
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
