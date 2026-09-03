"use client"

import dynamic from "next/dynamic"
import type { SelfAnalytics } from "@/lib/queries/analytics"

/**
 * Lazy host for the charts dashboard. The page shell (server-computed stats)
 * paints first, then the dashboard chunk hydrates — /analytics no longer ships
 * the whole 696-line chart component in its initial JS.
 */
const AnalyticsDashboard = dynamic(
  () =>
    import("@/components/analytics/AnalyticsDashboard").then(
      (m) => m.AnalyticsDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6" aria-busy="true">
        <div className="h-8 w-56 rounded bg-surface-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-line bg-surface p-4 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-line bg-surface animate-pulse" />
      </div>
    ),
  }
)

export function AnalyticsDashboardLoader({
  analytics,
}: {
  analytics: SelfAnalytics
}) {
  return <AnalyticsDashboard analytics={analytics} />
}
