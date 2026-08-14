"use client"

import Link from "next/link"
import { Pencil } from "lucide-react"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { DeleteContentButton } from "@/components/admin/DeleteContentButton"
import { CategorySelect } from "@/components/admin/CategorySelect"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

function typeLabel(t: string) {
  return CONTENT_TYPE_LABELS[t as ContentType] ?? t
}

function numberFor(e: ContentEntry) {
  if (e.type === "episode" && e.episode_number != null) return `EP ${e.episode_number}`
  if (e.type === "movie" && e.movie_number != null) return `MOV ${e.movie_number}`
  return "—"
}

export function ContentTable({ entries }: { entries: ContentEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-surface p-10 text-center text-sm text-ink-dim">
        No entries match your filters.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="p-3 font-mono text-[10px] text-ink-faint">Cover</th>
            <th className="p-3 font-mono text-[10px] text-ink-faint">Title</th>
            <th className="p-3 font-mono text-[10px] text-ink-faint">Category / Relocate</th>
            <th className="p-3 font-mono text-[10px] text-ink-faint">No.</th>
            <th className="p-3 font-mono text-[10px] text-ink-faint">Air date</th>
            <th className="p-3 font-mono text-[10px] text-ink-faint text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-surface-muted">
              <td className="p-3">
                <div className="h-10 w-16 overflow-hidden rounded border border-slate-200 bg-surface-muted flex items-center justify-center">
                  {e.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[9px] font-mono text-red-400">none</span>
                  )}
                </div>
              </td>
              <td className="p-3 max-w-xs">
                <span className="block truncate font-medium text-ink">{e.title}</span>
                <span className="block truncate font-mono text-[11px] text-ink-faint">{e.slug}</span>
              </td>
              <td className="p-3">
                <CategorySelect id={e.id} currentType={e.type as ContentType} />
              </td>
              <td className="p-3 font-mono text-xs text-ink-dim">{numberFor(e)}</td>
              <td className="p-3 font-mono text-xs text-ink-dim">{e.air_date}</td>
              <td className="p-3">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/admin/content/${e.id}`}
                    aria-label={`Edit ${e.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint hover:bg-surface-muted hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                  <DeleteContentButton id={e.id} title={e.title} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
