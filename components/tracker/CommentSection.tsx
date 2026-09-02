"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { MessageSquare, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { avatarUrl } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/queries/keys"
import { MAX_COMMENT_LENGTH } from "@/lib/comment-constants"
import { redactForbiddenWords } from "@/lib/profanity"
import {
  addEpisodeComment,
  deleteEpisodeComment,
  fetchEpisodeComments,
  type EpisodeCommentAuthor,
  type EpisodeCommentRow,
  type EpisodeCommentsResult,
} from "@/lib/queries/client/episode"

type SelfProfile = {
  username: string
  display_name: string
  avatar_url: string | null
  role: "member" | "moderator" | "admin"
}

/**
 * What the delete dialog needs, captured when the trash button is clicked.
 *
 * A SNAPSHOT rather than an id lookup, deliberately: the delete is optimistic
 * and `onSettled` refetches, so the row can leave the list while the dialog is
 * still animating. Holding a copy means the copy on screen never blanks out
 * mid-sentence, and the dialog can name the author and quote the text — the best
 * defence against confirming the wrong row after the list has shifted.
 */
type DeleteTarget = {
  id: string
  isOwn: boolean
  authorLabel: string
  preview: string
}

/** Enough of the comment to recognise it, without an essay in the dialog. */
const PREVIEW_LENGTH = 160

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

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?"
}

function toAuthor(me: SelfProfile | null): EpisodeCommentAuthor | null {
  if (!me) return null
  return {
    username: me.username,
    display_name: me.display_name,
    avatar_url: me.avatar_url,
  }
}

