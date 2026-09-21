"use client"

/**
 * What the bot remembers about the signed-in reader, as a panel over the chat.
 *
 * The point of the panel is transparency: these are the same facts the assembler
 * injects into the prompt (in `lib/ai/pipeline/assemble.ts` the memory block and
 * the evidence block are separate sections), so the reader can see them and
 * correct them. The list is the server's — `GET /api/ai-chat/memory` returns it
 * active-first and already capped — so nothing here re-sorts or filters; it
 * renders what it was handed and never claims the list is complete.
 *
 * `status` is the reason the panel exists at all. Only `active` facts reach the
 * prompt; `superseded` and `expired` rows are still stored and no longer used,
 * so a panel that rendered all three alike would tell the reader the bot still
 * believes something it has stopped believing. Non-active rows stay visible —
 * hiding them would hide exactly what the reader came to audit.
 *
 * **The delete is real.** `DELETE /api/ai-chat/memory?id=<uuid>` hard-deletes
 * the row, unlike the conversations endpoint, which archives. There is no undo,
 * and the endpoint takes exactly one id: it has no bulk delete, and neither the
 * route nor the `MemoryStore` behind it has a shape for one, so a later reader
 * should not add a "clear all" — the guard against a mis-tap is the inline
 * confirmation in the row.
 *
 * The component is prop-driven on purpose: the widget that will host it is
 * frozen, so it owns no chat state of its own.
 */
