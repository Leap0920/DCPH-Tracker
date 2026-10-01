"use client"

import { useEffect, useState } from "react"
import {
  Download,
  Film,
  Network,
  PenLine,
  TriangleAlert,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  WHATS_NEW_DESCRIPTION,
  WHATS_NEW_ENTRIES,
  WHATS_NEW_ISSUE,
  WHATS_NEW_TITLE,
  WHATS_NEW_VERSION,
  type WhatsNewIcon,
} from "@/lib/whats-new"

const ENTRY_ICON: Record<WhatsNewIcon, LucideIcon> = {
  download: Download,
  web: Network,
  ranks: Trophy,
  player: Film,
  speed: Zap,
  palette: PenLine,
}

/**
 * Appearance timing. Same-visit dialogs (the lazily loaded /characters quality
 * chooser, the auth modal) can mount a few hundred ms after us, so the first
 * check waits a beat — an immediate one would miss them and stack two modals.
 * While another dialog owns the screen, keep re-checking; after MAX_RECHECKS
 * this open goes unannounced (the next one gets another chance).
 */
const FIRST_ATTEMPT_DELAY_MS = 1200
const RECHECK_INTERVAL_MS = 1500
const MAX_RECHECKS = 40

/**
 * The "What's new" notice.
 *
 * The owner's rule: it appears on every open of the site — no memory of past
 * views, no "already dismissed" state — so every visitor lands on the update
 * board once per visit. It steps aside only while another dialog owns the
 * screen (both the quality chooser on /characters and the auth modal can open
 * on the same visit), re-checking until the stage is clear.
 */
export function WhatsNewNotice() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    // Returns true once the stage is ours (shown), false while another
    // overlay owns the screen.
    const attempt = (): boolean => {
      if (document.querySelector('[role="dialog"]')) return false
      setOpen(true)
      return true
    }

    let checks = 0
    const step = () => {
      if (cancelled) return
      if (attempt()) return
      if (++checks >= MAX_RECHECKS) return
      timer = window.setTimeout(step, RECHECK_INTERVAL_MS)
    }
    timer = window.setTimeout(step, FIRST_ATTEMPT_DELAY_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc / backdrop / the X just close it for now — the next open brings
        // it back, by the owner's rule.
        if (!next) setOpen(false)
      }}
    >
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg gap-0 rounded-2xl border-line bg-surface p-0 shadow-lift">
        <DialogHeader className="border-b border-line px-5 py-4 text-left sm:text-left">
          <DialogTitle className="font-display text-lg tracking-tight">
            {WHATS_NEW_TITLE}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-dim">
            {WHATS_NEW_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-2 overflow-y-auto px-5 py-4">
          {WHATS_NEW_ENTRIES.map((entry) => {
            const Icon = ENTRY_ICON[entry.icon]
            return (
              <div
                key={entry.title}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-dim">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{entry.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">
                    {entry.body}
                  </p>
                </div>
              </div>
            )
          })}

          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-400/10 text-amber-300">
              <TriangleAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-200">
                {WHATS_NEW_ISSUE.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">
                {WHATS_NEW_ISSUE.body}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            {WHATS_NEW_VERSION}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-card transition-colors hover:bg-accent-bright"
          >
            Got it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
