"use client"

import { getRelationshipColor } from "@/components/characters/graph-theme"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import type { RelationshipType } from "@/lib/characters-guide"

/**
 * Legend + type filter. Swatches use the same theme-aware resolver as the graph
 * edges, so chip color and string color can never drift apart.
 *
 * The labels and descriptions arrive as a prop (the server already sends
 * RELATIONSHIP_META) rather than being imported from the guide: the legend is
 * part of the first paint, and the guide now lives in an async chunk that only a
 * character tap pulls in.
 */
export const RELATIONSHIP_TYPES: RelationshipType[] = [
  "romance",
  "family",
  "friendship",
  "rivalry",
  "mentor",
  "colleague",
  "secret_identity",
  "adversary",
]

export type RelationshipMeta = Record<
  RelationshipType,
  { label: string; color: string; description: string }
>

export function RelationshipLegend({
  meta,
  activeFilter,
  onFilterType,
  compact = false,
}: {
  meta: RelationshipMeta
  activeFilter: RelationshipType | null
  onFilterType: (type: RelationshipType | null) => void
  compact?: boolean
}) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <div className={cn("grid gap-1.5", !compact && "sm:grid-cols-2")}>
      {RELATIONSHIP_TYPES.map((type) => {
        const copy = meta[type]
        const active = activeFilter === type
        const color = getRelationshipColor(type, isDark)
        return (
          <button
            key={type}
            type="button"
            onClick={() => onFilterType(active ? null : type)}
            aria-pressed={active}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-200",
              active
                ? "border-accent bg-accent-soft text-accent-bright"
                : "border-line bg-surface text-ink-dim hover:-translate-y-0.5 hover:border-ink-faint/40 hover:bg-surface-muted"
            )}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: color,
                boxShadow: active ? `0 0 0 3px ${color}33` : undefined,
              }}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-xs font-semibold",
                  active ? "text-accent-bright" : "text-ink"
                )}
              >
                {copy.label}
              </span>
              {!compact && (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                  {copy.description}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
