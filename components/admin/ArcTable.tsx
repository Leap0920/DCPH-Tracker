"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { BookOpen, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ArcFormModal } from "./ArcFormModal"
import { updateArc, deleteArc } from "@/lib/actions/admin-arcs"
import type { Database } from "@/types/database.types"

type ArcRow = Database["public"]["Tables"]["arcs"]["Row"]

const thCls = "px-4 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint"

export function ArcTable({ arcs }: { arcs: ArcRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Delete story arc "${title}"? This cannot be undone.`)) return
    setPendingId(id)
    const res = await deleteArc(id)
    setPendingId(null)
    if (res.ok) router.refresh()
    else window.alert(res.error)
  }

  if (arcs.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface px-6 py-16 text-center">
        <BookOpen className="mx-auto mb-3 h-6 w-6 text-ink-faint" aria-hidden="true" />
        <h3 className="font-display text-sm text-ink">No story arcs yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-dim">
          Create story arcs (e.g. Clash of Red and Black, Vermouth Arc) to group episodes logically
          for detectives.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-white/[0.02] text-left">
            <th className={thCls}>Arc</th>
            <th className={thCls}>Range</th>
            <th className={thCls}>Episodes</th>
            <th className={thCls}>Description</th>
            <th className={`${thCls} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {arcs.map((arc) => {
            const isDeleting = pendingId === arc.id
            const episodeCount = arc.end_episode - arc.start_episode + 1
            return (
              <tr key={arc.id} className="transition-colors hover:bg-white/[0.03]">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    {arc.image_url ? (
                      <Image
                        src={arc.image_url}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        className="h-10 w-10 shrink-0 rounded-md border border-line object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-faint">
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-ink">{arc.title}</div>
                      <div className="truncate font-mono text-[11px] text-ink-faint">{arc.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span className="inline-flex items-center rounded-md border border-line px-2 py-0.5 font-mono text-[11px] tabular-nums text-ink-dim">
                    EP {arc.start_episode}–{arc.end_episode}
                  </span>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-faint">
                    {episodeCount} eps
                  </span>
                </td>
                <td className="max-w-md px-4 py-2">
                  <p className="line-clamp-2 text-xs text-ink-dim">
                    {arc.description || <span className="text-ink-faint">No description set</span>}
                  </p>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <ArcFormModal arc={arc} action={(formData) => updateArc(arc.id, formData)} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(arc.id, arc.title)}
                      disabled={isDeleting}
                      aria-label={`Delete ${arc.title}`}
                      className="h-8 border-line px-2 text-red-400 hover:bg-red-500/[0.06] hover:text-red-300"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
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
