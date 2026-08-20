"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Edit2, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Database } from "@/types/database.types"
import type { ActionResult } from "@/lib/actions/admin-arcs"

type ArcRow = Database["public"]["Tables"]["arcs"]["Row"]

const fieldCls =
  "w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent/40"
const inputCls = `${fieldCls} h-10`
const textareaCls = `${fieldCls} py-2`
const labelCls = "mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-faint"

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
  const uid = useId()

  const isEdit = Boolean(arc)
  const titleId = `${uid}-arc-modal-title`

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

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
          className="h-8 gap-1.5 border-line px-2.5 text-xs text-ink-dim hover:bg-white/[0.06] hover:text-ink"
        >
          <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
      ) : (
        <Button
          onClick={() => setOpen(true)}
          className="h-9 gap-2 rounded-md bg-ink px-3 text-xs text-page hover:bg-ink/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {triggerLabel || "Add Story Arc"}
        </Button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-lg rounded-md border border-line bg-surface"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id={titleId} className="font-display text-sm text-ink">
                {isEdit ? `Edit arc: ${arc?.title}` : "Create story arc"}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close dialog"
                className="h-8 w-8 text-ink-faint hover:bg-white/[0.06] hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-line bg-red-500/[0.06] px-3 py-2 text-xs text-red-400"
                >
                  {error}
                </div>
              )}

              <div>
                <label htmlFor={`${uid}-title`} className={labelCls}>
                  Arc title <span className="text-accent">*</span>
                </label>
                <input
                  id={`${uid}-title`}
                  name="title"
                  defaultValue={arc?.title ?? ""}
                  required
                  placeholder="e.g. Black Organization Arrival"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor={`${uid}-slug`} className={labelCls}>
                  Slug
                </label>
                <input
                  id={`${uid}-slug`}
                  name="slug"
                  defaultValue={arc?.slug ?? ""}
                  placeholder="black-organization-arrival"
                  className={`${inputCls} font-mono text-xs`}
                />
                <p className="mt-1 text-[11px] text-ink-faint">Auto-generated from title if blank.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-start`} className={labelCls}>
                    Start episode <span className="text-accent">*</span>
                  </label>
                  <input
                    id={`${uid}-start`}
                    type="number"
                    name="start_episode"
                    defaultValue={arc?.start_episode ?? 1}
                    required
                    min={1}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-end`} className={labelCls}>
                    End episode <span className="text-accent">*</span>
                  </label>
                  <input
                    id={`${uid}-end`}
                    type="number"
                    name="end_episode"
                    defaultValue={arc?.end_episode ?? 1}
                    required
                    min={1}
                    className={`${inputCls} tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={`${uid}-image`} className={labelCls}>
                  Image / poster URL
                </label>
                <input
                  id={`${uid}-image`}
                  type="url"
                  name="image_url"
                  defaultValue={arc?.image_url ?? ""}
                  placeholder="https://…"
                  className={`${inputCls} font-mono text-xs`}
                />
              </div>

              <div>
                <label htmlFor={`${uid}-description`} className={labelCls}>
                  Description
                </label>
                <textarea
                  id={`${uid}-description`}
                  name="description"
                  rows={3}
                  defaultValue={arc?.description ?? ""}
                  placeholder="Key story events, pivotal character intros, Black Org encounters…"
                  className={textareaCls}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="h-9 px-3 text-xs text-ink-dim hover:bg-white/[0.06] hover:text-ink"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending}
                  className="h-9 rounded-md bg-ink px-3 text-xs text-page hover:bg-ink/90"
                >
                  {pending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : isEdit ? (
                    "Update arc"
                  ) : (
                    "Create arc"
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
