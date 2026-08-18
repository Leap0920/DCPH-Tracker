import Link from "next/link"
import { Plus } from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { ContentTable } from "@/components/admin/ContentTable"
import { ContentFilters } from "@/components/admin/ContentFilters"
import type { Database } from "@/types/database.types"

type ContentType = Database["public"]["Tables"]["content_entries"]["Row"]["type"]

export const dynamic = "force-dynamic"

const PAGE_SIZE = 30

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() ?? ""
  const type = sp.type && sp.type !== "all" ? sp.type : null
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()
  let query = supabase
    .from("content_entries")
    .select("*", { count: "exact" })
    .order("canon_order", { ascending: true })
    .range(from, to)

  if (type) query = query.eq("type", type as ContentType)
  if (q) query = query.or(`title.ilike.%${q}%,slug.ilike.%${q}%`)

  const { data: entries, count } = await query
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(p: number) {
    const usp = new URLSearchParams()
    if (q) usp.set("q", q)
    if (type) usp.set("type", type)
    usp.set("page", String(p))
    return `/admin/content?${usp.toString()}`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-sm tracking-tight text-ink-dim">
          Content ({total})
        </h2>
        <Link
          href="/admin/content/new"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-accent text-sm font-display text-white hover:bg-accent-bright"
        >
          <Plus className="h-4 w-4" />
          New entry
        </Link>
      </div>

      <ContentFilters />

      <ContentTable entries={entries ?? []} />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="h-9 px-3 inline-flex items-center rounded-lg border border-ink-dim/20 text-xs font-mono text-ink-dim hover:border-ink-dim/30">
              Prev
            </Link>
          ) : (
            <span className="h-9 px-3 inline-flex items-center rounded-lg border border-ink-dim/10 text-xs font-mono text-ink-faint">
              Prev
            </span>
          )}
          <span className="font-mono text-xs text-ink-dim">
            Page {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="h-9 px-3 inline-flex items-center rounded-lg border border-ink-dim/20 text-xs font-mono text-ink-dim hover:border-ink-dim/30">
              Next
            </Link>
          ) : (
            <span className="h-9 px-3 inline-flex items-center rounded-lg border border-ink-dim/10 text-xs font-mono text-ink-faint">
              Next
            </span>
          )}
        </div>
      )}
    </div>
  )
}
