"use client"

import { RouteError } from "@/components/route-error"

export default function TrackerError({
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
      fileNo="500-TRK"
      scope="TRACKER UNAVAILABLE"
      title="We couldn't load your tracker"
      description="Your progress is safe. Something failed while rendering the tracker — retry, or reload the page if it keeps happening."
      homeHref="/"
    />
  )
}
