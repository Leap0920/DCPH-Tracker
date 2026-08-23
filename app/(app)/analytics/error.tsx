"use client"

import { RouteError } from "@/components/route-error"

export default function AnalyticsError({
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
      fileNo="500-ANL"
      scope="ANALYTICS UNAVAILABLE"
      title="We couldn't build your analytics"
      description="The dashboard failed to compute. This is usually temporary — try again in a moment."
      homeHref="/tracker"
      homeLabel="Back to Tracker"
    />
  )
}
