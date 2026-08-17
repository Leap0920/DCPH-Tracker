"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldAlert, ShieldCheck, UserX } from "lucide-react"
import {
  deleteUserAccount,
  setUserStatus,
  type ActionResult,
  type UserStatus,
} from "@/lib/actions/admin-system"

const DEFAULT_REASON = "Terms of service violation"

export function UserActions({
  userId,
  status,
  isSelf,
}: {
  userId: string
  status: UserStatus
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<ActionResult>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  if (isSelf) return <span className="text-xs text-ink-faint">N/A</span>

  return (
    <div className="flex flex-col items-end gap-2 md:flex-row md:items-center">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() =>
            run(() =>
              setUserStatus(userId, status === "active" ? "suspended" : "active", DEFAULT_REASON)
            )
          }
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-surface px-2 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
        >
          {status === "suspended" ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" /> Unsuspend
            </>
          ) : (
            <>
              <ShieldAlert className="h-3.5 w-3.5" /> Suspend
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() =>
            run(() =>
              setUserStatus(userId, status === "banned" ? "active" : "banned", DEFAULT_REASON)
            )
          }
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 text-xs text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          {status === "banned" ? "Unban" : "Ban"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Permanently delete this account? This cannot be undone.`)) {
              run(() => deleteUserAccount(userId))
            }
          }}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-surface px-2 text-xs text-ink transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-60"
        >
          <UserX className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}