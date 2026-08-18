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
