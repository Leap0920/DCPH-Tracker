export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading admin data…</span>

      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-surface-muted/70" />
      </div>

      <div>
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-surface-muted/70" />
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-r border-line p-4 last:border-r-0 sm:p-5"
            >
              <div className="mb-3 h-3 w-20 animate-pulse rounded bg-surface-muted/70" />
              <div className="h-7 w-14 animate-pulse rounded bg-surface-muted" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 h-3 w-28 animate-pulse rounded bg-surface-muted/70" />
        <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-surface-muted" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-56 max-w-full animate-pulse rounded bg-surface-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
