import { Check, CircleSlash } from "lucide-react"
import { cn } from "@/lib/utils"
import { canonTagKey, type EpisodeTag } from "@/lib/episode-tags"
import { CANON_TYPES } from "@/lib/canon-guide"

/**
 * The canon verdict for one episode, as a badge that is always present.
 *
 * The rest of the chip row is metadata a reader dips into; this is the one
 * thing they scan down the list for — "can I skip this?" — so it is the only
 * chip that is (a) never truncated by the overflow counter and (b) colour
 * coded: green for canon, amber for non-canon. Text is uppercase to separate it
 * from the sentence-case metadata chips beside it.
 *
 * The finer distinction (manga / anime-canon) is kept in the label and the
 * tooltip rather than in a third colour: three greens would defeat the point of
 * a two-state badge.
 */

const NON_CANON_KEY = canonTagKey(CANON_TYPES.FILLER)

export function isNonCanon(tag: EpisodeTag | null | undefined): boolean {
  return tag?.key === NON_CANON_KEY
}

export function CanonBadge({
  tag,
  onClick,
  className,
}: {
  tag: EpisodeTag
  onClick?: (tagKey: string) => void
  className?: string
}) {
  const nonCanon = isNonCanon(tag)
  const Icon = nonCanon ? CircleSlash : Check

  const classes = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10px] font-medium uppercase leading-[1.3] tracking-wide",
    nonCanon
      ? "border-warning/45 bg-warning/10 text-warning"
      : "border-success/45 bg-success/10 text-success",
    onClick && "transition-colors hover:border-current",
    className
  )

  const body = (
    <>
      <Icon className="h-3 w-3 shrink-0" strokeWidth={3} />
      {tag.label}
    </>
  )

  if (!onClick) {
    return (
      <span className={classes} title={tag.title}>
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick(tag.key)
      }}
      title={`${tag.title} Click to filter by this tag.`}
      className={classes}
    >
      {body}
    </button>
  )
}
