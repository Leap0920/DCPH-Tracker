import { cn } from "@/lib/utils"

/**
 * Base skeleton primitive — design tokens only (surface-muted blocks,
 * animate-pulse), with an aria-busy status container so screen readers
 * announce loading state.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-muted", className)}
    />
  )
}

/** Wrapper that marks the section as busy while content is loading. */
export function SkeletonRegion({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Composed page skeletons (mirror the real page structure)
// ─────────────────────────────────────────────────────────

/** /tracker — stat cards + progress bar + content grid */
export function TrackerSkeleton() {
  return (
    <SkeletonRegion className="px-0 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg border border-ink-dim/20 bg-surface" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-4 shadow-card">
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /tracker/[slug] — content detail page */
export function ContentDetailSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg border border-ink-dim/20 bg-surface" />
          ))}
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-2 h-4 w-4/6" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /analytics — stat tiles + section cards */
export function AnalyticsSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-9 w-56" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg border border-ink-dim/20 bg-surface" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-lg border border-ink-dim/20 bg-surface" />
          <Skeleton className="h-64 rounded-lg border border-ink-dim/20 bg-surface" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /community/rankings — podium + leaderboard rows */
export function RankingsSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-9 w-64" />
        </div>
        <div className="flex items-end justify-center gap-4 pt-4">
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className={cn(
                "w-24 rounded-t-lg border border-ink-dim/20 bg-surface",
                i === 0 ? "h-28" : i === 1 ? "h-36" : "h-24"
              )}
            />
          ))}
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface shadow-card">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-5 w-8" />
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /profile/[username] — dossier card + stats grid */
export function ProfileSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card">
          <div className="flex items-center gap-5">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg border border-ink-dim/20 bg-surface" />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /community/chat/[room] — chat window bubbles */
export function ChatSkeletonLayout() {
  return (
    <SkeletonRegion className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <header className="border-b border-ink-dim/20 bg-surface px-4 py-3">
        <Skeleton className="h-6 w-40" />
      </header>
      <div className="flex-1 space-y-4 overflow-hidden px-4 py-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "" : "flex-row-reverse")}>
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className={cn("h-10 rounded-lg", i % 2 === 0 ? "w-3/5" : "w-2/5")} />
          </div>
        ))}
      </div>
      <div className="border-t border-ink-dim/20 bg-surface p-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </SkeletonRegion>
  )
}

/** /settings — form cards */
export function SettingsSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-9 w-40" />
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card">
          <div className="flex items-center gap-5">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card">
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /arcs + /arcs/[slug] — arc cards */
export function ArcsSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-9 w-56" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg border border-ink-dim/20 bg-surface" />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** /admin/* — admin panels */
export function AdminSkeleton() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-9 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface shadow-card">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/* ------------------------------------------------------------------ */
/* Favorites                                                           */
/* ------------------------------------------------------------------ */

export function FavoritesSkeleton() {
  return (
    <SkeletonRegion className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <Skeleton className="aspect-[2/3] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <div className="flex items-center gap-2 pt-1">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-10 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

export function CharactersSkeleton() {
  return (
    <SkeletonRegion className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface p-5"
          >
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1 h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

export function CasesSkeleton() {
  return (
    <SkeletonRegion className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-line bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-16 w-16 shrink-0 rounded-lg sm:block" />
            </div>
            <div className="mt-4 flex items-center gap-4 border-t border-line pt-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="ml-auto h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
