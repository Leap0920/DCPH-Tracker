"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react"
import { createClient } from "@/utils/supabase/client"
import { queryKeys } from "@/lib/queries/keys"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RESET_CONFIRM_PHRASE, isResetConfirmed } from "@/lib/tracker-reset"
import { resetProgress } from "@/lib/queries/client/account"

/**
 * Danger-zone card: wipes the signed-in user's viewing progress.
 *
 * The delete runs through POST /api/account/reset-progress rather than against
 * PostgREST directly, because progress now lives in two tables and only one of
 * them is deletable from the browser — watch_events (the log behind the rolling
 * 7/30-day leaderboards) has DELETE revoked from `authenticated`. See the route
 * for the full reasoning.
 *
 * The route resolves the user id from the session cookie, so the `userId` prop
 * is used for cache keys and counts only. A tampered value cannot reach another
 * account's rows.
 */

const TRACKED_COUNT_KEY = (userId: string) =>
  ["settings", "tracked-count", userId] as const

export function ResetProgressCard({ userId }: { userId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Memoised: createClient() returns a fresh object each call, and an unstable
  // client identity is what broke the chat realtime subscription.
  const supabase = useMemo(() => createClient(), [])

  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear the typed phrase whenever the dialog closes, so reopening never starts
  // with the gate already satisfied.
  useEffect(() => {
    if (!open) setTyped("")
  }, [open])

  const { data: trackedCount, isPending: countPending } = useQuery({
    queryKey: TRACKED_COUNT_KEY(userId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("watch_status")
        .select("content_id", { count: "exact", head: true })
        .eq("user_id", userId)
      if (error) throw error
      return count ?? 0
    },
    enabled: Boolean(userId),
    staleTime: 30_000,
  })

  const reset = useMutation({
    mutationFn: () => resetProgress(RESET_CONFIRM_PHRASE),
    onSuccess: async (result) => {
      await Promise.all([
        // watchStatus.all is the prefix of watchStatus.byContent, so this
        // invalidates every per-entry watch query too.
        queryClient.invalidateQueries({
          queryKey: queryKeys.watchStatus.all(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.continueWatching.all(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.continueWatching.nextUp(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.analytics.self(userId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard.all() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profile.stats(userId),
        }),
        queryClient.invalidateQueries({ queryKey: TRACKED_COUNT_KEY(userId) }),
        // Community rating averages included this user's rating. Rather than
        // firing one invalidation per deleted row, drop the contentId segment
        // from a probe key and invalidate the whole rating namespace in one call.
        // ASSUMES contentId is the LAST segment of content.rating(contentId).
        result.contentIds.length > 0
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.content.rating("__probe__").slice(0, -1),
            })
          : Promise.resolve(),
      ])

      // Tracker and analytics are partly server-rendered; cache invalidation
      // alone leaves those payloads stale.
      router.refresh()

      setOpen(false)
      setMessage({
        kind: "success",
        text:
          result.tracked === 0
            ? "Nothing was tracked, so there was nothing to reset."
            : `Progress reset. Cleared ${result.tracked.toLocaleString()} ${
                result.tracked === 1 ? "entry" : "entries"
              }${
                result.eventsCleared === null
                  ? ". Your activity log could not be cleared — ask an admin to configure the service-role key."
                  : "."
              }`,
      })
    },
    onError: (error: unknown) => {
      setMessage({
        kind: "error",
        text:
          error instanceof Error ? error.message : "Could not reset your progress.",
      })
    },
  })

  const hasRecords = (trackedCount ?? 0) > 0
  const canConfirm = isResetConfirmed(typed) && !reset.isPending

  return (
    <div className="rounded-xl border border-danger/30 bg-surface p-5">
      <h2 className="text-sm font-medium text-ink">Reset progress</h2>
      <p className="mt-1 text-sm text-ink-dim">
        Clears your entire watch history — every watched and rewatched entry, your
        rewatch counts, your ratings, your favorites, and the activity log behind
        the weekly and monthly leaderboards. Your account, profile and comments
        are not affected. This cannot be undone.
      </p>

      <p className="mt-3 text-sm text-ink-dim">
        {countPending ? (
          <span className="text-ink-faint">Counting your tracked entries…</span>
        ) : hasRecords ? (
          <>
            You currently have{" "}
            <span className="font-medium text-ink">
              {(trackedCount ?? 0).toLocaleString()}
            </span>{" "}
            tracked {trackedCount === 1 ? "entry" : "entries"}.
          </>
        ) : (
          <span className="text-ink-faint">You have nothing tracked yet.</span>
        )}
      </p>

      {message && (
        <div
          role="status"
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            message.kind === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setMessage(null)
          setOpen(true)
        }}
        disabled={!hasRecords || countPending || reset.isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Reset progress
      </button>

      <Dialog open={open} onOpenChange={(next) => !reset.isPending && setOpen(next)}>
        <DialogContent
          // Focus the confirmation input rather than Cancel. Unlike the comment
          // delete dialog, the destructive button here starts DISABLED, so the
          // typed gate is the safeguard and stealing focus to Cancel only adds a
          // keystroke.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-danger" aria-hidden="true" />
              Reset your progress?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes all{" "}
              <span className="font-medium text-ink">
                {(trackedCount ?? 0).toLocaleString()}
              </span>{" "}
              of your tracked entries, including your ratings, favorites and the
              activity behind your leaderboard standing. Your account, profile and
              comments are not affected. There is no undo and no backup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="reset-confirm" className="block text-sm text-ink-dim">
              Type{" "}
              <span className="font-mono font-medium text-ink">
                {RESET_CONFIRM_PHRASE}
              </span>{" "}
              to confirm
            </label>
            <input
              ref={inputRef}
              id="reset-confirm"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={reset.isPending}
              className="w-full rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50"
              placeholder={RESET_CONFIRM_PHRASE}
            />
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={reset.isPending}
              className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-dim/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => reset.mutate()}
              disabled={!canConfirm}
              className="inline-flex items-center gap-2 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reset.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {reset.isPending ? "Resetting…" : "Reset everything"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
