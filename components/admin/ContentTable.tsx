"use client"

import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { Pencil } from "lucide-react"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { DeleteContentButton } from "@/components/admin/DeleteContentButton"
import { CategorySelect } from "@/components/admin/CategorySelect"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

const thCls = "px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint"

function typeLabel(t: string) {
  return CONTENT_TYPE_LABELS[t as ContentType] ?? t
}

function numberFor(e: ContentEntry) {
  if (e.type === "episode" && e.episode_number != null) return `EP ${e.episode_number}`
  if (e.type === "movie" && e.movie_number != null) return `MOV ${e.movie_number}`
  return "—"
}

export function ContentTable({ entries }: { entries: ContentEntry[] }) {
  const searchParams = useSearchParams()
  const preservedQuery = searchParams.toString()
  const editHrefSuffix = preservedQuery ? `?${preservedQuery}` : ""

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface px-6 py-16 text-center">
        <p className="text-sm text-ink-dim">No entries match your filters.</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          Adjust the search or type filter
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className={thCls}>
              Cover
            </th>
            <th scope="col" className={thCls}>
              Title
            </th>
            <th scope="col" className={thCls}>
              Category / Relocate
            </th>
            <th scope="col" className={thCls}>
              Type
            </th>
            <th scope="col" className={thCls}>
              No.
            </th>
            <th scope="col" className={thCls}>
              Air date
            </th>
            <th scope="col" className={`${thCls} text-right`}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((e) => (
            <tr key={e.id} className="transition-colors hover:bg-white/[0.03]">
              <td className="px-3 py-2">
                <div className="relative flex h-10 w-16 items-center justify-center overflow-hidden rounded-md border border-line bg-surface">
                  {e.image_url ? (
                    <Image
                      src={e.image_url}
                      alt=""
                      fill
                      sizes="64px"
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                      none
                    </span>
                  )}
                </div>
              </td>
              <td className="max-w-xs px-3 py-2">
                <span className="block truncate text-ink">{e.title}</span>
                <span className="block truncate font-mono text-[11px] text-ink-faint">{e.slug}</span>
              </td>
              <td className="px-3 py-2">
                <CategorySelect id={e.id} currentType={e.type as ContentType} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="inline-flex items-center rounded-md border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-dim">
                  {typeLabel(e.type)}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-ink-dim">
                {numberFor(e)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-ink-dim">
                {e.air_date ?? "—"}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/admin/content/${e.id}${editHrefSuffix}`}
                    aria-label={`Edit ${e.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
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
