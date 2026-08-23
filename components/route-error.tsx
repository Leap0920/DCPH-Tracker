"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type RouteErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
  /** Fake case-file number shown in the eyebrow, e.g. "500-TRK". */
  fileNo?: string
  /** Short label for the failing area, e.g. "TRACKER". */
  scope?: string
  /** Headline shown to the user. */
  title?: string
  /** Supporting copy shown to the user. */
  description?: string
  /** Optional secondary link target (defaults to the app dashboard). */
  homeHref?: string
  homeLabel?: string
  className?: string
}

export function RouteError({
  error,
  reset,
  fileNo = "500",
  scope = "UNEXPECTED ERROR",
  title = "Something went wrong",
  description = "We hit an unexpected problem loading this page. You can retry, or head back and try again in a moment.",
  homeHref = "/",
  homeLabel = "Return Home",
  className,
}: RouteErrorProps) {
  useEffect(() => {
    // Log for observability. The digest is the only safe correlation id in prod.
    console.error(
      JSON.stringify({
        level: "error",
        message: "route_error_boundary",
        scope,
        fileNo,
        digest: error.digest ?? null,
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    )
  }, [error, scope, fileNo])

  return (
    <div
      className={cn(
        "flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center",
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-lg">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
          FILE NO. {fileNo} · {scope}
        </span>

        <h1 className="mt-4 font-display text-2xl tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-ink-dim">{description}</p>

        {error.digest ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            ref: {error.digest}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button onClick={reset} className="w-full rounded-lg sm:w-auto">
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full rounded-lg border-line sm:w-auto"
          >
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RouteError
