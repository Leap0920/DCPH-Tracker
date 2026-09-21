"use client"

/**
 * Every reference the model was given, in one list.
 *
 * This is the second view of the same `EvidenceRef[]` the chips come from, so
 * "what the model was given" has one source of truth. The panel is controlled
 * (`open`/`onOpenChange`) and renders in one of two shapes:
 *
 * - **inline** — an `aside`, no focus trap, so it never steals focus from the
 *   message a reader is reading;
 * - **modal** — `components/ui/dialog`, whose focus trap and Escape handling
 *   are the point of choosing it.
 *
 * A citation the validator marked `unknown` has no ref and so cannot be listed;
 * it is reported in words instead of omitted, because a panel that showed only
 * the resolvable citations would make a fabricated one invisible.
 */
import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import { TriangleAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { tagVariant } from "@/components/chat/CitationChips"
import type { CitationReport } from "@/lib/ai/citations"
import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"

export interface SourcesPanelProps {
  /** Every admitted reference, verbatim from the message view. */
  refs: EvidenceRef[]
  /** The verdict, so a fabricated citation is reported rather than omitted. */
  citations?: CitationReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The reference the opening chip pointed at, highlighted in the list. */
  highlight?: number | null
  /** Modal renders a `dialog` with a focus trap; inline renders an `aside`. */
  modal?: boolean
  /** Names the panel. One word is enough; the heading is the accessible name. */
  title?: string
  className?: string
}

/** The fabricated citations, as one sentence a reader can act on. */
function unknownNote(unknown: number[]): string {
  const ids = unknown.map((n) => `E${n}`).join(", ")
  return unknown.length === 1
    ? `The answer cited ${ids}, which was not among the sources supplied.`
    : `The answer cited ${ids}, which were not among the sources supplied.`
}

/**
 * The modal panel as a phone-sized sheet. `h-dvh` makes it the viewport and
 * `overflow-y-auto` makes it scroll its own content; the primitive's
 * `top-[50%]` / `translate-y-[-50%]` centring pair only cancels for an element
 * exactly as tall as the percentage base it resolves against, and `h-dvh` is
 * the *dynamic* viewport height, so the sheet pins itself to the top rather
 * than depending on that coincidence. From `sm` up the pair takes over again
 * and the panel is the centred card it has always been.
 *
 * The inline branch is an `aside` in the chat's own flow and takes none of
 * this: it has no viewport to fill.
 */
const SHEET =
  "h-dvh overflow-y-auto top-0 translate-y-0 sm:h-auto sm:overflow-y-visible sm:top-[50%] sm:translate-y-[-50%]"

function SourceList({
  refs,
  citations,
  highlight,
}: {
  refs: EvidenceRef[]
  citations: CitationReport | null
  highlight: number | null
}) {
  const unknown = citations?.unknown ?? []

  return (
    <div className="space-y-3">
      {refs.length === 0 ? (
        <p className="text-xs text-ink-dim">No sources were supplied for this answer.</p>
      ) : (
        <ol className="space-y-1">
          {refs.map((ref) => {
            const active = ref.n === highlight
            return (
              <li
                key={ref.n}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex items-baseline gap-2 rounded-md px-2 py-1.5 text-xs",
                  active ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface-muted"
                )}
              >
                <span className="font-mono text-ink-faint">E{ref.n}</span>
                <span
                  className={cn(
                    badgeVariants({ variant: tagVariant(ref.tag) }),
                    "px-1.5 py-0 text-[10px] leading-4"
                  )}
                >
                  {ref.tag}
                </span>
                <span className="min-w-0 flex-1 break-words text-ink">{ref.label}</span>
              </li>
            )
          })}
        </ol>
      )}

      {unknown.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>{unknownNote(unknown)}</span>
        </p>
      )}
    </div>
  )
}

export function SourcesPanel({
  refs,
  citations = null,
  open,
  onOpenChange,
  highlight = null,
  modal = false,
  title = "Sources",
  className,
}: SourcesPanelProps) {
  const reduce = useReducedMotion()
  const headingId = React.useId()
  // Radix restores focus only to a `DialogTrigger`, and this panel is opened by a
  // chip that lives outside it, so the opener is captured at mount and put back
  // by hand — otherwise closing the modal leaves focus on `<body>`.
  const openerRef = React.useRef<HTMLElement | null>(null)

  // An inline panel has no focus trap, so nothing inside it necessarily holds
  // focus when Escape is pressed. A document listener is what makes Escape
  // close it from anywhere; the modal case is Radix's own.
  React.useEffect(() => {
    if (!open || modal) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, modal, onOpenChange])

  if (!open) return null

  const list = <SourceList refs={refs} citations={citations} highlight={highlight} />

  if (modal) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(SHEET, className)}
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement as HTMLElement | null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            openerRef.current?.focus()
            openerRef.current = null
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Every source this answer was given.</DialogDescription>
          </DialogHeader>
          {list}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <motion.aside
      aria-labelledby={headingId}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("rounded-lg border border-line bg-surface p-3", className)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={headingId} className="font-display text-sm text-ink">
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close sources"
          onClick={() => onOpenChange(false)}
          className="size-6"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>
      {list}
    </motion.aside>
  )
}
