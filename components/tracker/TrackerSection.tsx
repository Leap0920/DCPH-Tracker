"use client"

import { useEffect, useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * One accordion section: a header you can scan (icon, title, count, progress)
 * and a body that only exists while it is open.
 *
 * The body is mounted on open and unmounted ~250ms after close (matching the
 * grid-rows transition), because "By Year" used to keep ~900 rows mounted for
 * the one section the reader could see.
 */
export function TrackerSection({
  icon: Icon,
  title,
  count,
  watched,
  progressColor,
  progressPercent,
  isOpen,
  onToggle,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  watched?: number
  progressColor?: string
  progressPercent?: number
  isOpen: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const bodyId = useId()
  const showProgress =
    typeof progressPercent === "number" &&
    typeof watched === "number" &&
    typeof count === "number"

  const [mounted, setMounted] = useState(isOpen)
  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), 250) // matches duration-[250ms]
    return () => clearTimeout(timer)
  }, [isOpen])

  return (
    <section className="border-b border-line last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggle()
          }
        }}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 px-3 py-4 text-left outline-none transition-colors sm:gap-4 sm:px-5 sm:py-4",
          "hover:bg-surface-muted/60 focus-visible:ring-2 focus-visible:ring-accent/30",
          isOpen && "bg-surface-muted/30"
        )}
      >
        {/* Neutral, not accent. A solid crimson square in front of "1996" was
            the loudest element on the page, competing with the CANON badges —
            and the accent is supposed to mean "this is canon", not "this
            section is open". The progress bar already carries the state. */}
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
            isOpen
              ? "border-line bg-surface-muted text-ink"
              : "border-transparent bg-surface-muted text-ink-faint"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Wraps instead of ellipsizing: "The Culprit Hanzawa" and
                "Zero's Tea Time" were cut to "Magic…" on narrow phones. */}
            <h2 className="min-w-0 break-words font-display text-base tracking-tight text-ink sm:text-lg">
              {title}
            </h2>
            {typeof count === "number" && (
              <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-ink-dim">
                {count}
              </span>
            )}
          </div>
          {showProgress && (
            <div className="mt-2 flex max-w-[12rem] items-center gap-2.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-[600ms] ease-out",
                    progressColor
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">
                {watched}/{count}
              </span>
            </div>
          )}
        </div>

        {action && (
          <div className="max-w-[45%] shrink-0 [&_button]:max-w-full [&_button]:truncate sm:max-w-none">
            {action}
          </div>
        )}

        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-ink-faint transition-transform duration-200",
            isOpen && "rotate-180 text-ink-dim"
          )}
        />
      </div>

      <div
        id={bodyId}
        className={cn(
          "grid transition-[grid-template-rows] duration-[250ms] ease-in-out",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-0 pb-5 sm:px-0">{mounted ? children : null}</div>
        </div>
      </div>
    </section>
  )
}
