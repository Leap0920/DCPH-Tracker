"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Edit2, X, Loader2, Award } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Database } from "@/types/database.types"
import type { ActionResult } from "@/lib/actions/admin-badges"

type BadgeRow = Database["public"]["Tables"]["badges"]["Row"]

const inputCls =
  "w-full h-10 rounded-lg border border-slate-200 bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
const labelCls =
  "block font-display text-xs font-semibold text-ink-dim mb-1.5"

const CATEGORY_OPTIONS = [
  { value: "achievement", label: "Achievement" },
  { value: "milestone", label: "Milestone" },
  { value: "special_event", label: "Special Event" },
  { value: "community", label: "Community" },
]

export function BadgeFormModal({
  badge,
  action,
  triggerLabel,
}: {
  badge?: BadgeRow
  action: (formData: FormData) => Promise<ActionResult>
  triggerLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(badge)

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
          className="gap-2 bg-gray-900 text-white hover:bg-gray-800 text-xs font-display"
        >
          <Plus className="h-4 w-4" />
          {triggerLabel || "Add Badge"}
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5">
              <h3 className="font-display text-lg text-ink">
                {isEdit ? `Edit Badge: ${badge?.name}` : "Create New Badge"}
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
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                  {error}
                </div>
              )}

              <div>
                <label className={labelCls}>Badge Name *</label>
                <input
                  name="name"
                  defaultValue={badge?.name ?? ""}
                  required
                  placeholder="e.g. Master Detective"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Slug (Unique Key)</label>
                  <input
                    name="slug"
                    defaultValue={badge?.slug ?? ""}
                    placeholder="e.g. master-detective"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <select
                    name="category"
                    defaultValue={badge?.category ?? "achievement"}
                    className={inputCls}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Badge Icon URL / Image</label>
                <input
                  type="url"
                  name="icon_url"
                  defaultValue={badge?.icon_url ?? ""}
                  placeholder="https://example.com/badge-icon.png"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Description / Unlock Criteria</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={badge?.description ?? ""}
                  placeholder="e.g. Awarded for watching 500 episodes of Detective Conan."
                  className="w-full rounded-lg border border-slate-200 bg-surface p-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
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
                  className="bg-gray-900 text-white hover:bg-gray-800 font-display text-xs"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : isEdit ? (
                    "Update Badge"
                  ) : (
                    "Create Badge"
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
