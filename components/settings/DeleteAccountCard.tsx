"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, TriangleAlert, UserX } from "lucide-react"
import { createClient } from "@/utils/supabase/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DELETE_CONFIRM_PHRASE, isDeleteConfirmed } from "@/lib/account-deletion"
import { deleteAccount } from "@/lib/queries/client/account"

/**
 * Danger-zone card: permanently deletes the signed-in account.
 *
 * Everything destructive happens in POST /api/account/delete. That is not a
 * stylistic choice — deleting a GoTrue user requires the service-role key,
 * which must never reach the browser. The route also re-checks the typed
 * confirmation itself, so the disabled button below is a UX affordance, not
 * the security boundary.
 *
 * What goes with the account is decided by Postgres, not by this file: every
 * public table declares `references auth.users(id) on delete cascade`. The
 * counts shown here are a courtesy summary, so the user can see the size of
 * what they are about to lose before they confirm.
 */

const FOOTPRINT_KEY = (userId: string) =>
  ["settings", "account-footprint", userId] as const

interface AccountFootprint {
  tracked: number
  comments: number
  messages: number
}

export function DeleteAccountCard({
  userId,
  email,
}: {
  userId: string
  email: string | null
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])

  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Never leave the gate satisfied between visits.
  useEffect(() => {
    if (!open) {
      setTyped("")
      setError(null)
    }
  }, [open])

  const { data: footprint } = useQuery<AccountFootprint>({
    queryKey: FOOTPRINT_KEY(userId),
    queryFn: async () => {
      const [tracked, comments, messages] = await Promise.all([
        supabase
          .from("watch_status")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("episode_comments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ])

      // episode_comments / chat_messages come from optional migrations: an
      // unapplied one must not make the card (or deletion) unavailable.
      for (const result of [comments, messages]) {
        if (result.error) throw result.error
      }
      if (tracked.error) throw tracked.error

      return {
        tracked: tracked.count ?? 0,
        comments: comments.count ?? 0,
        messages: messages.count ?? 0,
      }
    },
    enabled: Boolean(userId),
    staleTime: 60_000,
  })

  const deletion = useMutation({
    mutationFn: () => deleteAccount(DELETE_CONFIRM_PHRASE),
    onSuccess: async () => {
      // The user is already gone server-side, so signOut can legitimately fail
      // (GoTrue no longer recognises the session). Either way we must clear the
      // local caches: they hold this account's data.
      try {
        await supabase.auth.signOut()
      } catch {
        // Best-effort: the cookie is invalid now regardless.
      }
      queryClient.clear()
      router.replace("/?account=deleted")
      router.refresh()
    },
    onError: (err: unknown) => {
      setError(
        err instanceof Error ? err.message : "Could not delete your account."
      )
    },
  })

  const canConfirm = isDeleteConfirmed(typed) && !deletion.isPending

  return (
    <div className="rounded-xl border border-danger/30 bg-surface p-5">
      <h2 className="text-sm font-medium text-ink">Delete account</h2>
      <p className="mt-1 text-sm text-ink-dim">
        Permanently deletes your account, your profile, your codename and every
        trace of your activity — tracked entries, ratings, favorites, comments,
        chat messages and badges. This cannot be undone and there is no backup.
      </p>

      <ul className="mt-3 space-y-1 text-sm text-ink-dim">
        <li>
          <span className="font-medium text-ink">
            {(footprint?.tracked ?? 0).toLocaleString()}
          </span>{" "}
          tracked {footprint?.tracked === 1 ? "entry" : "entries"}
        </li>
        <li>
          <span className="font-medium text-ink">
            {(footprint?.comments ?? 0).toLocaleString()}
          </span>{" "}
          {footprint?.comments === 1 ? "comment" : "comments"}
        </li>
        <li>
          <span className="font-medium text-ink">
            {(footprint?.messages ?? 0).toLocaleString()}
          </span>{" "}
          chat {footprint?.messages === 1 ? "message" : "messages"}
        </li>
      </ul>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={deletion.isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UserX className="h-4 w-4" aria-hidden="true" />
        Delete my account
      </button>

      <Dialog open={open} onOpenChange={(next) => !deletion.isPending && setOpen(next)}>
        <DialogContent
          // Same reasoning as the reset dialog: the destructive button starts
          // disabled, so the typed gate is the safeguard.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-danger" aria-hidden="true" />
              Delete your account?
            </DialogTitle>
            <DialogDescription>
              This erases the account
              {email ? (
                <>
                  {" "}
                  for <span className="font-medium text-ink">{email}</span>
                </>
              ) : null}{" "}
              and everything attached to it — your profile and codename,{" "}
              <span className="font-medium text-ink">
                {(footprint?.tracked ?? 0).toLocaleString()}
              </span>{" "}
              tracked entries, ratings, favorites, comments, chat messages and
              badges. You will be signed out immediately. There is no undo and no
              backup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="block text-sm text-ink-dim">
              Type{" "}
              <span className="font-mono font-medium text-ink">
                {DELETE_CONFIRM_PHRASE}
              </span>{" "}
              to confirm
            </label>
            <input
              ref={inputRef}
              id="delete-confirm"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={deletion.isPending}
              className="w-full rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50"
              placeholder={DELETE_CONFIRM_PHRASE}
            />
          </div>

          {error && (
            <div
              role="status"
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={deletion.isPending}
              className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-dim/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deletion.mutate()}
              disabled={!canConfirm}
              className="inline-flex items-center gap-2 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletion.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {deletion.isPending ? "Deleting…" : "Delete my account"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