import * as React from "react"
import { Loader2, Trash2, TriangleAlert } from "lucide-react"
import { cn, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** The one address this component talks to, for both calls. */
const ENDPOINT = "/api/ai-chat/memory"

/** A fact as the route's `toPayload` sends it: no user id, no provenance. */
export interface MemoryFactView {
  id: string
  kind: string
  key: string
  value: string
  confidence: number
  /** Epoch ms, not an ISO string. */
  lastConfirmedAt: number
  status: "active" | "superseded" | "expired"
}

export interface MemoryPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

/**
 * Deliberately fixed and free of the raw failure, for the same reason
 * `ConversationDrawer` fixes its own: a network error names the browser's
 * problem and a 500 names server configuration, neither of which a reader can
 * act on.
 */
const LIST_FAILED = "Could not load what the bot remembers."
const DELETE_FAILED = "Could not delete that fact. Please try again."

/** The header sentence: the delete is a real delete, and that is not an aside. */
const DELETE_IS_REAL =
  "These are the facts the bot adds to its answers. Deleting one removes it permanently — there is no undo."

/**
 * The precedence rule in the reader's terms: memory holds preferences, while
 * anything about the show comes from the tracker's own data, which outranks it
 * (`lib/ai/memory/slots.ts`).
 */
const PRECEDENCE =
  "Memory holds your preferences. Facts about the show come from the tracker's own data, which outranks anything the bot remembers."

/**
 * `memoryEnabled === false` is a statement about the deployment, not an error,
 * so it is neither an alert nor a reason to hide the facts that are still there.
 */
const MEMORY_OFF =
  "Memory is off for this deployment, so the bot is not learning anything new. The facts stored before it was turned off are still listed below."

/** The honest empty: nothing stored is not the same as memory being off. */
const EMPTY = "The bot is not remembering anything about you yet."

/** `timeAgo` takes an ISO string; `lastConfirmedAt` is epoch ms. */
function relativeTime(ms: number): string {
  // A non-finite reading would make `toISOString` throw, turning a bad row into
  // a blank panel. An honest empty string is the worst it may cost.
  if (!Number.isFinite(ms)) return ""
  return timeAgo(new Date(ms).toISOString())
}

/** The prompt renders `conf 0.9`; the reader is shown a percentage instead. */
function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/**
 * The panel as a phone-sized sheet. `h-dvh` makes it the viewport and
 * `overflow-y-auto` makes it scroll its own content; the primitive's
 * `top-[50%]` / `translate-y-[-50%]` centring pair only cancels for an element
 * exactly as tall as the percentage base it resolves against, and `h-dvh` is
 * the *dynamic* viewport height, so the sheet pins itself to the top rather
 * than depending on that coincidence. From `sm` up the pair takes over again
 * and the panel is the centred card it has always been.
 */
const SHEET =
  "h-dvh overflow-y-auto top-0 translate-y-0 sm:h-auto sm:overflow-y-visible sm:top-[50%] sm:translate-y-[-50%]"

export function MemoryPanel({ open, onOpenChange, className }: MemoryPanelProps) {
  // `null` means "never loaded", which is what tells the first-load failure
  // apart from a refresh that failed with a list already on screen.
  const [facts, setFacts] = React.useState<MemoryFactView[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /** A failed delete, kept apart from the list's own load failure. */
  const [notice, setNotice] = React.useState<string | null>(null)
  /** The row whose inline delete confirmation is showing. One at a time. */
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  /** The server's cap, so the panel can say the list is capped rather than complete. */
  const [cap, setCap] = React.useState<number | null>(null)
  /** `null` is "the response did not say", which is not a claim that memory is off. */
  const [memoryEnabled, setMemoryEnabled] = React.useState<boolean | null>(null)
  // Radix restores focus only to a `DialogTrigger`, and the panel is opened by a
  // control outside it, so the opener is captured at mount and put back by hand.
  const openerRef = React.useRef<HTMLElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setConfirmingId(null)
    try {
      const response = await fetch(ENDPOINT)
      if (!response.ok) {
        setError(LIST_FAILED)
        return
      }
      const body = (await response.json()) as {
        facts?: MemoryFactView[]
        cap?: unknown
        memoryEnabled?: unknown
      }
      setFacts(Array.isArray(body.facts) ? body.facts : [])
      setCap(typeof body.cap === "number" ? body.cap : null)
      // Absent or non-boolean is unknown, so no claim is made either way; a
      // response that predates the field still renders its facts normally.
      setMemoryEnabled(typeof body.memoryEnabled === "boolean" ? body.memoryEnabled : null)
    } catch {
      // The previously loaded list is left untouched: a refresh that failed is
      // not a reason to take away facts the reader was looking at.
      setError(LIST_FAILED)
    } finally {
      setLoading(false)
    }
  }, [])

  // The list is fetched on the transition to open, and never while closed.
  React.useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const forget = async (id: string) => {
    // Captured before the removal so a failed request puts back exactly the list
    // that was on screen, not a re-fetch that might have moved on.
    const previous = facts ?? []
    setConfirmingId(null)
    setNotice(null)
    setFacts(previous.filter((fact) => fact.id !== id))

    try {
      const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        setFacts(previous)
        setNotice(DELETE_FAILED)
      }
    } catch {
      setFacts(previous)
      setNotice(DELETE_FAILED)
    }
  }

  // Radix traps Tab while the panel is mounted; its own focus restore only covers
  // a `DialogTrigger`, so `openerRef` carries that half here.
  if (!open) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(SHEET, "sm:max-w-md", className)}
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
          <DialogTitle>What the bot remembers</DialogTitle>
          <DialogDescription>{DELETE_IS_REAL}</DialogDescription>
        </DialogHeader>

        {memoryEnabled === false && (
          <p className="rounded-md border border-line bg-surface-muted px-2 py-1.5 text-xs text-ink-dim">
            {MEMORY_OFF}
          </p>
        )}

        {facts === null && error === null ? (
          <p role="status" className="flex items-center gap-2 text-xs text-ink-dim">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Loading what the bot remembers…
          </p>
        ) : (
          <div className="space-y-2">
            {loading && facts !== null && (
              <p role="status" className="flex items-center gap-2 text-xs text-ink-faint">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Refreshing…
              </p>
            )}

            {error !== null && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger"
              >
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            )}

            {notice !== null && (
              <p role="alert" className="rounded-md bg-danger/10 px-2 py-1.5 text-xs text-danger">
                {notice}
              </p>
            )}

            {facts !== null && facts.length === 0 && memoryEnabled !== false && (
              <p className="text-xs text-ink-dim">{EMPTY}</p>
            )}

            {facts !== null && facts.length > 0 && (
              <ul aria-label="Remembered facts" className="max-h-[60dvh] space-y-2 overflow-y-auto">
                {facts.map((fact) => {
                  const active = fact.status === "active"
                  const confirming = fact.id === confirmingId
                  const confirmed = relativeTime(fact.lastConfirmedAt)

                  return (
                    <li key={fact.id} className="flex items-start gap-2 rounded-lg border border-line p-2">
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">
                          <span className="font-medium">{fact.key}</span>
                          <span aria-hidden>: </span>
                          <span>{fact.value}</span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
                          <span>{fact.kind}</span>
                          <span aria-hidden>·</span>
                          <span>{confidenceLabel(fact.confidence)} confidence</span>
                          {confirmed !== "" && (
                            <>
                              <span aria-hidden>·</span>
                              <span>last confirmed {confirmed}</span>
                            </>
                          )}
                        </span>
                        {/* The distinction the reader came for: in use, or stored but no longer used. */}
                        <span
                          className={cn(
                            "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            active ? "bg-accent/10 text-accent-bright" : "bg-surface-muted text-ink-dim"
                          )}
                        >
                          {active ? "In use" : `No longer used (${fact.status})`}
                        </span>
                      </div>

                      {confirming ? (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[11px] text-ink-dim">Delete this fact?</span>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void forget(fact.id)}
                            >
                              Delete
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${fact.key}`}
                          onClick={() => setConfirmingId(fact.id)}
                          className="size-11 shrink-0 sm:size-7"
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {facts !== null && cap !== null && facts.length >= cap && (
              <p className="text-[11px] text-ink-faint">
                This list is capped at {cap}; there may be more stored.
              </p>
            )}

            <p className="text-[11px] text-ink-faint">{PRECEDENCE}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
