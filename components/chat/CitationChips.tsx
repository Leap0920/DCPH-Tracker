"use client"

/**
 * The numbered references an answer used, as chips.
 *
 * The list is built from `EvidenceRef[]` and the server's `CitationReport` and
 * from nothing else. The answer text is never a prop and never parsed: Plan 4's
 * numbering is a contract (constraint 4), and a chip that came from a regex over
 * prose would be the drift the contract exists to prevent. The test that pins
 * this renders a message whose text cites a number no ref matches.
 *
 * A cited number the report marked `unknown` is a fabricated citation: it has no
 * ref, and it renders anyway, visually distinct and named as broken. Dropping it
 * would hide the one fact the validator went to the trouble of reporting.
 */
import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { badgeVariants, type BadgeVariant } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef, EvidenceTag } from "@/lib/ai/pipeline/assemble"

export interface CitationChipsProps {
  /** Every admitted reference, verbatim from the message view. */
  refs: EvidenceRef[]
  /** The server's verdict, or `null` when the turn carried none (v1). */
  citations: CitationReport | null
  /** Called with the cited number a reader chose; the panel opens there. */
  onSelect?: (n: number) => void
  className?: string
}

/** One chip: a resolved ref, or a cited number with no ref behind it. */
interface ChipEntry {
  key: string
  n: number
  tag: EvidenceTag | null
  label: string
  broken: boolean
}

/**
 * The tier label's tone, reusing the badge variants rather than a second
 * palette: the tag is the only thing that varies, so it is the only thing that
 * gets a variant.
 */
export function tagVariant(tag: EvidenceTag): BadgeVariant {
  if (tag === "[WIKI]") return "secondary"
  if (tag === "[CONV]") return "gold"
  return "default"
}

/** How a broken reference names itself, for a screen reader and the tooltip. */
export function brokenReferenceLabel(n: number): string {
  return `E${n} — cited but not among the sources supplied`
}

/**
 * The ordered chip list. `refs` is the admitted set, and it is also the guard
 * against a report that contradicts itself: a number that is both cited and
 * admitted resolves to its ref (one chip, not two), and only a number with no
 * ref at all is rendered broken.
 */
function toEntries(refs: EvidenceRef[], citations: CitationReport | null): ChipEntry[] {
  if (citations === null) return []

  const admitted = new Map<number, EvidenceRef>()
  for (const ref of refs) admitted.set(ref.n, ref)

  const entries: ChipEntry[] = []
  const seen = new Set<number>()

  for (const ref of citations.cited) {
    if (seen.has(ref.n)) continue
    seen.add(ref.n)
    const source = admitted.get(ref.n) ?? ref
    entries.push({ key: `ref-${ref.n}`, n: ref.n, tag: source.tag, label: source.label, broken: false })
  }

  for (const n of citations.unknown) {
    if (seen.has(n)) continue
    seen.add(n)
    const resolved = admitted.get(n)
    if (resolved) {
      entries.push({ key: `ref-${n}`, n, tag: resolved.tag, label: resolved.label, broken: false })
    } else {
      entries.push({ key: `missing-${n}`, n, tag: null, label: brokenReferenceLabel(n), broken: true })
    }
  }

  return entries
}

export function CitationChips({ refs, citations, onSelect, className }: CitationChipsProps) {
  const reduce = useReducedMotion()
  const entries = toEntries(refs, citations)

  // A turn with no verdict has no "used" list to render — the refs are what the
  // model *could* cite, not what it did. v1 sends neither, so this is empty there.
  if (entries.length === 0) return null

  return (
    <TooltipProvider delayDuration={0}>
      <motion.ol
        aria-label="Sources cited"
        initial={reduce ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn("flex flex-wrap items-center gap-1.5", className)}
      >
        {entries.map((entry) => (
          <li key={entry.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={entry.label}
                  onClick={() => onSelect?.(entry.n)}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-6 gap-1 rounded-full px-2 text-[11px] font-normal",
                    entry.broken
                      ? "border-danger/50 text-danger hover:bg-danger/10"
                      : "text-ink-dim hover:border-accent/50 hover:text-accent-bright"
                  )}
                >
                  <span className="font-mono">E{entry.n}</span>
                  {entry.tag !== null && (
                    <span
                      className={cn(
                        badgeVariants({ variant: tagVariant(entry.tag) }),
                        "px-1.5 py-0 text-[10px] leading-4"
                      )}
                    >
                      {entry.tag}
                    </span>
                  )}
                  {entry.broken && <TriangleAlert aria-hidden className="size-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{entry.label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </motion.ol>
    </TooltipProvider>
  )
}
