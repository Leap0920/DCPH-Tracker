"use client"

import { RouteError } from "@/components/route-error"

export default function FavoritesError({
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
      fileNo="500-FAV"
      scope="FAVORITES UNAVAILABLE"
      title="We couldn't load your favorites"
      description="Your saved items are intact — we just couldn't render them. Retry to try again."
      homeHref="/tracker"
      homeLabel="Back to Tracker"
    />
  )
}
