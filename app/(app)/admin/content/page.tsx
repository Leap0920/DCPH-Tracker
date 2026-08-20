import Link from "next/link"
import { Plus, ChevronLeft, ChevronRight, FileQuestion } from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { ContentTable } from "@/components/admin/ContentTable"
import { ContentFilters } from "@/components/admin/ContentFilters"
import type { Database } from "@/types/database.types"

type ContentType = Database["public"]["Tables"]["content_entries"]["Row"]["type"]

export const dynamic = "force-dynamic"

const PAGE_SIZE = 30
const nf = new Intl.NumberFormat("en-US")

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
  const rows = entries ?? []
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : from + 1
  const rangeEnd = Math.min(from + rows.length, total)
  const filtered = Boolean(q || type)

  function pageHref(p: number) {
    const usp = new URLSearchParams()
    if (q) usp.set("q", q)
    if (type) usp.set("type", type)
    usp.set("page", String(p))
    return `/admin/content?${usp.toString()}`
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-xl tracking-tight text-ink">Content</h1>
          <p className="font-mono text-[11px] tabular-nums text-ink-dim">
            {nf.format(total)} {total === 1 ? "entry" : "entries"}
            {filtered ? " matching filters" : ""}
          </p>
        </div>

        <Link
          href="/admin/content/new"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-display tracking-tight text-white transition-colors hover:bg-accent-bright focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          <Plus className="h-3.5 w-3.5" />
          New entry
        </Link>
      </header>

      <ContentFilters />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-line px-6 py-16 text-center">
          <FileQuestion className="h-5 w-5 text-ink-faint" />
          <p className="font-display text-[13px] tracking-tight text-ink">
            {filtered ? "No entries match those filters" : "No content yet"}
          </p>
          <p className="max-w-sm text-[12px] text-ink-dim">
            {filtered
              ? "Try a broader search term or reset the type filter."
              : "Create your first entry or run an API sync to populate the catalog."}
          </p>
          {filtered ? (
            <Link
              href="/admin/content"
              className="mt-2 inline-flex h-8 items-center rounded-md border border-line px-3 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink-faint/40 hover:text-ink"
            >
              Clear filters
            </Link>
          ) : (
            <Link
              href="/admin/sync"
              className="mt-2 inline-flex h-8 items-center rounded-md border border-line px-3 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink-faint/40 hover:text-ink"
            >
              Go to sync
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <ContentTable entries={rows} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="font-mono text-[11px] tabular-nums text-ink-faint">
            {nf.format(rangeStart)}–{nf.format(rangeEnd)} of {nf.format(total)}
          </p>

          {totalPages > 1 && (
            <nav aria-label="Pagination" className="flex items-center gap-1.5">
              <PageButton
                href={page > 1 ? pageHref(page - 1) : undefined}
                label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </PageButton>

              <span className="px-1 font-mono text-[11px] tabular-nums text-ink-dim">
                {page} / {totalPages}
              </span>

              <PageButton
                href={page < totalPages ? pageHref(page + 1) : undefined}
                label="Next page"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </PageButton>
            </nav>
          )}
        </div>
      )}
    </div>
  )
}

function PageButton({
  href,
  label,
  children,
}: {
  href?: string
  label: string
  children: React.ReactNode
}) {
  const base =
    "inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 font-mono text-[11px] transition-colors"

  if (!href) {
    return (
      <span
        aria-disabled="true"
        className={base + " cursor-not-allowed text-ink-faint/50"}
      >
        {children}
      </span>
    )
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={
        base +
        " text-ink-dim hover:border-ink-faint/40 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
      }
    >
      {children}
    </Link>
  )
}
