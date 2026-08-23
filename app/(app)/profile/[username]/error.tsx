"use client"

import { RouteError } from "@/components/route-error"

export default function ProfileError({
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
      fileNo="500-PRF"
      scope="PROFILE UNAVAILABLE"
      title="We couldn't load this profile"
      description="This detective's file failed to load. Retry, or head back to the community."
      homeHref="/community"
      homeLabel="Back to Community"
    />
  )
}
