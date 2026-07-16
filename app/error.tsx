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
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <span className="case-number">FILE NO. 500 — INVESTIGATION FAILED</span>
      <h1 className="mt-4 font-display text-4xl uppercase tracking-wide text-gray-900">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        An unexpected error interrupted the investigation. You can retry or head
        back to safety.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset} className="rounded-lg">
          Try Again
        </Button>
        <Link href="/">
          <Button variant="outline" className="rounded-lg border-gray-200">
            Return Home
          </Button>
        </Link>
      </div>
    </div>
  )
}
