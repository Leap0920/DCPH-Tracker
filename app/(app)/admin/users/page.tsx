import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { RoleSelect } from "@/components/admin/RoleSelect"
import { UserActions } from "@/components/admin/UserActions"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-50 text-green-600" },
  suspended: { label: "Suspended", className: "bg-amber-50 text-amber-600" },
  banned: { label: "Banned", className: "bg-red-50 text-red-600" },
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const me = await requireAdmin()
  const sp = await searchParams
  const q = sp.q?.trim() ?? ""
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()

  // Try with the moderation columns first. If the schema migration hasn't
  // been applied yet (column missing), fall back to the base fields and
  // treat every user as active.
  let query = supabase
    .from("profiles")
    .select("user_id, username, display_name, role, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)

  let { data: users, count } = await query

  if (users === null) {
    let fallback = supabase
      .from("profiles")
      .select("user_id, username, display_name, role, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to)
    if (q) fallback = fallback.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    const result = await fallback
    users = result.data?.map((u) => ({ ...u, status: "active" as const })) ?? null
    count = result.count
  }

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <h2 className="font-display text-sm tracking-tight text-ink-dim">
        Users ({total})
      </h2>

      <form className="relative max-w-sm">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search username or display name…"
          className="h-10 w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 font-mono text-[10px] text-ink-faint">User</th>
              <th className="p-3 font-mono text-[10px] text-ink-faint">Joined</th>
              <th className="p-3 font-mono text-[10px] text-ink-faint">Role</th>
              <th className="p-3 font-mono text-[10px] text-ink-faint">Status</th>
              <th className="p-3 font-mono text-[10px] text-ink-faint">Moderation</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              const statusMeta = STATUS_LABELS[u.status] ?? STATUS_LABELS.active
              return (
              <tr key={u.user_id} className="border-b border-slate-100 last:border-0 hover:bg-surface-muted">
                <td className="p-3">
                  <Link href={`/profile/${u.username}`} className="font-medium text-ink hover:underline">
                    {u.display_name}
                  </Link>
                  <span className="block font-mono text-[11px] text-ink-faint">@{u.username}</span>
                </td>
                <td className="p-3 font-mono text-xs text-ink-dim">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="p-3">
                  <RoleSelect
                    userId={u.user_id}
                    role={u.role}
                    isSelf={u.user_id === me.user_id}
                  />
                </td>
                <td className="p-3">
                  <span className={`inline-flex rounded-md px-2 py-0.5 font-mono text-[10px] ${statusMeta.className}`}>
                    {statusMeta.label}
                  </span>
                </td>
                <td className="p-3">
                  <UserActions
                    userId={u.user_id}
                    status={u.status ?? "active"}
                    isSelf={u.user_id === me.user_id}
                  />
                </td>
              </tr>
              )
            })}
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-sm text-ink-dim">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Link
            href={`/admin/users?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-disabled={page <= 1}
            className={`rounded-md border border-slate-200 px-3 py-1 font-mono text-xs ${
              page <= 1 ? "pointer-events-none opacity-40" : "text-ink hover:bg-surface-muted"
            }`}
          >
            ← Prev
          </Link>
          <span className="font-mono text-xs text-ink-dim">
            Page {page} / {totalPages}
          </span>
          <Link
            href={`/admin/users?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-disabled={page >= totalPages}
            className={`rounded-md border border-slate-200 px-3 py-1 font-mono text-xs ${
              page >= totalPages ? "pointer-events-none opacity-40" : "text-ink hover:bg-surface-muted"
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  )
}
