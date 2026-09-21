"use client"

/**
 * The conversations a reader can reopen, as a drawer over the chat.
 *
 * The list is the server's, not this component's: `GET /api/ai-chat/conversations`
 * already returns the 30 newest with archived rows excluded, so nothing here
 * re-sorts, filters or paginates — the drawer renders what it was handed and
 * never claims the list is complete.
 *
 * **Archive is not delete, and there is no undo.** `DELETE` on the route sets
 * `archived_at`: the transcript survives, every list read excludes it, and no
 * request can bring it back. That is why the guard against a mis-tap is an
 * inline confirmation in the row rather than a "restore" button after the fact —
 * an undo here would be a button that lies about what the route can do. A future
 * reader looking for the missing undo should stop at this comment.
 *
 * The component is prop-driven on purpose: the widget that will host it is
 * frozen, so the open conversation arrives as a prop and a loaded transcript
 * leaves through `onSelect`. It owns no chat state of its own.
 */
import * as React from "react"
import { Archive, Loader2, TriangleAlert } from "lucide-react"
import { cn, timeAgo } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** The one address this component talks to, for all three calls. */
const ENDPOINT = "/api/ai-chat/conversations"

/** A conversation as the route's `toConversationPayload` sends it. */
export interface ConversationSummary {
  id: string
  title: string | null
  messageCount: number
  /** Epoch ms, not an ISO string. */
  lastMessageAt: number
  archivedAt: number | null
}

/** A turn as the route's `toMessagePayload` sends it. */
export interface TranscriptMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  /** Epoch ms. */
  createdAt: number
}

export interface ConversationDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The conversation currently open in the chat; marked in the list. */
  activeConversationId?: string | null
  /** Called with the loaded transcript when the reader picks a conversation. */
  onSelect: (loaded: { id: string; title: string | null; messages: TranscriptMessage[] }) => void
  className?: string
}

/** What a null title reads as: a thread with no summary yet is still a thread. */
const UNTITLED = "Untitled conversation"

/**
 * Deliberately fixed and free of the raw failure, for the same reason
 * `FeedbackControls` fixes its own: a network error names the browser's problem
 * and a 500 names server configuration, neither of which a reader can act on.
 */
const LIST_FAILED = "Could not load your conversations."
const OPEN_FAILED = "Could not open that conversation."
const ARCHIVE_FAILED = "Could not archive that conversation. Please try again."

/** `timeAgo` takes an ISO string; `lastMessageAt` is epoch ms. */
function relativeTime(ms: number): string {
  // A non-finite reading would make `toISOString` throw, turning a bad row into
  // a blank drawer. An honest empty string is the worst it may cost.
  if (!Number.isFinite(ms)) return ""
  return timeAgo(new Date(ms).toISOString())
}

function messageCountLabel(count: number): string {
  return count === 1 ? "1 message" : `${count} messages`
}

/**
 * The drawer as a phone-sized sheet. `h-dvh` makes it the viewport and
 * `overflow-y-auto` makes it scroll its own content; the primitive's
 * `top-[50%]` / `translate-y-[-50%]` centring pair only cancels for an element
 * exactly as tall as the percentage base it resolves against, and `h-dvh` is
 * the *dynamic* viewport height, so the sheet pins itself to the top rather
 * than depending on that coincidence. From `sm` up the pair takes over again
 * and the drawer is the centred card it has always been.
 */
const SHEET =
  "h-dvh overflow-y-auto top-0 translate-y-0 sm:h-auto sm:overflow-y-visible sm:top-[50%] sm:translate-y-[-50%]"

