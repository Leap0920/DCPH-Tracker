"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { updateUserRole } from "@/lib/actions/admin-system"

type Role = "member" | "moderator" | "admin"

export function RoleSelect({
  userId,
  role,
  isSelf,
  isProtected,
}: {
  userId: string
  role: Role
  isSelf: boolean
  isProtected?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState<Role>(role)
  const [error, setError] = useState<string | null>(null)

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Role
    const prev = value
    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await updateUserRole(userId, next)
      if (result.ok) {
        router.refresh()
      } else {
        setValue(prev)
        setError(result.error)
      }
    })
  }

  const locked = isSelf || isProtected

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={onChange}
        disabled={pending || locked}
        title={locked ? (isProtected ? "System owner — protected account" : "You can't change your own role") : undefined}
        className="h-8 rounded-md border border-ink-dim/20 bg-surface px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
      >
        <option value="member">Member</option>
        <option value="moderator">Moderator</option>
        <option value="admin">Admin</option>
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}
