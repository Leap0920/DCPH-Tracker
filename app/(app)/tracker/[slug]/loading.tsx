import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/**
 * Loading state for /tracker/[slug] — mirrors the TV-Time-style detail layout:
 * back link, hero image, badge/canon/title/meta, action row, synopsis,
 * community rating, then the prev/next nav bar.
 */
export default function Loading() {
  return (
    <SkeletonRegion className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <Skeleton className="mb-6 h-5 w-40" />

        <div className="overflow-hidden rounded-xl border border-ink-dim/20 bg-surface shadow-card">
          <Skeleton className="aspect-video w-full rounded-none" />

          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="mt-4 h-10 w-2/3 rounded-lg" />
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-dim/20 pt-6">
              <Skeleton className="h-10 w-40 rounded-lg" />
              <Skeleton className="h-10 w-36 rounded-lg" />
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>

            <div className="mt-6 space-y-3 border-t border-ink-dim/20 pt-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>

            <div className="mt-6 flex items-center gap-3 border-t border-ink-dim/20 pt-6">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between gap-4 border-t border-ink-dim/20 pt-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
