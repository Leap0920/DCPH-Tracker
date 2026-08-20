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
        aria-label="Content category"
        className="h-8 appearance-none rounded-md border border-line bg-surface pl-2.5 pr-7 text-xs text-ink transition-colors hover:bg-white/[0.03] focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/30 disabled:opacity-50"
      >
        {TYPE_OPTIONS.map(([val, label]) => (
          <option key={val} value={val} className="bg-surface text-ink">
            {label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 flex items-center">
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin text-ink-faint" />
        ) : (
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="h-2.5 w-2.5 text-ink-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        )}
      </span>
    </div>
  )
}
