"use client"

import dynamic from "next/dynamic"
import type { Database } from "@/types/database.types"
import type { ActionResult } from "@/lib/actions/admin-content"

/**
 * Lazy host for the 709-line content editor. The admin editor mounts after the
 * page frame, so first load drops the whole form UI (with its image tooling).
 */
const ContentForm = dynamic(
  () => import("@/components/admin/ContentForm").then((m) => m.ContentForm),
  {
    ssr: false,
    loading: () => (
      <div className="max-w-3xl space-y-5 rounded-xl border border-line bg-surface p-6" aria-busy="true">
        <div className="h-6 w-1/3 rounded bg-surface-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-surface-muted animate-pulse" />
              <div className="h-10 rounded-lg bg-surface-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-32 rounded-lg bg-surface-muted animate-pulse" />
        <div className="h-10 w-36 rounded-full bg-surface-muted animate-pulse" />
      </div>
    ),
  }
)

export function ContentFormLoader({
  entry,
  action,
}: {
  entry?: Database["public"]["Tables"]["content_entries"]["Row"]
  action: (formData: FormData) => Promise<ActionResult>
}) {
  return <ContentForm entry={entry} action={action} />
}
