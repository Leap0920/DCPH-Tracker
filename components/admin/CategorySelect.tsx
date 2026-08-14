"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { updateContentType } from "@/lib/actions/admin-content"

const TYPE_OPTIONS = Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][]

export function CategorySelect({
  id,
  currentType,
}: {
  id: string
  currentType: ContentType
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<ContentType>(currentType)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newType = e.target.value as ContentType
    setSelected(newType)
    startTransition(async () => {
      const res = await updateContentType(id, newType)
      if (res.ok) {
        router.refresh()
      } else {
        alert(res.error)
        setSelected(currentType)
      }
    })
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        value={selected}
        onChange={handleChange}
        disabled={pending}
        className="h-8 rounded-md border border-slate-200 bg-surface px-2.5 py-1 font-display text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      >
        {TYPE_OPTIONS.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
      {pending && (
        <Loader2 className="absolute right-2 h-3.5 w-3.5 animate-spin text-ink-faint pointer-events-none" />
      )}
    </div>
  )
}
