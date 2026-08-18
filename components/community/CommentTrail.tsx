"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/utils/supabase/client"
import type { CommentTrailItem } from "@/lib/queries/profile"

const PAGE_SIZE = 20

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, today)) return "Today"
  if (sameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

/**
 * Fetches one page of a user's comments, newest first, with episode context.
 * Mirrors the server-side getUserComments (lib/queries/profile.ts) — the
 * content_entries embed is not typed (episode_comments has no declared FK
 * relationship), so the join happens in code.
 */
async function fetchCommentPage(
  userId: string,
  offset: number
): Promise<{ comments: CommentTrailItem[]; hasMore: boolean }> {
  const supabase = createClient()

  const { data: rows, error } = await supabase
    .from("episode_comments")
    .select("id, content_id, body, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) throw error
  if (!rows || rows.length === 0) return { comments: [], hasMore: false }

  const contentIds = [...new Set(rows.map((r) => r.content_id))]
  const { data: entries, error: entriesError } = await supabase
    .from("content_entries")
    .select("id, slug, title, type")
    .in("id", contentIds)

  if (entriesError) throw entriesError

  const entryById = new Map((entries ?? []).map((e) => [e.id, e]))
  const comments: CommentTrailItem[] = rows.map((row) => {
    const entry = entryById.get(row.content_id)
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      content_id: row.content_id,
      episode_title: entry?.title ?? "Unknown",
      episode_slug: entry?.slug ?? "",
      episode_type: entry?.type ?? "episode",
    }
  })

  return { comments, hasMore: rows.length === PAGE_SIZE }
}

/**
 * A user's public comment history. The first page arrives from the server
 * (getUserComments in lib/queries/profile.ts); "Load More" pages the rest
 * client-side. Empty state mirrors CommentSection.tsx styling.
 */
export function CommentTrail({
  userId,
  initialComments,
  initialHasMore,
}: {
  userId: string
  initialComments: CommentTrailItem[]
  initialHasMore: boolean
}) {
  const [comments, setComments] = useState(initialComments)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLoadMore() {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    try {
      const next = await fetchCommentPage(userId, comments.length)
      setComments((prev) => [...prev, ...next.comments])
      setHasMore(next.hasMore)
    } catch {
      setError("Couldn't load more comments. Try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="mt-8 border-t border-ink-dim/20 pt-6">
      <h2 className="mb-3 font-display text-sm text-ink-dim">Comment Trail</h2>

      {comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-dim/20 bg-surface-muted px-4 py-8 text-center">
          <MessageSquare className="h-6 w-6 text-ink-faint" />
          <p className="mt-3 text-sm text-ink-dim">No comments yet.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id}>
              <div className="flex items-baseline gap-2">
                {comment.episode_slug ? (
                  <Link
                    href={`/tracker/${comment.episode_slug}`}
                    className="truncate text-sm font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
                  >
                    {comment.episode_title}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-medium text-ink">
                    {comment.episode_title}
                  </span>
                )}
                <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-dim">
                  {comment.episode_type.replace("_", " ")}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                  {formatDay(comment.created_at)} · {formatTime(comment.created_at)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink">
                {comment.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-xs text-accent">{error}</p>}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-ink-dim/20"
            onClick={handleLoadMore}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load More"
            )}
          </Button>
        </div>
      )}
    </section>
  )
}
