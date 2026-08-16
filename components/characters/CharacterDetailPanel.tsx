"use client"

import { useCallback, useEffect, useRef } from "react"
import { motion, MotionConfig } from "framer-motion"
import { X } from "lucide-react"
import {
  getCharacterById,
  RELATIONSHIP_META,
  type Character,
  type Relationship,
  type RelationshipType,
} from "@/lib/characters-guide"
import { cn } from "@/lib/utils"

const EASE = [0.16, 1, 0.3, 1] as const

const RELATIONSHIP_TYPES = Object.keys(RELATIONSHIP_META) as RelationshipType[]

/**
 * Dossier detail panel for a single character. Inline (non-modal) dialog —
 * an accessible dossier-card that slides/fades in beside the graph. When
 * `character` is null the panel renders nothing.
 */
export function CharacterDetailPanel({
  character,
  relationships,
  onClose,
}: {
  character: Character | null
  relationships: Relationship[]
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  const isOpen = character !== null

  /**
   * Restore keyboard focus to the node that opened the panel, then forget it.
   * Called from every close path (Escape, X button, selection cleared by the
   * parent) — guarded so it only restores while the node still exists and
   * never double-restores.
   */
  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target && target.isConnected) {
      target.focus()
    }
  }, [])

  // On open: capture the ORIGINAL focused node BEFORE focus moves into the
  // panel, then focus the panel. On close: return focus to that captured
  // node. The parent may unmount the panel on close, in which case this
  // effect body never re-runs — so the Escape and X close paths below also
  // restore synchronously before calling onClose; this effect is the safety
  // net for parent-driven selection clears while the panel stays mounted.
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      // Graph nodes may be SVG elements, which are NOT instanceof HTMLElement
      // — accept any focusable Element and store it as HTMLElement for the
      // typed focus() call below.
      const active = document.activeElement
      const canFocus =
        active instanceof Element &&
        active !== panelRef.current &&
        typeof (active as { focus?: () => void }).focus === "function"
      returnFocusRef.current = canFocus ? (active as HTMLElement) : null
      panelRef.current?.focus()
    } else if (!isOpen && wasOpen.current) {
      // Only reclaim focus if it is still inside the panel (or fell back to
      // body) — never yank it from an element the user just clicked.
      const active = document.activeElement
      const focusInsidePanel =
        panelRef.current !== null && panelRef.current.contains(active)
      if (active === document.body || focusInsidePanel) {
        restoreFocus()
      }
    }
    wasOpen.current = isOpen
  }, [isOpen, restoreFocus])

  // Escape closes the panel and returns focus to the opening node
  // synchronously — onClose may unmount this panel, so the listener must
  // restore focus before the DOM goes away.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        restoreFocus()
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, onClose, restoreFocus])

  if (!character) return null

  const threads = relationships.map((relationship) => {
    const otherId =
      relationship.source === character.id
        ? relationship.target
        : relationship.source
    const other = getCharacterById(otherId)
    return {
      relationship,
      meta: RELATIONSHIP_META[relationship.type],
      // Fall back to the raw id while the content arrays are still being
      // authored — the panel must stay graceful mid-fill.
      otherName: other?.name ?? otherId,
    }
  })

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label={character.name}
        tabIndex={-1}
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 60 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="dossier-card relative flex flex-col max-h-[48vh] sm:max-h-[85vh] w-full p-0 outline-none rounded-t-2xl sm:rounded-2xl border-t sm:border border-slate-200/90 bg-surface/98 shadow-2xl backdrop-blur-xl overflow-hidden"
      >
        {/* Drag handle indicator for mobile bottom sheet */}
        <div className="sm:hidden w-full flex justify-center pt-2.5 pb-1 bg-surface/95 shrink-0">
          <div className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header with fixed Close Button */}
        <div className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-slate-200/80 bg-surface/95 px-4 py-3 sm:p-5 backdrop-blur-md shrink-0">
          <div className="min-w-0 pr-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
                {character.role}
              </span>
              <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                {character.affiliation}
              </span>
            </div>

            <h2 className="mt-1 sm:mt-2 font-display text-lg sm:text-2xl font-bold tracking-tight text-ink">
              {character.name}
            </h2>

            {character.aliases && character.aliases.length > 0 && (
              <p className="mt-0.5 font-mono text-[11px] sm:text-xs text-ink-faint">
                aka {character.aliases.join(" · ")}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              restoreFocus()
              onClose()
            }}
            aria-label="Close dossier"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface text-ink-dim shadow-sm transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-5 space-y-4 text-left">
          <p className="text-xs sm:text-sm leading-relaxed text-ink-dim">
            {character.bio}
          </p>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint">
              Threads ({threads.length})
            </h3>
            {threads.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">
                No threads on record.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {threads.map(({ relationship, meta, otherName }) => (
                  <li key={relationship.id} className="flex gap-3">
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white shadow-sm"
                      style={{ backgroundColor: meta.color }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-ink">
                        {meta.label}
                      </p>
                      <p className="mt-0.5 text-xs sm:text-sm leading-snug text-ink-dim">
                        <span className="font-medium text-accent">
                          {otherName}
                        </span>
                        <span className="mx-1.5 text-ink-faint">—</span>
                        {relationship.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </motion.div>
    </MotionConfig>
  )
}

/**
 * Legend + type filter for the relationship graph. Every row is a toggle chip
 * over `RELATIONSHIP_META`: clicking sets the filter, clicking the active chip
 * again clears it (passes null to the parent).
 */
export function RelationshipLegend({
  activeFilter,
  onFilterType,
}: {
  activeFilter: RelationshipType | null
  onFilterType: (type: RelationshipType | null) => void
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {RELATIONSHIP_TYPES.map((type) => {
        const meta = RELATIONSHIP_META[type]
        const active = activeFilter === type
        return (
          <button
            key={type}
            type="button"
            onClick={() => onFilterType(active ? null : type)}
            aria-pressed={active}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-slate-200 bg-surface text-ink-dim hover:border-slate-300 hover:bg-surface-muted"
            )}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-xs font-semibold",
                  active ? "text-accent" : "text-ink"
                )}
              >
                {meta.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                {meta.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
