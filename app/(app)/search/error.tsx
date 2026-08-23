"use client"

import { RouteError } from "@/components/route-error"

export default function SearchError({
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
      fileNo="500-SRC"
      scope="SEARCH UNAVAILABLE"
      title="Search isn't responding"
      description="We couldn't run that search. Retry, or narrow your query and try again."
      homeHref="/tracker"
      homeLabel="Back to Tracker"
    />
  )
}
