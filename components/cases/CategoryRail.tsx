import Link from "next/link"
import { cn } from "@/lib/utils"

export interface CategoryOption {
  /** Content type slug, or "" for the unfiltered view. */
  value: string
  label: string
  count: number
}

interface CategoryRailProps {
  options: CategoryOption[]
  /** Active ?format= value, "" when unfiltered. */
  active: string
  /** Builds a href for a category, preserving the other filters. */
  hrefFor: (value: string) => string
}

/**
 * The archive's categories as a visible row of tabs.
 *
 * The page already had a Content Type dropdown, but a filter that decides the
 * whole shape of the page should not be two clicks deep in a menu — the
 * reader needs to see that Episodes, Movies and Magic Kaito are separate
 * bodies of work, and to move between them in one tap.
 *
 * Counts are entries, not crime records: "Movies 34" means 34 films, which is
 * the number a reader would check against.
 */
export function CategoryRail({ options, active, hrefFor }: CategoryRailProps) {
  return (
    <div>
      {/* Labelled, because it sits under a row of crime chips that looked
          identical. The label is what says these nine are media types and
          those twelve are crime types. */}
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        Content
      </span>
      <nav aria-label="Filter by content type" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max items-center gap-1 px-1 py-1">
          {options.map((option) => {
            const isActive = option.value === active
            return (
              <li key={option.value || "all"}>
                <Link
                  href={hrefFor(option.value)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3",
                    "font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40",
                    isActive
                      ? "border-ink bg-ink text-page"
                      : "border-line text-ink-dim hover:border-ink-faint/50 hover:text-ink"
                  )}
                >
                  {option.label}
                  <span
                    className={cn(
                      "tabular-nums",
                      isActive ? "text-page/70" : "text-ink-faint"
                    )}
                  >
                    {option.count.toLocaleString()}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
