import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { ArcTable } from "@/components/admin/ArcTable"
import { ArcFormModal } from "@/components/admin/ArcFormModal"
import { createArc } from "@/lib/actions/admin-arcs"

export const dynamic = "force-dynamic"

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1 font-display text-2xl tabular-nums text-ink">{value}</div>
    </div>
  )
}

export default async function AdminArcsPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: arcs } = await supabase
    .from("arcs")
    .select("*")
    .order("start_episode", { ascending: true })

  const arcList = arcs ?? []
  const lowest = arcList.length > 0 ? Math.min(...arcList.map((a) => a.start_episode)) : null
  const highest = arcList.length > 0 ? Math.max(...arcList.map((a) => a.end_episode)) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl text-ink">Story Arcs</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Organize episodes into canonical storyline arcs (e.g. Clash of Red and Black, Vermouth
            Arc).
          </p>
        </div>
        <ArcFormModal action={createArc} />
      </div>

      <div className="grid grid-cols-1 divide-y divide-line rounded-md border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Total arcs" value={String(arcList.length)} />
        <Stat label="Lowest episode" value={lowest !== null ? `EP ${lowest}` : "—"} />
        <Stat label="Highest episode" value={highest !== null ? `EP ${highest}` : "—"} />
      </div>

      <ArcTable arcs={arcList} />
    </div>
  )
}
