"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Search } from "lucide-react"
import { CONTENT_TYPE_LABELS } from "@/lib/constants"

export function ContentFilters() {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = useState(params.get("q") ?? "")
  const type = params.get("type") ?? "all"

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString())
    Object.entries(next).forEach(([k, v]) => {
      if (v && v !== "all") sp.set(k, v)
      else sp.delete(k)
    })
    sp.delete("page")
    router.push(`/admin/content?${sp.toString()}`)
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    apply({ q })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={onSearch} className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or slug…"
          className="h-10 w-full rounded-lg border border-slate-200 bg-surface pl-10 pr-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </form>
      <select
        value={type}
        onChange={(e) => apply({ type: e.target.value })}
        className="h-10 rounded-lg border border-slate-200 bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        <option value="all">All types</option>
        {Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
