import { SyncPanel } from "@/components/admin/SyncPanel"

export const dynamic = "force-dynamic"

export default function AdminSyncPage() {
  return (
    <div className="space-y-5">
      <h2 className="font-display text-sm tracking-tight text-ink-dim">
        Content sync
      </h2>
      <SyncPanel />
    </div>
  )
}
