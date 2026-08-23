"use client"

import { RouteError } from "@/components/route-error"

export default function RankingsError({
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
      fileNo="500-RNK"
      scope="RANKINGS UNAVAILABLE"
      title="We couldn't load the leaderboard"
      description="Rankings failed to load. They refresh often, so retrying usually works."
      homeHref="/community"
      homeLabel="Back to Community"
    />
  )
}
