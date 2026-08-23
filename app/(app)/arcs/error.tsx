"use client"

import { RouteError } from "@/components/route-error"

export default function ArcsError({
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
      fileNo="500-ARC"
      scope="ARC INDEX UNAVAILABLE"
      title="We couldn't load the arc index"
      description="The story arc listing failed to load. Try again — nothing on your account changed."
      homeHref="/tracker"
      homeLabel="Back to Tracker"
    />
  )
}
