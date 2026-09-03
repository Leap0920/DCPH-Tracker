"use client"

import dynamic from "next/dynamic"

/**
 * Lazy host for the approval queue (517 lines of review UI). Admin pages are
 * rarely the performance-critical route, but this keeps the queue's chunk out
 * of the sync page's first load for no visual cost beyond a brief skeleton.
 */
const SyncApprovalQueue = dynamic(
  () =>
    import("@/components/admin/SyncApprovalQueue").then(
      (m) => m.SyncApprovalQueue
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3" aria-busy="true">
        <div className="flex items-center justify-between">
          <div className="h-5 w-48 rounded bg-surface-muted animate-pulse" />
          <div className="h-9 w-28 rounded-lg bg-surface-muted animate-pulse" />
        </div>
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-line bg-surface p-4 animate-pulse"
          />
        ))}
      </div>
    ),
  }
)

export function SyncApprovalQueueLoader({ items }: { items: any[] }) {
  return <SyncApprovalQueue items={items} />
}
