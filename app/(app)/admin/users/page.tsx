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
      <h2 className="font-display text-sm uppercase tracking-widest text-gray-500">
        Users ({total})
      </h2>

      <form className="relative max-w-sm">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search username or display name…"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
        />
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">User</th>
              <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Joined</th>
              <th className="p-3 font-mono text-[10px] uppercase tracking-widest text-gray-400">Role</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.user_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="p-3">
                  <Link href={`/profile/${u.username}`} className="font-medium text-gray-900 hover:underline">
                    {u.display_name}
                  </Link>
                  <span className="block font-mono text-[11px] text-gray-400">@{u.username}</span>
                </td>
                <td className="p-3 font-mono text-xs text-gray-500">
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
                <td colSpan={3} className="p-10 text-center text-sm text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <span className="font-mono text-xs text-gray-500">
            Page {page} / {totalPages}
          </span>
        </div>
      )}
    </div>
  )
}
