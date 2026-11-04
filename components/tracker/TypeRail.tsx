"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type RailTab = {
  /** Content type key. There is no "all" — one category is always selected. */
  key: string
  label: string
  /** Two-digit ordinal shown before the label. */
  index: string
  total: number
  watched: number
}

/**
 * Short labels for the spine. The full names ("The Culprit Hanzawa", "Zero's
 * Tea Time") push the seventh tab off the right edge of the card, where it was
 * clipped mid-word; the full name stays on the button's title and aria-label.
 */
const SHORT_LABELS: Record<string, string> = {
  live_action: "Live action",
  hanzawa: "Hanzawa",
  zero_tea_time: "Zero's Tea",
  yaiba: "Yaiba",
}

/**
 * Horizontal content-type spine for the tracker.
 *
 * The list below only ever shows one category, so the categories themselves
 * have to be visible and cheap to switch: a single scrolling row, each tab
 * carrying its own count and a progress hairline. Numbers instead of icons —
 * nine little glyphs above a list reads as decoration, not navigation.
 *
 * Scrolls by touch, wheel, arrow keys and the two edge arrows. The arrows only
 * render when the rail actually overflows, and a mask fades whichever edge is
 * cut off, so "there is more" is visible without a scrollbar.
 */
export function TypeRail({
  tabs,
  active,
  onChange,
}: {
  tabs: RailTab[]
  active: string
  onChange: (key: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflowing(max > 4)
    setAtStart(el.scrollLeft <= 4)
    setAtEnd(el.scrollLeft >= max - 4)
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [measure])

  // Keep the selected tab in view when the selection changes from elsewhere
  // (deep link, browser back, a jump that resets the category).
  //
  // Scrolled horizontally by hand rather than with scrollIntoView(): the
  // `block: "nearest"` that makes that call safe vertically still walks every
  // scrollable ancestor, and on a page whose category rail sits below a
  // full-height hero it scrolled the WINDOW down to the rail on first paint.
  useEffect(() => {
    const strip = scroller.current
    const el = strip?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
    if (!strip || !el) return
    const left = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" })
  }, [active])

  const nudge = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * 280, behavior: "smooth" })
  }

  // Arrow-key navigation between tabs, the behaviour a tablist promises.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.key === active)
    if (index < 0) return
    const nextIndex = event.key === "ArrowRight" ? index + 1 : index - 1
    const next = tabs[nextIndex]
    if (!next) return
    onChange(next.key)
    scroller.current
      ?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)
      ?.focus()
  }

  return (
    <div className="relative">
      {overflowing && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={atStart}
          aria-label="Scroll categories left"
          className={cn(
            "absolute left-0 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-page/90 text-ink shadow-lg backdrop-blur transition-opacity sm:flex",
            "hover:text-ink hover:border-ink-faint disabled:pointer-events-none disabled:opacity-0"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={scroller}
        onScroll={measure}
        onKeyDown={onKeyDown}
        role="tablist"
        aria-label="Content type"
        className="flex snap-x snap-mandatory items-stretch gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: `linear-gradient(to right, ${atStart ? "black" : "transparent"} 0, black 24px, black calc(100% - 24px), ${atEnd ? "black" : "transparent"} 100%)`,
          WebkitMaskImage: `linear-gradient(to right, ${atStart ? "black" : "transparent"} 0, black 24px, black calc(100% - 24px), ${atEnd ? "black" : "transparent"} 100%)`,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active
          const label = SHORT_LABELS[tab.key] ?? tab.label
          const percent = tab.total > 0 ? Math.min(100, Math.round((tab.watched / tab.total) * 100)) : 0
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              data-tab={tab.key}
              title={tab.label}
              aria-label={`${tab.label}: ${tab.watched} of ${tab.total} watched`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              className={cn(
                "group relative shrink-0 snap-start rounded-md px-3 pb-2 pt-1.5 text-left transition-colors",
                isActive ? "bg-surface-muted" : "hover:bg-surface-muted/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              )}
            >
              {/* The label is the thing you read, so it leads at full size and
                  full ink on the active tab. The two-digit index drops to a faint
                  superscript: it is an ordinal, not information anyone needs. */}
              <span className="flex items-start gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 font-mono text-[9px] tabular-nums leading-none transition-colors",
                    isActive ? "text-ink-faint" : "text-ink-faint/60"
                  )}
                >
                  {tab.index}
                </span>
                <span
                  className={cn(
                    "text-[13px] leading-tight tracking-tight transition-colors",
                    isActive ? "font-semibold text-ink" : "text-ink-dim group-hover:text-ink"
                  )}
                >
                  {label}
                </span>
              </span>

              {/* Count + hairline on one line: the fraction says how far along
                  you are, the bar says it again without reading. The bar is the
                  affordance that makes progress noticeable at a glance. */}
              <span className="mt-1 flex items-center gap-1.5">
                <span
                  className={cn(
                    "shrink-0 font-mono text-[10px] tabular-nums leading-none transition-colors",
                    isActive ? "text-ink-dim" : "text-ink-faint/70"
                  )}
                >
                  {tab.watched}
                  <span className="text-ink-faint/40">/</span>
                  {tab.total}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "relative h-[3px] w-8 shrink-0 overflow-hidden rounded-full transition-colors",
                    isActive ? "bg-white/15" : "bg-white/[0.07]"
                  )}
                >
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-500",
                      isActive ? "bg-ink" : "bg-ink-faint/70"
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </span>

              {/* Active gets a solid underline spanning the whole tab, sitting on
                  the rail's own baseline rather than floating under the label. */}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink"
                />
              )}
            </button>
          )
        })}
      </div>

      {overflowing && (
        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={atEnd}
          aria-label="Scroll categories right"
          className={cn(
            "absolute right-0 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-page/90 text-ink shadow-lg backdrop-blur transition-opacity sm:flex",
            "hover:text-ink hover:border-ink-faint disabled:pointer-events-none disabled:opacity-0"
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
