/**
 * Content-type badges — single source of truth.
 *
 * The colour strings themselves live in components/ui/badge.tsx (`badgeTone`)
 * for two reasons:
 *   1. Tailwind's content globs are ./app and ./components only — class
 *      literals in lib/ are never scanned, so they'd silently not be emitted.
 *   2. The <Badge> component and the raw-className call sites (ContentCard,
 *      /favorites, /search) then cannot drift apart: both resolve through the
 *      same tone table.
 *
 * Tiers: gold = theatrical, crimson = canon-adjacent premium, filled gray =
 * other media/spin-offs, outline gray = the episode bulk. The type label is
 * already spelled out next to the chip, so hue is not carrying meaning —
 * brightness ranks how central the entry is to the main canon.
 */

import { badgeTone, type BadgeVariant } from "@/components/ui/badge"

/** Content type → <Badge variant>. Consumers fall back to "outline". */
export const typeBadgeVariant: Record<string, BadgeVariant> = {
  movie: "gold",
  special: "default",
  ova: "secondary",
  live_action: "secondary",
  magic_kaito: "secondary",
  hanzawa: "secondary",
  zero_tea_time: "secondary",
  episode: "outline",
}

/**
 * Content type → border/bg/text classes only (no sizing), for call sites that
 * build their own chip instead of using <Badge>. Derived from the table above.
 */
export const typeBadgeClass: Record<string, string> = Object.fromEntries(
  Object.entries(typeBadgeVariant).map(([type, variant]) => [type, badgeTone[variant]])
)
