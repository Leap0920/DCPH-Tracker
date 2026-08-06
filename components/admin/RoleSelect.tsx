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
}: {
  userId: string
  role: Role
  isSelf: boolean
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

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={onChange}
        disabled={pending || isSelf}
        title={isSelf ? "You can't change your own role" : undefined}
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/20 disabled:opacity-60"
      >
        <option value="member">Member</option>
        <option value="moderator">Moderator</option>
        <option value="admin">Admin</option>
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
