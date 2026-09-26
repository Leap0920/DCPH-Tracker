import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { SyncPanel } from "@/components/admin/SyncPanel"
import { SyncApprovalQueueLoader } from "@/components/admin/SyncApprovalQueueLoader"

export const dynamic = "force-dynamic"

export default async function AdminSyncPage() {
  await requireAdmin()
  const supabase = await createClient()

  let stagedItems: any[] = []
  let readError: string | null = null
  try {
    const { data, error } = await supabase
      .from("sync_staging")
      .select("*")
      .order("created_at", { ascending: false })
    if (error) readError = error.message
    stagedItems = data ?? []
  } catch (err) {
    // The table may not be migrated yet — but say so instead of rendering an
    // empty queue, which reads as "nothing was staged" when the read failed.
    readError = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-line pb-4">
        <h1 className="text-base font-medium tracking-tight text-ink">API Sync &amp; Approval Queue</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-dim">
          Fetch new episodes and franchise metadata from external APIs, review incoming items, and
          publish approved content to the official tracker.
        </p>
      </div>

      {readError && (
        <div className="rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">
          The approval queue could not be read ({readError}). Anything staged is still in the
          database — reload once the error clears.
        </div>
      )}

      <SyncApprovalQueueLoader items={stagedItems} />

      <div className="space-y-3 border-t border-line pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          Manual API Sync Controls
        </h2>
        <SyncPanel />
      </div>
    </div>
  )
}
