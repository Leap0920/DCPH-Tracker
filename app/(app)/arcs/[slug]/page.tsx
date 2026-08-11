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
          className="mb-6 inline-flex items-center gap-2 text-sm text-ink-dim transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Story Arcs
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 004 ARC {String(arc.order).padStart(2, "0")}</span>
          <span className="redacted-bar w-16" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-faint">
            {arc.era}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${
              arc.status === "ongoing"
                ? "bg-green-50 text-green-600"
                : "bg-surface-muted text-ink-dim"
            }`}
          >
            {arc.status === "ongoing" ? "Ongoing" : "Complete"}
          </span>
        </div>

        <h1 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-ink">
          {arc.title}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-ink-dim">
          <span className="flex items-center gap-1.5 font-mono">
            <BookOpen className="h-4 w-4" />
            {formatEpisodeRange(arc)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {arc.years}
          </span>
          <span className="font-mono text-xs text-ink-faint">
            {arc.mangaRange}
          </span>
        </div>

        <p className="mt-3 text-base font-medium text-accent">
          {arc.tagline}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-dim">
          {arc.summary}
        </p>

        {/* Live per-arc progress */}
        <div className="mt-6 rounded-lg border border-slate-200 bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-sm tracking-tight text-ink">
              Your progress in this arc
            </span>
            <span className="font-mono text-xs text-ink-dim">
              {progress.watched} / {progress.total} · {progress.percent}%
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            {signedIn && nextEpisode !== null ? (
              <Link
                href={`/tracker?ep=${nextEpisode}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-mono text-white transition-colors hover:bg-accent-bright"
              >
                Continue at Ep {nextEpisode}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : signedIn && nextEpisode === null ? (
              <span className="text-xs font-mono text-green-600">
                Arc complete! Nice work!
              </span>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-mono text-ink-dim transition-colors hover:border-ink hover:text-ink"
              >
                Sign in to track progress
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Key characters */}
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl tracking-tight text-ink">
            <Users className="h-4 w-4 text-accent" />
            Key figures
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {arc.keyCharacters.map((c) => (
              <div
                key={c.name}
                className="rounded-lg border border-slate-200 bg-surface p-4"
              >
                <p className="font-medium text-ink">{c.name}</p>
                <p className="text-xs text-ink-dim">{c.role}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Landmark episodes */}
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl tracking-tight text-ink">
            <PlayIcon />
            Landmark episodes
          </h2>
          <div className="space-y-3">
            {arc.highlights.map((h) => (
              <div
                key={h.title}
                className="rounded-lg border-l-2 border-accent bg-surface p-4 shadow-card"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">{h.title}</p>
                  <span className="font-mono text-xs text-ink-faint">
                    Ep {h.episodes}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-dim">{h.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Prev / Next */}
        <nav className="mt-12 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/arcs/${prev.slug}`}
              className="group flex flex-col rounded-lg border border-slate-200 bg-surface p-4 transition-colors hover:border-slate-300 hover:bg-surface-muted"
            >
              <span className="flex items-center gap-1 text-xs text-ink-faint">
                <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
                Previous arc
              </span>
              <span className="mt-1 font-display text-sm tracking-tight text-ink group-hover:text-accent">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}

          {next ? (
            <Link
              href={`/arcs/${next.slug}`}
              className="group flex flex-col items-end rounded-lg border border-slate-200 bg-surface p-4 text-right transition-colors hover:border-slate-300 hover:bg-surface-muted"
            >
              <span className="flex items-center gap-1 text-xs text-ink-faint">
                Next arc
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </span>
              <span className="mt-1 font-display text-sm tracking-tight text-ink group-hover:text-accent">
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
      className="h-4 w-4 text-accent"
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
