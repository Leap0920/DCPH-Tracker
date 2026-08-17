"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ArcFormModal } from "./ArcFormModal"
import { updateArc, deleteArc } from "@/lib/actions/admin-arcs"
import type { Database } from "@/types/database.types"

type ArcRow = Database["public"]["Tables"]["arcs"]["Row"]

export function ArcTable({ arcs }: { arcs: ArcRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function handleDelete(id: string, title: string) {
    if (!confirm(`Are you sure you want to delete story arc "${title}"?`)) return
    setPendingId(id)
    deleteArc(id).then((res) => {
      setPendingId(null)
      if (res.ok) router.refresh()
      else alert(res.error)
    })
  }

  if (arcs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-surface p-12 text-center shadow-card">
        <BookOpen className="mx-auto h-10 w-10 text-ink-faint mb-3" />
        <h3 className="font-display text-base text-ink font-semibold">No Story Arcs Found</h3>
        <p className="mt-1 text-sm text-ink-dim max-w-sm mx-auto">
          Create story arcs (e.g. Clash of Red and Black, Vermouth Arc) to group episodes logically for detectives.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-surface-muted/50 font-display text-xs text-ink-dim uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Arc Title</th>
            <th className="px-4 py-3">Episode Range</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {arcs.map((arc) => {
            const isDeleting = pendingId === arc.id
            const episodeCount = arc.end_episode - arc.start_episode + 1
            return (
              <tr key={arc.id} className="hover:bg-surface-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {arc.image_url ? (
                      <img
                        src={arc.image_url}
                        alt={arc.title}
                        className="h-10 w-10 rounded-md object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-ink-faint border border-slate-200">
                        <BookOpen className="h-5 w-5" />
                      </div>
                    )}
                    <div>
                      <div className="font-display text-sm font-semibold text-ink">{arc.title}</div>
                      <div className="font-mono text-[11px] text-ink-faint">{arc.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-mono font-medium text-slate-700">
                    Ep {arc.start_episode} to {arc.end_episode} ({episodeCount} eps)
                  </span>
                </td>
                <td className="px-4 py-3 max-w-md">
                  <p className="line-clamp-2 text-xs text-ink-dim">
                    {arc.description || <span className="italic text-ink-faint">No description set</span>}
                  </p>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    <ArcFormModal arc={arc} action={(formData) => updateArc(arc.id, formData)} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(arc.id, arc.title)}
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
