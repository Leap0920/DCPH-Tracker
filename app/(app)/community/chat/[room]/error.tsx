"use client"

import { RouteError } from "@/components/route-error"

export default function ChatRoomError({
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
      fileNo="500-CHT"
      scope="CHAT DISCONNECTED"
      title="This room couldn't be opened"
      description="We lost the connection to the chat room. Retry to rejoin — your messages weren't lost."
      homeHref="/community"
      homeLabel="Back to Community"
    />
  )
}
