/**
 * Streaming skeleton for /search — the page is force-dynamic and runs three
 * Supabase searches before first paint, so navigation shows this immediately
 * instead of a blank frame.
 */

function ShimmerCard({ tall = false }: { tall?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
      <div
        className={`shrink-0 rounded-md bg-surface-muted ${
          tall ? "h-14 w-20" : "h-9 w-9 rounded-full"
        } animate-pulse`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-24 rounded bg-surface-muted animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-surface-muted/70 animate-pulse" />
      </div>
    </div>
  )
}

export default function SearchLoading() {
  return (
    <div className="px-6 py-10" aria-busy="true" aria-label="Loading search">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">GLOBAL SEARCH · CASE INDEX</span>
          <span className="redacted-bar w-16" />
        </div>

        <div className="h-9 w-28 rounded bg-surface-muted animate-pulse" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-muted/70 animate-pulse" />

        {/* Search input placeholder */}
        <div className="mt-6 flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3">
          <div className="h-4 w-4 rounded-full border border-ink-faint/40 animate-pulse" />
          <div className="h-3 w-40 rounded bg-surface-muted animate-pulse" />
        </div>

        {/* Result sections */}
        <div className="mt-8 space-y-10" aria-hidden="true">
          <section>
            <div className="mb-4 h-4 w-24 rounded bg-surface-muted/80 animate-pulse" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <ShimmerCard tall />
              <ShimmerCard tall />
              <ShimmerCard tall />
              <ShimmerCard tall />
            </div>
          </section>

          <section>
            <div className="mb-4 h-4 w-28 rounded bg-surface-muted/80 animate-pulse" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <ShimmerCard />
              <ShimmerCard />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}