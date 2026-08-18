"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function EpisodeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Episode route error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-surface px-6 text-center">
      <span className="case-number">FILE NO. 500 · CASE FILE ERROR</span>
      <h1 className="mt-4 font-display text-3xl tracking-tight text-ink">
        Unable to load episode details
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-dim">
        An unexpected error occurred while retrieving this case file. Try again or return to case files.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset} className="rounded-lg font-display">
          Try again
        </Button>
        <Button asChild variant="outline" className="rounded-lg border-ink-dim/20 font-display">
          <Link href="/tracker">Back to Case Files</Link>
        </Button>
      </div>
    </div>
  )
}
