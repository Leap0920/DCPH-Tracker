"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Check, X } from "lucide-react"

/**
 * Confirmation banner shown on the landing page after an account deletion.
 *
 * A client component that reads the query string on purpose: reading
 * `searchParams` in the page would force the marketing page out of static
 * rendering for a message almost nobody ever sees.
 *
 * The delete route cannot render this itself — by the time it returns, the
 * session is gone — so the settings card redirects here with `?account=deleted`.
 */
export function AccountDeletedNotice() {
  const searchParams = useSearchParams()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || searchParams.get("account") !== "deleted") return null

  return (
    <div className="px-6 pt-6">
      <div
        role="status"
        className="mx-auto flex max-w-2xl items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1">
          Your account and everything attached to it have been deleted. Sorry to
          see you go.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
