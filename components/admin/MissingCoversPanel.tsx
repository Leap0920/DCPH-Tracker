"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Upload, Check, Loader2, Link as LinkIcon } from "lucide-react"
import { updateContentCover } from "@/lib/actions/admin-content"
import { cleanImageUrl } from "@/lib/utils/image-url"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export function MissingCoversPanel({ entries }: { entries: ContentEntry[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  function handleUrlSubmit(e: React.FormEvent, id: string) {
    e.preventDefault()
    const rawUrl = urlInputs[id]?.trim()
    const url = cleanImageUrl(rawUrl)
    if (!url) return

    setEditingId(id)
    const formData = new FormData()
    formData.append("image_url", url)

    startTransition(async () => {
      const res = await updateContentCover(id, formData)
      setEditingId(null)
      if (res.ok) {
        setUrlInputs((prev) => ({ ...prev, [id]: "" }))
        router.refresh()
      } else {
        alert(res.error)
      }
    })
  }

  function handleFileSubmit(file: File, id: string) {
    setEditingId(id)
    const formData = new FormData()
    formData.append("cover_file", file)

    startTransition(async () => {
      const res = await updateContentCover(id, formData)
      setEditingId(null)
      if (res.ok) {
        router.refresh()
      } else {
        alert(res.error)
      }
    })
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface p-10 text-center">
        <Check className="mx-auto mb-3 h-5 w-5 text-success" />
        <h3 className="text-[13px] font-medium text-ink">All covers complete</h3>
        <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-ink-dim">
          Every content entry in the database currently has a cover image URL configured.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((item) => {
        const isUpdating = editingId === item.id
        const currentUrlInput = urlInputs[item.id] ?? ""

        return (
          <div
            key={item.id}
            className="flex flex-col justify-between rounded-md border border-line bg-surface p-3 transition-colors hover:bg-white/[0.03]"
          >
            <div>
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="inline-flex items-center rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-dim">
                  {item.type}
                </span>
                <span className="truncate font-mono text-[10px] text-ink-faint">{item.slug}</span>
              </div>

              <h4 className="mb-1 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                {item.title}
              </h4>
              <p className="mb-3 font-mono text-[10px] tabular-nums text-ink-faint">
                {item.air_date ? new Date(item.air_date).toLocaleDateString() : "Unknown air date"}
              </p>
            </div>

            <div className="space-y-2.5 border-t border-line pt-3">
              {/* Option A: Paste URL */}
              <form onSubmit={(e) => handleUrlSubmit(e, item.id)} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="url"
                    value={currentUrlInput}
                    onChange={(e) => setUrlInputs({ ...urlInputs, [item.id]: e.target.value })}
                    placeholder="Paste image URL…"
                    disabled={isUpdating}
                    className="h-8 w-full rounded-md border border-line bg-surface pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/30 disabled:opacity-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isUpdating || !currentUrlInput.trim()}
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-line px-2.5 font-mono text-[10px] uppercase tracking-wide text-ink-dim transition-colors hover:bg-white/[0.03] hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-40"
                >
                  {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </button>
              </form>

              {/* Option B: File Upload */}
              <div className="flex items-center justify-between">
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint transition-colors hover:text-ink">
                  <Upload className="h-3 w-3" />
                  <span>Upload file</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isUpdating}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSubmit(file, item.id)
                    }}
                    className="hidden"
                  />
                </label>
                {isUpdating && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
