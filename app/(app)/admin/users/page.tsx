import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { RoleSelect } from "@/components/admin/RoleSelect"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

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
  let query = supabase
    .from("profiles")
    .select("user_id, username, display_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)

  const { data: users, count } = await query
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
          placeholder="Search username or display nameâ€¦"
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
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
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
              </tr>
            ))}
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="p-10 text-center text-sm text-ink-dim">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <span className="font-mono text-xs text-ink-dim">
            Page {page} / {totalPages}
          </span>
        </div>
      )}
    </div>
  )
}
