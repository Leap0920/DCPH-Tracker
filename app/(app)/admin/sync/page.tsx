import { SyncPanel } from "@/components/admin/SyncPanel"

export const dynamic = "force-dynamic"

export default function AdminSyncPage() {
  return (
    <div className="space-y-5">
      <h2 className="font-display text-sm uppercase tracking-widest text-gray-500">
        Content sync
      </h2>
      <SyncPanel />
    </div>
  )
}
