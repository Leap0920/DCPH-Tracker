"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Edit2, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Database } from "@/types/database.types"
import type { ActionResult } from "@/lib/actions/admin-arcs"

type ArcRow = Database["public"]["Tables"]["arcs"]["Row"]

const inputCls =
  "w-full h-10 rounded-lg border border-ink-dim/20 bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
const labelCls =
  "block font-display text-xs font-semibold text-ink-dim mb-1.5"

export function ArcFormModal({
  arc,
  action,
  triggerLabel,
}: {
  arc?: ArcRow
  action: (formData: FormData) => Promise<ActionResult>
  triggerLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(arc)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await action(formData)
      if (result.ok) {
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      {isEdit ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-xs text-ink-dim hover:text-ink"
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit
        </Button>
      ) : (
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 bg-ink text-page hover:bg-ink/80 text-xs font-display"
        >
          <Plus className="h-4 w-4" />
          {triggerLabel || "Add Story Arc"}
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-ink-dim/20 bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-ink-dim/20 pb-4 mb-5">
              <h3 className="font-display text-lg text-ink">
                {isEdit ? `Edit Arc: ${arc?.title}` : "Create New Story Arc"}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="text-ink-faint hover:text-ink"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  {error}
                </div>
              )}

              <div>
                <label className={labelCls}>Arc Title *</label>
                <input
                  name="title"
                  defaultValue={arc?.title ?? ""}
                  required
                  placeholder="e.g. Black Organization Arrival"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Slug (URL identifier)</label>
                <input
                  name="slug"
                  defaultValue={arc?.slug ?? ""}
                  placeholder="Auto-generated if blank (e.g. black-organization-arrival)"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Start Episode *</label>
                  <input
                    type="number"
                    name="start_episode"
                    defaultValue={arc?.start_episode ?? 1}
                    required
                    min={1}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>End Episode *</label>
                  <input
                    type="number"
                    name="end_episode"
                    defaultValue={arc?.end_episode ?? 1}
                    required
                    min={1}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Image / Poster URL</label>
                <input
                  type="url"
                  name="image_url"
                  defaultValue={arc?.image_url ?? ""}
                  placeholder="https://images.jpg"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Description / Overview</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={arc?.description ?? ""}
                  placeholder="Key story events, pivotal character intros, Black Org encounters..."
                  className="w-full rounded-lg border border-ink-dim/20 bg-surface p-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-dim/20">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending}
                  className="bg-ink text-page hover:bg-ink/80 font-display text-xs"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : isEdit ? (
                    "Update Arc"
                  ) : (
                    "Create Arc"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
