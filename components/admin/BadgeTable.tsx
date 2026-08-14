"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Award, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BadgeFormModal } from "./BadgeFormModal"
import { updateBadge, deleteBadge } from "@/lib/actions/admin-badges"
import type { Database } from "@/types/database.types"

type BadgeRow = Database["public"]["Tables"]["badges"]["Row"]

const CATEGORY_COLORS: Record<string, string> = {
  achievement: "bg-blue-50 text-blue-700 border-blue-200",
  milestone: "bg-purple-50 text-purple-700 border-purple-200",
  special_event: "bg-amber-50 text-amber-700 border-amber-200",
  community: "bg-green-50 text-green-700 border-green-200",
}

export function BadgeTable({ badges }: { badges: BadgeRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete badge "${name}"?`)) return
    setPendingId(id)
    deleteBadge(id).then((res) => {
      setPendingId(null)
      if (res.ok) router.refresh()
      else alert(res.error)
    })
  }

  if (badges.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center shadow-card">
        <Award className="mx-auto h-10 w-10 text-ink-faint mb-3" />
        <h3 className="font-display text-base text-ink font-semibold">No Badges Found</h3>
        <p className="mt-1 text-sm text-ink-dim max-w-sm mx-auto">
          Create achievement or milestone badges to reward detectives for watching episodes, movies, and participating in the community.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-surface-muted/50 font-display text-xs text-ink-dim uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Badge</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {badges.map((b) => {
            const isDeleting = pendingId === b.id
            const catCls = CATEGORY_COLORS[b.category] ?? "bg-slate-50 text-slate-700 border-slate-200"
            return (
              <tr key={b.id} className="hover:bg-surface-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {b.icon_url ? (
                      <img
                        src={b.icon_url}
                        alt={b.name}
                        className="h-10 w-10 rounded-full object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                        <Award className="h-5 w-5" />
                      </div>
                    )}
                    <div>
                      <div className="font-display text-sm font-semibold text-ink">{b.name}</div>
                      <div className="font-mono text-[11px] text-ink-faint">{b.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${catCls}`}>
                    {b.category}
                  </span>
                </td>
                <td className="px-4 py-3 max-w-md">
                  <p className="line-clamp-2 text-xs text-ink-dim">
                    {b.description || <span className="italic text-ink-faint">No description set</span>}
                  </p>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    <BadgeFormModal badge={b} action={(formData) => updateBadge(b.id, formData)} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(b.id, b.name)}
                      disabled={isDeleting}
                      className="gap-1 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
