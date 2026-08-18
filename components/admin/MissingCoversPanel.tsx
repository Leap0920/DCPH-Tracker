"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Image as ImageIcon, Upload, Check, Loader2, Link as LinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
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
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-12 text-center shadow-card">
        <Check className="mx-auto h-12 w-12 text-green-400 mb-3" />
        <h3 className="font-display text-lg text-green-800 font-semibold">All Covers Complete!</h3>
        <p className="mt-1 text-sm text-green-400 max-w-sm mx-auto">
          Every content entry in the database currently has a cover image URL configured. Great work!
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((item) => {
        const isUpdating = editingId === item.id
        const currentUrlInput = urlInputs[item.id] ?? ""

        return (
          <div
            key={item.id}
            className="flex flex-col justify-between rounded-xl border border-ink-dim/20 bg-surface p-4 shadow-card hover:border-ink-dim/30 transition-colors"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-400 border border-amber-500/30 uppercase">
                  {item.type}
                </span>
                <span className="font-mono text-xs text-ink-faint">{item.slug}</span>
              </div>

              <h4 className="font-display text-sm font-semibold text-ink line-clamp-2 mb-1">
                {item.title}
              </h4>
              <p className="text-xs text-ink-dim mb-3">
                Air Date: {item.air_date ? new Date(item.air_date).toLocaleDateString() : "Unknown"}
              </p>
            </div>

            <div className="space-y-3 pt-3 border-t border-ink-dim/10">
              {/* Option A: Paste URL */}
              <form onSubmit={(e) => handleUrlSubmit(e, item.id)} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="url"
                    value={currentUrlInput}
                    onChange={(e) => setUrlInputs({ ...urlInputs, [item.id]: e.target.value })}
                    placeholder="Paste Image URL..."
                    disabled={isUpdating}
                    className="w-full h-8 rounded-md border border-ink-dim/20 bg-surface pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  />
                  <LinkIcon className="absolute left-2 top-2 h-3.5 w-3.5 text-ink-faint" />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isUpdating || !currentUrlInput.trim()}
                  className="h-8 px-2.5 text-xs bg-ink text-page hover:bg-ink/80 shrink-0"
                >
                  {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
              </form>

              {/* Option B: File Upload */}
              <div className="flex items-center justify-between">
                <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-display text-ink-dim hover:text-ink transition-colors">
                  <Upload className="h-3.5 w-3.5 text-ink-faint" />
                  <span>Upload File</span>
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
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
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
