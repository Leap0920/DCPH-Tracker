"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function TrackerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Tracker route error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-surface px-6 text-center">
      <span className="case-number">FILE NO. 500 · TRACKER ERROR</span>
      <h1 className="mt-4 font-display text-3xl tracking-tight text-ink">
        Unable to load tracker case files
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-dim">
        An error occurred while loading the episode tracker. You can try reloading or return to base.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset} className="rounded-lg font-display">
          Try again
        </Button>
        <Button asChild variant="outline" className="rounded-lg border-ink-dim/20 font-display">
          <Link href="/">Return Home</Link>
        </Button>
      </div>
    </div>
  )
}
