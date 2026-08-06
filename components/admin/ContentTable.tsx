"use client"

import Link from "next/link"
import { Pencil } from "lucide-react"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { DeleteContentButton } from "@/components/admin/DeleteContentButton"
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
      <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        No entries match your filters.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Cover</th>
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Title</th>
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Type</th>
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">No.</th>
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Air date</th>
            <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="p-3">
                <div className="h-10 w-16 overflow-hidden rounded border border-gray-200 bg-gray-100 flex items-center justify-center">
                  {e.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[9px] font-mono uppercase text-red-400">none</span>
                  )}
                </div>
              </td>
              <td className="p-3 max-w-xs">
                <span className="block truncate font-medium text-gray-900">{e.title}</span>
                <span className="block truncate font-mono text-[11px] text-gray-400">{e.slug}</span>
              </td>
              <td className="p-3 text-gray-600">{typeLabel(e.type)}</td>
              <td className="p-3 font-mono text-xs text-gray-500">{numberFor(e)}</td>
              <td className="p-3 font-mono text-xs text-gray-500">{e.air_date}</td>
              <td className="p-3">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/admin/content/${e.id}`}
                    aria-label={`Edit ${e.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900"
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
