"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A horizontal rail, the row Netflix builds the whole product out of.
 *
 * Behaviours that matter:
 * - the scroller is the page's horizontal axis only — vertical wheel scrolling
 *   still moves the page, because trapping the wheel in a rail is how a browse
 *   page becomes a maze on a laptop trackpad
 * - arrows appear on hover and disappear at the ends, so the control never
 *   promises a direction that is not there
 * - snap points, so a swipe always lands on a card edge rather than mid-poster
 */
export function Rail({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setAtStart(el.scrollLeft <= 2)
      setAtEnd(el.scrollLeft >= max - 2)
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [])

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" })
  }

  return (
    <section className={cn("group/rail", className)} aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-4 px-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-tight text-white sm:text-xl">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-white/45">{subtitle}</p>}
        </div>
        {action}
      </div>

      <div className="relative">
        <div
          ref={scrollerRef}
          className="flex snap-x scroll-pl-3 gap-2.5 overflow-x-auto scroll-smooth px-3 pb-3 [scrollbar-width:none] sm:scroll-pl-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
        >
          {children}
          {/* Trailing spacer so the last card clears the gutter. */}
          <span aria-hidden className="w-1 shrink-0" />
        </div>

        {!atStart && (
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={`Scroll ${title} left`}
            className="absolute left-1 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black sm:flex group-hover/rail:opacity-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {!atEnd && (
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={`Scroll ${title} right`}
            className="absolute right-1 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black sm:flex group-hover/rail:opacity-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        {/* Fade the cut edge: a rail that stops dead reads as "that is all".
            Fades to `surface`, not `page` — this rail sits inside the tracker's
            surface card, and a fade toward the page colour (#000) over a #0A0A0A
            card is invisible, which left the last poster cut off mid-artwork. */}
        {!atEnd && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface via-surface/70 to-transparent" />
        )}
        {!atStart && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-surface via-surface/70 to-transparent" />
        )}
      </div>
    </section>
  )
}
