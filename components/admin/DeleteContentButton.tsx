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
          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Confirm
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-900"
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}
