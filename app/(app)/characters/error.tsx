"use client"

import { RouteError } from "@/components/route-error"

export default function CharactersError({
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
      fileNo="500-CHR"
      scope="CHARACTER FILES UNAVAILABLE"
      title="We couldn't open the character files"
      description="The character explorer failed to load. Retry, or browse the arcs in the meantime."
      homeHref="/arcs"
      homeLabel="Browse Arcs"
    />
  )
}
