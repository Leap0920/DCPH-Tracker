"use client"

import { useEffect, useState } from "react"
import { Gauge, Sparkles, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  TIERS,
  TIER_COPY,
  type QualityPreference,
  type QualityTier,
  type TierSuggestion,
} from "@/lib/device-tier"

const TIER_ICON: Record<QualityTier, typeof Sparkles> = {
  high: Sparkles,
  balanced: Gauge,
  low: Zap,
}

/**
 * The graphics-quality chooser.
 *
 * It appears once, on the visitor's first visit to /characters, pre-selecting
 * what detection concluded about their device — and it stays reachable
 * afterwards from the Graphics chip on the graph, so a wrong first guess (or a
 * device that behaves differently than it advertises) is never a dead end.
 *
 * "Detected" is marked on whichever card detection picked, and the reasoning is
 * spelled out underneath: a visitor who is told why the app thinks their phone
 * is mid-range is far more likely to leave the setting alone.
 */
export function QualityDialog({
  open,
  onOpenChange,
  preference,
  suggestion,
  notice,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the visitor chose before, or null on a first visit. */
  preference: QualityPreference | null
  suggestion: TierSuggestion
  /** Extra line shown when the frame probe lowered the tier by itself. */
  notice?: string | null
  onApply: (preference: QualityPreference) => void
}) {
  const [choice, setChoice] = useState<QualityTier>(preference?.tier ?? suggestion.tier)

  // Reopening after an auto-adjustment should show where we actually are now.
  useEffect(() => {
    if (open) setChoice(preference?.tier ?? suggestion.tier)
  }, [open, preference?.tier, suggestion.tier])

  const firstVisit = preference === null
  const apply = () => {
    onApply({
      tier: choice,
      // Accepting the suggestion keeps it adaptive; choosing something else is
      // an explicit instruction that detection and the frame probe leave alone.
      source: choice === suggestion.tier ? "auto" : "user",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 rounded-2xl border-line bg-surface p-0 shadow-lift">
        <DialogHeader className="border-b border-line px-5 py-4 text-left sm:text-left">
          <DialogTitle className="font-display text-lg tracking-tight">
            Graphics quality
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-dim">
            {firstVisit
              ? "So the red-string graph stays smooth on your device. Pick a setting — you can change it anytime."
              : "Adjust how much the red-string graph animates."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 py-4" role="radiogroup" aria-label="Graphics quality">
          {TIERS.map((tier) => {
            const copy = TIER_COPY[tier]
            const Icon = TIER_ICON[tier]
            const active = choice === tier
            const detected = suggestion.tier === tier
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChoice(tier)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200",
                  active
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface hover:border-ink-faint/40 hover:bg-surface-muted"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                    active
                      ? "border-accent/40 bg-accent/10 text-accent-bright"
                      : "border-line bg-surface-muted text-ink-dim"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        active ? "text-accent-bright" : "text-ink"
                      )}
                    >
                      {copy.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                      {copy.blurb}
                    </span>
                    {detected && (
                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-dim">
                        Detected
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-ink-dim">
                    {copy.details}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="space-y-3 border-t border-line px-5 py-4">
          <p className="font-mono text-[10px] leading-relaxed text-ink-faint">
            Detected from: {suggestion.reasons.join(" · ")}
          </p>

          {notice && (
            <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-[11px] leading-snug text-ink-dim">
              {notice}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {!firstVisit && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-card transition-colors hover:bg-accent-bright"
            >
              {firstVisit ? `Use ${TIER_COPY[choice].label}` : "Apply"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
