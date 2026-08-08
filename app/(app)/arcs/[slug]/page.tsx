import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  ArrowRight as ArrowRightIcon,
  Clock,
  Users,
  BookOpen,
} from "lucide-react"
import {
  getArcBySlug,
  getAdjacentArcs,
  formatEpisodeRange,
} from "@/lib/arcs-guide"
import { computeArcProgress, getArcProgressData } from "@/lib/arcs-progress"

export default async function ArcDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const arc = getArcBySlug(slug)

  if (!arc) {
    notFound()
  }

  const { prev, next } = getAdjacentArcs(slug)

  const { signedIn, watchedEpisodeNumbers } = await getArcProgressData()
  const progress = computeArcProgress(arc, watchedEpisodeNumbers)
  const nextEpisode = progress.nextUnwatchedEpisode

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/arcs"
          className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Story Arcs
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 004 — ARC {String(arc.order).padStart(2, "0")}</span>
          <span className="redacted-bar w-16" />
        </div>

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

        <h1 className="mt-2 font-display text-3xl sm:text-4xl uppercase tracking-wide text-gray-900">
          {arc.title}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1.5 font-mono">
            <BookOpen className="h-4 w-4" />
            {formatEpisodeRange(arc)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {arc.years}
          </span>
          <span className="font-mono text-xs text-gray-400">
            {arc.mangaRange}
          </span>
        </div>

        <p className="mt-3 text-base font-medium text-[#7A1620]">
          {arc.tagline}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          {arc.summary}
        </p>

        {/* Live per-arc progress */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-sm uppercase tracking-wider text-gray-900">
              Your progress in this arc
            </span>
            <span className="font-mono text-xs text-gray-500">
              {progress.watched} / {progress.total} · {progress.percent}%
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#7A1620] rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            {signedIn && nextEpisode !== null ? (
              <Link
                href={`/tracker?ep=${nextEpisode}`}
                className="inline-flex items-center gap-1.5 rounded-sm bg-[#7A1620] px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-white transition-colors hover:bg-[#5d0f17]"
              >
                Continue at Ep {nextEpisode}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : signedIn && nextEpisode === null ? (
              <span className="text-xs font-mono uppercase tracking-wider text-green-600">
                Arc complete — nice work!
              </span>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-sm border border-gray-300 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900"
              >
                Sign in to track progress
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Key characters */}
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl uppercase tracking-wide text-gray-900">
            <Users className="h-4 w-4 text-[#7A1620]" />
            Key figures
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {arc.keyCharacters.map((c) => (
              <div
                key={c.name}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <p className="font-medium text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500">{c.role}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Landmark episodes */}
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl uppercase tracking-wide text-gray-900">
            <PlayIcon />
            Landmark episodes
          </h2>
          <div className="space-y-3">
            {arc.highlights.map((h) => (
              <div
                key={h.title}
                className="rounded-lg border-l-2 border-[#7A1620] bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-gray-900">{h.title}</p>
                  <span className="font-mono text-xs text-gray-400">
                    Ep {h.episodes}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{h.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Prev / Next */}
        <nav className="mt-12 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/arcs/${prev.slug}`}
              className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
                Previous arc
              </span>
              <span className="mt-1 font-display text-sm uppercase tracking-wide text-gray-900 group-hover:text-[#7A1620]">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}

          {next ? (
            <Link
              href={`/arcs/${next.slug}`}
              className="group flex flex-col items-end rounded-lg border border-gray-200 bg-white p-4 text-right transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <span className="flex items-center gap-1 text-xs text-gray-400">
                Next arc
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </span>
              <span className="mt-1 font-display text-sm uppercase tracking-wide text-gray-900 group-hover:text-[#7A1620]">
                {next.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 text-[#7A1620]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  )
}
