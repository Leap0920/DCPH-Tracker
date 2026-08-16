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
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="dossier-card w-full max-w-md p-5 outline-none sm:w-96"
      >
        <span className="dossier-stamp !right-14">RED STRING</span>

        <button
          type="button"
          onClick={() => {
            restoreFocus()
            onClose()
          }}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
            {character.role}
          </span>
          <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-dim">
            {character.affiliation}
          </span>
        </div>

        <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">
          {character.name}
        </h2>

        {character.aliases && character.aliases.length > 0 && (
          <p className="mt-1 font-mono text-xs text-ink-faint">
            aka {character.aliases.join(" · ")}
          </p>
        )}

        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          {character.bio}
        </p>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint">
            Threads
          </h3>
          {threads.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">
              No threads on record.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {threads.map(({ relationship, meta, otherName }) => (
                <li key={relationship.id} className="flex gap-3">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-ink">
                      {meta.label}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug text-ink-dim">
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
