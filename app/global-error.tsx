"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center font-sans antialiased">
        <span className="case-number">FILE NO. 500 · CRITICAL SYSTEM ERROR</span>
        <h1 className="mt-4 font-display text-4xl tracking-tight text-ink">
          An unexpected error occurred
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-dim">
          A critical system error occurred. You can try refreshing the page or returning home.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Button onClick={reset} className="rounded-lg">
            Try again
          </Button>
          <Button asChild variant="outline" className="rounded-lg border-ink-dim/20">
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </body>
    </html>
  )
}
