"use client"

/**
 * The thumbs controls for one answer.
 *
 * A vote is optimistic: the selected thumb turns on the moment it is pressed and
 * only a failed request rolls it back. A reader who clicked a thumb has already
 * told us what they think, so waiting for a round trip before showing it would be
 * a lie of omission — and a failure that left the thumb lit would be a worse one.
 *
 * The component owns nothing but the request. It holds no provider knowledge, no
 * key and no message text: the route owns ownership, persistence and the wording
 * of a refusal, and the only address here is the route. A second vote replaces
 * the first in place, which is what the server's unique `(message_id, user_id)`
 * index guarantees and what this component's own state lets the reader see
 * without a reload.
 */
import * as React from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

/** The one address this component talks to. */
const FEEDBACK_ENDPOINT = "/api/ai-chat/feedback"

/** The two votes the route accepts. `value` is a number on the wire, not a word. */
export type FeedbackValue = 1 | -1

/**
 * What a reader sees when the vote did not reach the route. Deliberately fixed
 * and free of the raw failure (constraint 9): a network error's own text names
 * the browser's problem, not the reader's, and the route's 500 names server
 * configuration that a reader cannot act on.
 */
const RECORD_FAILED = "Could not record your feedback. Please try again."

export interface FeedbackControlsProps {
  /** The assistant message being rated. */
  messageId: string
  /** A vote the parent already knows about, if any. */
  initialValue?: FeedbackValue | null
  /** Called with the value the server accepted. */
  onRecorded?: (value: FeedbackValue) => void
  className?: string
}

export function FeedbackControls({
  messageId,
  initialValue = null,
  onRecorded,
  className,
}: FeedbackControlsProps) {
  const [value, setValue] = React.useState<FeedbackValue | null>(initialValue)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const vote = async (next: FeedbackValue) => {
    // A second press on the thumb already lit is not a second vote, and a press
    // while one is in flight would race the first.
    if (pending || next === value) return

    const previous = value
    setValue(next)
    setError(null)
    setPending(true)

    try {
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, value: next }),
      })
      if (!response.ok) {
        setValue(previous)
        setError(RECORD_FAILED)
        return
      }
      onRecorded?.(next)
    } catch {
      setValue(previous)
      setError(RECORD_FAILED)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        aria-pressed={value === 1}
        aria-label="Good answer"
        title="Good answer"
        disabled={pending}
        onClick={() => void vote(1)}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-6 w-6",
          value === 1 && "text-accent-bright"
        )}
      >
        <ThumbsUp aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        aria-pressed={value === -1}
        aria-label="Bad answer"
        title="Bad answer"
        disabled={pending}
        onClick={() => void vote(-1)}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-6 w-6",
          value === -1 && "text-danger"
        )}
      >
        <ThumbsDown aria-hidden className="size-3.5" />
      </button>
      {error !== null && (
        <p role="alert" className="pl-1 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
