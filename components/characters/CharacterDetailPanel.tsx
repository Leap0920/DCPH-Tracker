"use client"

import { useCallback, useEffect, useRef } from "react"
import Image from "next/image"
import { motion, MotionConfig, type Variants } from "framer-motion"
import { X } from "lucide-react"
import type { Character, RelationshipMeta } from "@/lib/characters-guide"
import type { CharacterDossier } from "@/lib/characters-detail"
import { getRelationshipColor } from "@/components/characters/graph-theme"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"

const EASE = [0.16, 1, 0.3, 1] as const

const threadList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.08 } },
}

const threadItem: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE } },
}

/**
 * CharacterDetailPanel — the character dossier beside the graph. Thread dot
 * colors come from the shared resolver, so a thread's color always matches
 * the string drawn in the graph, in both themes.
 *
 * Two data sources, deliberately:
 *
 *  * the header and the portrait come from the lightweight `character` the
 *    server already sent, so they paint on the tap itself;
 *  * the bio and the thread prose come from `dossier`, fetched on demand (see
 *    lib/characters-detail.ts). Until it lands the panel holds the space with
 *    skeletons instead of shifting the layout.
 *
 * Crimson text and icons use accent-bright rather than accent: the plain
 * accent (#C8102E) is only ~3.3:1 against the near-black surface, while
 * accent-bright clears 4.5:1.
 */
export function CharacterDetailPanel({
  character,
  meta,
  dossier,
  onClose,
}: {
  character: Character
  meta: RelationshipMeta
  dossier: CharacterDossier | null
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target && target.isConnected) target.focus()
  }, [])

  // Focus moves into the dossier on open and back where it came from on close.
  useEffect(() => {
    const panel = panelRef.current
    const active = document.activeElement
    const canFocus =
      active instanceof Element &&
      active !== panel &&
      typeof (active as { focus?: () => void }).focus === "function"
    returnFocusRef.current = canFocus ? (active as HTMLElement) : null
    panel?.focus()
    return () => {
      const current = document.activeElement
      const focusInsidePanel = panel !== null && panel.contains(current)
      if (current === document.body || focusInsidePanel) restoreFocus()
    }
  }, [restoreFocus])

  const handleClose = useCallback(() => {
    restoreFocus()
    onClose()
  }, [onClose, restoreFocus])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleClose])

  const threads = dossier ? dossier.threads : []

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label={character.name}
        tabIndex={-1}
        initial={{ opacity: 0, y: 48, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="dossier-card relative flex max-h-[56vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface p-0 shadow-card outline-none sm:max-h-[85vh] sm:rounded-2xl sm:border"
      >
        {/* Accent hairline that sweeps in on open */}
        <span
          aria-hidden
          className="dcph-underline-sweep absolute left-0 right-0 top-0 z-30 h-[2px] bg-gradient-to-r from-accent via-accent-bright to-transparent"
        />

        {/* Close stays pinned over the scrolling body: the header below it
            scrolls away on purpose, and a sheet whose only exit scrolls out of
            view is a trap on a phone. */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close dossier"
          className="absolute right-3 top-3 z-30 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-dim shadow-sm transition-all hover:rotate-90 hover:border-accent/40 hover:bg-accent-soft hover:text-accent-bright sm:right-4 sm:top-4"
        >
          <X className="h-4 w-4" />
        </button>

        {/* One scroll surface: the role/name/aka block leaves with the rest of
            the details instead of holding a strip at the top of the card. */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-left sm:p-5">
          <div className="border-b border-line pb-3 pr-12 sm:pb-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent-bright">
                {character.role}
              </span>
              <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                {character.affiliation}
              </span>
            </div>

            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
              className="mt-1 font-display text-lg font-bold tracking-tight text-ink sm:mt-2 sm:text-2xl"
            >
              {character.name}
            </motion.h2>

            {character.aliases && character.aliases.length > 0 && (
              <p className="mt-0.5 font-mono text-[11px] text-ink-faint sm:text-xs">
                aka {character.aliases.join(" · ")}
              </p>
            )}
          </div>

          {/* Character portrait — its path rides along with the lightweight
              character, so the fetch starts on the tap itself. */}
          {character.image && (
            <div className="flex justify-center">
              <Image
                src={character.image}
                alt={character.name}
                width={160}
                height={160}
                loading="lazy"
                className="h-32 w-32 rounded-xl border border-line object-cover shadow-card sm:h-40 sm:w-40"
              />
            </div>
          )}

          {dossier ? (
            <p className="text-xs leading-relaxed text-ink-dim sm:text-sm">
              {dossier.bio}
            </p>
          ) : (
            <SkeletonRegion className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </SkeletonRegion>
          )}

          <div className="border-t border-line pt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint">
              Threads{dossier ? ` (${threads.length})` : ""}
            </h3>
            {!dossier ? (
              <SkeletonRegion className="mt-3 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </SkeletonRegion>
            ) : threads.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">No threads on record.</p>
            ) : (
              <motion.ul
                variants={threadList}
                initial="hidden"
                animate="show"
                className="mt-3 space-y-3"
              >
                {threads.map((thread) => (
                  <motion.li
                    key={thread.id}
                    variants={threadItem}
                    className="group flex gap-3"
                  >
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface transition-transform duration-200 group-hover:scale-125"
                      style={{ backgroundColor: getRelationshipColor(thread.type, isDark) }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-ink">
                        {meta[thread.type].label}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-ink-dim sm:text-sm">
                        <span className="font-medium text-accent-bright">
                          {thread.otherName}
                        </span>
                        <span className="mx-1.5 text-ink-faint">—</span>
                        {thread.detail}
                      </p>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </div>
        </div>
      </motion.div>
    </MotionConfig>
  )
}
