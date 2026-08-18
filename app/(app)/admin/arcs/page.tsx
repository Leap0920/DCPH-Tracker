import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { ArcTable } from "@/components/admin/ArcTable"
import { ArcFormModal } from "@/components/admin/ArcFormModal"
import { createArc } from "@/lib/actions/admin-arcs"
import { BookOpen } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminArcsPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: arcs } = await supabase
    .from("arcs")
    .select("*")
    .order("start_episode", { ascending: true })

  const arcList = arcs ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-ink-dim/20 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-ink-dim" />
            <h1 className="font-display text-xl font-semibold text-ink">Story Arcs Management</h1>
          </div>
          <p className="mt-1 text-sm text-ink-dim">
            Organize episodes into canonical storyline arcs (e.g. Clash of Red and Black, Vermouth Arc).
          </p>
        </div>
        <ArcFormModal action={createArc} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Total Story Arcs</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">{arcList.length}</div>
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Lowest Episode</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">
            {arcList.length > 0 ? `Ep ${Math.min(...arcList.map((a) => a.start_episode))}` : "N/A"}
          </div>
        </div>
        <div className="rounded-lg border border-ink-dim/20 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Highest Episode</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">
            {arcList.length > 0 ? `Ep ${Math.max(...arcList.map((a) => a.end_episode))}` : "N/A"}
          </div>
        </div>
      </div>

      <ArcTable arcs={arcList} />
    </div>
  )
}
