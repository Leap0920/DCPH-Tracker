import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { BadgeTable } from "@/components/admin/BadgeTable"
import { BadgeFormModal } from "@/components/admin/BadgeFormModal"
import { createBadge } from "@/lib/actions/admin-badges"
import { Award } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminBadgesPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: badges } = await supabase
    .from("badges")
    .select("*")
    .order("created_at", { ascending: false })

  const badgeList = badges ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-ink-dim" />
            <h1 className="font-display text-xl font-semibold text-ink">Badge Management</h1>
          </div>
          <p className="mt-1 text-sm text-ink-dim">
            Manage achievement badges and rewards granted to community members.
          </p>
        </div>
        <BadgeFormModal action={createBadge} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Total Badges</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">{badgeList.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Achievements</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">
            {badgeList.filter((b) => b.category === "achievement").length}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Milestones</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">
            {badgeList.filter((b) => b.category === "milestone").length}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <div className="text-xs font-mono text-ink-faint">Special Events</div>
          <div className="font-display text-2xl font-semibold text-ink mt-1">
            {badgeList.filter((b) => b.category === "special_event").length}
          </div>
        </div>
      </div>

      <BadgeTable badges={badgeList} />
    </div>
  )
}