export function CommentSection({ contentId }: { contentId: string }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [me, setMe] = useState<SelfProfile | null>(null)
  const [newComment, setNewComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  // Non-null while the delete confirmation dialog is open; null closes it.
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const commentsKey = queryKeys.content.comments(contentId)
  const isModerator = me?.role === "moderator" || me?.role === "admin"

  // ── Auth + own profile (ChatWindow.tsx:86-105 pattern; role from the base
  //    profiles table — public_profiles exposes no role column, and RLS grants
  //    authenticated users read on their own row, Navbar.tsx:32 pattern) ──
  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user || !active) return
      setUserId(user.id)

      supabase
        .from("profiles")
        .select("username, display_name, avatar_url, role")
        .eq("user_id", user.id)
        .single()
        .then(({ data: profileData }) => {
          if (profileData && active) setMe(profileData as SelfProfile)
        })
    })
    return () => {
      active = false
    }
  }, [supabase])

  // ── Comments list (oldest first; degrades to empty pre-migration) ──
  const commentsQuery = useQuery({
    queryKey: commentsKey,
    queryFn: () => fetchEpisodeComments(contentId),
  })
  const comments = commentsQuery.data?.comments ?? []

  // ── Optimistic post: temp id `temp-${uuid}`, replaced by the server row on
  //    success, rolled back on error (ChatWindow.tsx:169-210 pattern). ──
  const addMutation = useMutation({
    // The server takes the author from the session — no userId is sent.
    mutationFn: (body: string) => addEpisodeComment(contentId, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: commentsKey })
      const prev = queryClient.getQueryData<EpisodeCommentsResult>(commentsKey)
      const tempId = `temp-${crypto.randomUUID()}`
      const temp: EpisodeCommentRow = {
        id: tempId,
        content_id: contentId,
        user_id: userId as string,
        body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author: toAuthor(me),
      }
      queryClient.setQueryData<EpisodeCommentsResult>(commentsKey, (old) => ({
        comments: [...(old?.comments ?? []), temp],
        hasMore: old?.hasMore ?? false,
      }))
      return { tempId, prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(commentsKey, ctx.prev)
      // /api/comments returns user-safe strings ("Comment too long", "Comments
      // aren't available yet…", "Too many requests"), so showing the server's
      // own message beats a single catch-all sentence.
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't post your comment. Try again."
      )
    },
    onSuccess: (data, _vars, ctx) => {
      if (!ctx) return
      queryClient.setQueryData<EpisodeCommentsResult>(commentsKey, (old) => {
        const base = old?.comments ?? []
        const serverRow: EpisodeCommentRow = {
          ...data,
          author: toAuthor(me),
        }
        return {
          comments: base.map((c) => (c.id === ctx.tempId ? serverRow : c)),
          hasMore: old?.hasMore ?? false,
        }
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey })
    },
  })

  // ── Delete (own + moderator/admin for others; RLS is the backstop) ──
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEpisodeComment(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: commentsKey })
      const prev = queryClient.getQueryData<EpisodeCommentsResult>(commentsKey)
      queryClient.setQueryData<EpisodeCommentsResult>(commentsKey, (old) =>
        old ? { ...old, comments: old.comments.filter((c) => c.id !== id) } : old
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(commentsKey, ctx.prev)
      setError("Couldn't delete that comment. Try again.")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey })
    },
  })

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleSend() {
    // Redact client-side too: the optimistic comment must match the row the
    // server will store, otherwise the author sees their own uncensored text
    // for one round-trip. The server pass remains authoritative.
    const body = redactForbiddenWords(newComment.trim())
    if (!body || !userId || addMutation.isPending) return

    setNewComment("")
    requestAnimationFrame(() => autoGrow())
    addMutation.mutate(body)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function requestDelete(comment: EpisodeCommentRow, isOwn: boolean) {
    const author = comment.author
    setError(null)
    setDeleteTarget({
      id: comment.id,
      isOwn,
      authorLabel: author?.display_name || author?.username || "this user",
      preview:
        comment.body.length > PREVIEW_LENGTH
          ? `${comment.body.slice(0, PREVIEW_LENGTH).trimEnd()}…`
          : comment.body,
    })
  }

  function confirmDelete() {
    if (!deleteTarget || deleteMutation.isPending) return
    const { id } = deleteTarget
    // Close first: the removal is optimistic, so the row is already gone by the
    // next frame and holding the dialog open would be waiting for nothing. On
    // failure the mutation rolls the row back and surfaces the inline error;
    // the dialog does NOT reopen.
    setDeleteTarget(null)
    deleteMutation.mutate(id)
  }

  return (
    <section className="mt-6 border-t border-ink-dim/20 pt-6">
      <h2 className="mb-3 font-display text-sm text-ink-dim">Comments</h2>

      {commentsQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-dim/20 bg-surface-muted px-4 py-8 text-center">
          <MessageSquare className="h-6 w-6 text-ink-faint" />
          <p className="mt-3 text-sm text-ink-dim">No comments yet. Be the first to share your thoughts.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {comments.map((comment) => {
            const isOwn = comment.user_id === userId
            const canDelete = isOwn || isModerator
            const author = comment.author
            const pending = comment.id.startsWith("temp-")
            const profileHref = author?.username ? `/profile/${author.username}` : null

            const avatar = (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage
                  src={author?.avatar_url ?? avatarUrl(author?.display_name ?? "?")}
                />
                <AvatarFallback className="bg-accent text-xs text-white">
                  {initials(author?.display_name ?? "?")}
                </AvatarFallback>
              </Avatar>
            )

            return (
              <li key={comment.id} className="flex gap-3">
                {profileHref ? (
                  <Link href={profileHref} className="shrink-0">
                    {avatar}
                  </Link>
                ) : (
                  avatar
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        className="truncate text-sm font-medium text-ink"
                      >
                        {author?.display_name || author?.username || "Unknown"}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium text-ink">
                        {author?.display_name || author?.username || "Unknown"}
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                      {formatDay(comment.created_at)} · {formatTime(comment.created_at)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink",
                      pending && "opacity-60"
                    )}
                  >
                    {comment.body}
                  </p>
                </div>

                {/* `!pending` matters: a temp- id is client-side only, so
                    deleting an unconfirmed comment always failed against the
                    server. Mirrors ChatWindow's unsend guard. */}
                {canDelete && !pending && (
                  <button
                    type="button"
                    onClick={() => requestDelete(comment, isOwn)}
                    disabled={deleteMutation.isPending}
                    aria-label="Delete comment"
                    className="self-start rounded-md p-2 text-ink-faint transition-colors hover:bg-surface-muted hover:text-accent disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {commentsQuery.isError && (
        <p className="mt-3 text-xs text-accent">Couldn&apos;t load comments. Check your connection and refresh.</p>
      )}

      {/* Composer */}
      <div className="mt-4">
        {error && <p className="mb-2 px-1 text-xs text-accent">{error}</p>}

        {userId ? (
          <>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                maxLength={MAX_COMMENT_LENGTH}
                value={newComment}
                onChange={(e) => {
                  setNewComment(e.target.value)
                  autoGrow()
                }}
                onKeyDown={handleKeyDown}
                placeholder="Share your thoughts…"
                aria-label="Share your thoughts on this episode"
                className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-ink-dim/20 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <Button
                type="button"
                size="icon"
                onClick={handleSend}
                disabled={!newComment.trim() || addMutation.isPending}
                aria-label="Post comment"
                className="h-10 w-10 shrink-0 rounded-lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
              <kbd className="font-mono">Enter</kbd> to send ·{" "}
              <kbd className="font-mono">Shift + Enter</kbd> for a new line
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-dim/20 bg-surface-muted px-4 py-6 text-center sm:flex-row sm:justify-center">
            <p className="text-sm text-ink-dim">Sign in to comment.</p>
            <div className="flex items-center gap-2">
              <Button size="sm" className="rounded-lg" onClick={() => openAuthModal("signin")}>
                Sign In
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg border-ink-dim/20"
                onClick={() => openAuthModal("signup")}
              >
                Sign Up
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation — replaces window.confirm(). One dialog for the
          whole list, driven by `deleteTarget`; a per-row DialogTrigger would
          mount N dialogs and lose its target on every refetch. */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          // Covers Cancel, the built-in X, Esc and an overlay click.
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={(e) => {
            // Land focus on Cancel, not on the destructive action. Radix focuses
            // the first tabbable node (the X, one Tab from Delete) and a stray
            // Enter should never delete a comment. Queried by data attribute so
            // this does not depend on Button forwarding a ref.
            const cancel = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              "[data-cancel-delete]"
            )
            if (cancel) {
              e.preventDefault()
              cancel.focus()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete comment?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.isOwn
                ? "This permanently removes your comment for everyone. This can't be undone."
                : `This permanently removes ${deleteTarget?.authorLabel ?? "this user"}'s comment as a moderator. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>

          {/* Quote the target so the wrong row cannot be confirmed by accident.
              A sibling of DialogDescription, not a child: DialogDescription
              renders a <p>, and nesting block content inside it is invalid. */}
          {deleteTarget?.preview && (
            <p className="max-h-28 overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-ink-dim/20 bg-surface-muted px-3 py-2 text-sm text-ink-dim">
              {deleteTarget.preview}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              data-cancel-delete
              className="rounded-lg border-ink-dim/20"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-accent text-white hover:bg-accent-bright"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
