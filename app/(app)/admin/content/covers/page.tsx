import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { MissingCoversPanel } from "@/components/admin/MissingCoversPanel"
import { Image as ImageIcon } from "lucide-react"

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
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-line pb-5">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-warning" />
          <h1 className="font-display text-xl font-semibold text-ink">Missing Cover Quick-Fix Panel</h1>
        </div>
        <p className="text-sm text-ink-dim">
          Direct queue of all content entries missing cover poster images. Paste image URLs or upload files directly.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/20 text-warning font-mono text-sm font-semibold">
            {entries.length}
          </span>
          <div className="text-sm text-warning font-display">
            Entries currently missing poster artwork
          </div>
        </div>
      </div>

      <MissingCoversPanel entries={entries} />
    </div>
  )
}
