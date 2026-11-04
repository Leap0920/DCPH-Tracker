/**
 * One visual language for episode tags, shared by the row chips and the filter
 * menu — a chip whose colour in the menu disagrees with the row it filters is
 * decoration pretending to be a legend.
 *
 * Classification is the one axis a reader scans down the list ("can I skip
 * this?"), so it is the only family that gets a state colour: green means
 * canon, amber means non-canon. Case type and runtime stay neutral so a row
 * with four chips does not read as a warning label; milestones are gold because
 * they are rare.
 */

import {
  BadgeCheck,
  CircleSlash,
  Clock,
  GitBranch,
  ShieldAlert,
  Trophy,
  type LucideIcon,
} from "lucide-react"
import { TAG_KINDS, canonTagKey, type TagKind } from "@/lib/episode-tags"
import { CANON_TYPES } from "@/lib/canon-guide"

export const TAG_STYLES: Record<TagKind, { icon: LucideIcon; chip: string; iconClass: string }> = {
  [TAG_KINDS.CANON]: {
    icon: BadgeCheck,
    chip: "border-success/45 bg-success/10 text-success",
    iconClass: "text-success",
  },
  [TAG_KINDS.ARC]: {
    icon: GitBranch,
    chip: "border-line bg-surface-muted text-ink-dim",
    iconClass: "text-ink-faint",
  },
  [TAG_KINDS.CRIME]: {
    icon: ShieldAlert,
    chip: "border-line/80 bg-transparent text-ink-dim",
    iconClass: "text-ink-faint",
  },
  [TAG_KINDS.LENGTH]: {
    icon: Clock,
    chip: "border-line/80 bg-transparent text-ink-dim",
    iconClass: "text-ink-faint",
  },
  [TAG_KINDS.MILESTONE]: {
    icon: Trophy,
    chip: "border-gold-seal/45 bg-gold-seal/10 text-gold-seal",
    iconClass: "text-gold-seal",
  },
}

export function tagStyle(kind: TagKind) {
  return TAG_STYLES[kind] ?? TAG_STYLES.arc
}

/**
 * Per-facet overrides. Canon is two opposite answers, so the facets carry the
 * verdict colour: green for anything that is part of the main story, amber for
 * the episodes that can be skipped. Everything else falls back to the family
 * style.
 */
export const TAG_FACET_STYLES: Record<
  string,
  { icon: LucideIcon; iconClass: string; chip?: string }
> = {
  [canonTagKey(CANON_TYPES.MANGA)]: {
    icon: BadgeCheck,
    iconClass: "text-success",
    chip: "border-success/45 bg-success/10 text-success",
  },
  [canonTagKey(CANON_TYPES.ANIME_CANON)]: {
    icon: BadgeCheck,
    iconClass: "text-success",
    chip: "border-success/45 bg-success/10 text-success",
  },
  [canonTagKey(CANON_TYPES.FILLER)]: {
    icon: CircleSlash,
    iconClass: "text-warning",
    chip: "border-warning/45 bg-warning/10 text-warning",
  },
}

export function tagFacetStyle(tag: { key: string; kind: TagKind }) {
  const base = tagStyle(tag.kind)
  return TAG_FACET_STYLES[tag.key] ?? { icon: base.icon, iconClass: base.iconClass }
}
