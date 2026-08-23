"use client"

import { RouteError } from "@/components/route-error"

export default function CasesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      fileNo="500-CSE"
      scope="CASE FILES SEALED"
      title="We couldn't open the case files"
      description="The case archive failed to load. Retry to reopen the files."
      homeHref="/tracker"
      homeLabel="Back to Tracker"
    />
  )
}
