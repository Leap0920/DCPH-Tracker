"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { deleteContentEntry } from "@/lib/actions/admin-content"

export function DeleteContentButton({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteContentEntry(id)
      if (result.ok) {
        router.refresh()
      } else {
        alert(result.error)
      }
      setConfirming(false)
    })
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={handleDelete}
          disabled={pending}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 font-mono text-[10px] uppercase tracking-wide text-danger transition-colors hover:bg-danger/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-danger/40 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Confirm
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="inline-flex h-7 items-center rounded-md border border-line px-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint transition-colors hover:bg-white/[0.03] hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${title}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus-visible:ring-1 focus-visible:ring-danger/40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
