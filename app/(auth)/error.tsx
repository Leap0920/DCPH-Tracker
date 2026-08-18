"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center">
      <span className="case-number">FILE NO. 500 · INVESTIGATION FAILED</span>
      <h1 className="mt-4 font-display text-4xl tracking-tight text-ink">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-dim">
        An unexpected error interrupted the investigation. Try again, or head
        back to base.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset} className="rounded-lg">
          Try again
        </Button>
        <Button asChild variant="outline" className="rounded-lg border-ink-dim/20">
          <Link href="/">Return Home</Link>
        </Button>
      </div>
    </div>
  )
}
