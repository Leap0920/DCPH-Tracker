"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"

/**
 * Global search input rendered at the top of /search. Debounced (300ms)
 * auto-navigation while typing plus an explicit push on Enter/submit, so
 * results follow the query without a submit button.
 *
 * The input is controlled by local state seeded from the server-passed
 * `initialValue`. External navigations (navbar icon, back button) sync the
 * input back to the URL's q, but an in-flight debounce never gets clobbered
 * while the user is still typing.
 */
export function SearchInput({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingRef = useRef(false)

  // Follow external query changes (e.g. navbar icon → /search clears the box)
  // without reverting what the user is actively typing.
  useEffect(() => {
    if (typingRef.current) return
    setValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function navigate(raw: string) {
    typingRef.current = false
    const trimmed = raw.trim()
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search")
  }

  function handleChange(next: string) {
    typingRef.current = true
    setValue(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => navigate(next), 300)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    navigate(value)
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className="relative w-full max-w-xl"
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search episodes, arcs, and detectives…"
        aria-label="Search episodes, arcs, and detectives"
        className="h-12 w-full rounded-xl border border-ink-dim/20 bg-surface pl-11 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </form>
  )
}
