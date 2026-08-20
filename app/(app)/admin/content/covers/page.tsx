import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { MissingCoversPanel } from "@/components/admin/MissingCoversPanel"

export const dynamic = "force-dynamic"

export default async function AdminMissingCoversPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: missingEntries } = await supabase
    .from("content_entries")
    .select("*")
    .is("image_url", null)
    .order("type", { ascending: true })
    .order("canon_order", { ascending: true })

  const entries = missingEntries ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-base font-medium tracking-tight text-ink">Missing Covers</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-dim">
            Content entries with no cover poster image. Paste an image URL or upload a file directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Missing
          </span>
          <span className="inline-flex items-center rounded-md border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-warning">
            {entries.length}
          </span>
        </div>
      </div>

      <MissingCoversPanel entries={entries} />
    </div>
  )
}
