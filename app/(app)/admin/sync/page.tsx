import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { SyncPanel } from "@/components/admin/SyncPanel"
import { SyncApprovalQueue } from "@/components/admin/SyncApprovalQueue"

export const dynamic = "force-dynamic"

export default async function AdminSyncPage() {
  await requireAdmin()
  const supabase = await createClient()

  let stagedItems: any[] = []
  try {
    const { data } = await supabase
      .from("sync_staging")
      .select("*")
      .order("created_at", { ascending: false })
    stagedItems = data ?? []
  } catch {
    // If sync_staging table is not yet created, stagedItems stays []
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">API Sync & Approval Queue</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Fetch new episodes and franchise metadata from external APIs, review incoming items, and publish approved content to the official tracker.
        </p>
      </div>

      <SyncApprovalQueue items={stagedItems} />

      <div className="pt-6 border-t border-slate-200">
        <h2 className="font-display text-base font-semibold text-ink mb-4">
          Manual API Sync Controls
        </h2>
        <SyncPanel />
      </div>
    </div>
  )
}