export function ConversationDrawer({
  open,
  onOpenChange,
  activeConversationId = null,
  onSelect,
  className,
}: ConversationDrawerProps) {
  // `null` means "never loaded", which is what tells the first-load failure
  // apart from a refresh that failed with a list already on screen.
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /** A failed action on one row, kept apart from the list's own load failure. */
  const [notice, setNotice] = React.useState<string | null>(null)
  const [pendingSelectId, setPendingSelectId] = React.useState<string | null>(null)
  /** The row whose inline archive confirmation is showing. One at a time. */
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  // Radix restores focus only to a `DialogTrigger`, and the drawer is opened by a
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
      const body = (await response.json()) as { conversations?: ConversationSummary[] }
      setConversations(Array.isArray(body.conversations) ? body.conversations : [])
    } catch {
      // The previously loaded list is left untouched: a refresh that failed is
      // not a reason to take away conversations the reader was looking at.
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

  const select = async (conversation: ConversationSummary) => {
    if (pendingSelectId !== null) return
    setPendingSelectId(conversation.id)
    setNotice(null)
    try {
      const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(conversation.id)}`)
      if (!response.ok) {
        setNotice(OPEN_FAILED)
        return
      }
      const body = (await response.json()) as {
        id: string
        title: string | null
        messages: TranscriptMessage[]
      }
      onSelect({ id: body.id, title: body.title, messages: body.messages })
    } catch {
      setNotice(OPEN_FAILED)
    } finally {
      setPendingSelectId(null)
    }
  }

  const archive = async (id: string) => {
    // Captured before the removal so a failed request puts back exactly the list
    // that was on screen, not a re-fetch that might have moved on.
    const previous = conversations ?? []
    setConfirmingId(null)
    setNotice(null)
    setConversations(previous.filter((conversation) => conversation.id !== id))

    try {
      const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        setConversations(previous)
        setNotice(ARCHIVE_FAILED)
      }
    } catch {
      setConversations(previous)
      setNotice(ARCHIVE_FAILED)
    }
  }

  // Radix traps Tab while the drawer is mounted; its own focus restore only
  // covers a `DialogTrigger`, so `openerRef` carries that half here.
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
          <DialogTitle>Conversations</DialogTitle>
          <DialogDescription>Reopen a past conversation, or archive one you are done with.</DialogDescription>
        </DialogHeader>

        {conversations === null && error === null ? (
          <p role="status" className="flex items-center gap-2 text-xs text-ink-dim">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Loading conversations…
          </p>
        ) : (
          <div className="space-y-2">
            {loading && conversations !== null && (
              <p role="status" className="flex items-center gap-2 text-xs text-ink-faint">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Refreshing conversations…
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

            {conversations !== null && conversations.length === 0 && (
              <p className="text-xs text-ink-dim">
                No conversations yet. Start a chat and it will appear here.
              </p>
            )}

            {conversations !== null && conversations.length > 0 && (
              <ul aria-label="Conversations" className="max-h-[60dvh] space-y-2 overflow-y-auto">
                {conversations.map((conversation) => {
                  const current = conversation.id === activeConversationId
                  const pending = conversation.id === pendingSelectId
                  const confirming = conversation.id === confirmingId
                  const title = conversation.title ?? UNTITLED

                  return (
                    <li key={conversation.id} className="flex items-start gap-2 rounded-lg border border-line">
                      <button
                        type="button"
                        aria-current={current ? "true" : undefined}
                        aria-busy={pending || undefined}
                        disabled={pending}
                        onClick={() => void select(conversation)}
                        className={cn(
                          "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-bright disabled:opacity-50",
                          current && "bg-accent/10 ring-1 ring-accent/40"
                        )}
                      >
                        <span className="block truncate text-sm text-ink">{title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                          {pending && <Loader2 aria-hidden className="size-3 animate-spin" />}
                          <span>{relativeTime(conversation.lastMessageAt)}</span>
                          <span aria-hidden>·</span>
                          <span>{messageCountLabel(conversation.messageCount)}</span>
                        </span>
                      </button>

                      {confirming ? (
                        <div className="flex shrink-0 flex-col items-end gap-1 py-1.5 pr-2">
                          <span className="text-[11px] text-ink-dim">Archive this conversation?</span>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void archive(conversation.id)}
                            >
                              Archive
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
                          aria-label={`Archive ${title}`}
                          onClick={() => setConfirmingId(conversation.id)}
                          className="my-1.5 mr-2 size-11 shrink-0 sm:size-7"
                        >
                          <Archive aria-hidden className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
