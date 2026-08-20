"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Search, ChevronDown } from "lucide-react"
import { CONTENT_TYPE_LABELS } from "@/lib/constants"

const controlCls =
  "h-10 rounded-md border border-line bg-surface text-sm text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent/40"

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
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={onSearch} role="search" className="relative min-w-[200px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
        <input
          id="content-search"
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search content by title or slug"
          placeholder="Search title or slug…"
          className={`${controlCls} w-full pl-9 pr-3`}
        />
      </form>

      <div className="relative">
        <select
          id="content-type-filter"
          value={type}
          onChange={(e) => apply({ type: e.target.value })}
          aria-label="Filter by content type"
          className={`${controlCls} appearance-none pl-3 pr-9`}
        >
          <option value="all">All types</option>
          {Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
