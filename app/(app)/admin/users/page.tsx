import Link from "next/link"
import { Search } from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { requireAdmin } from "@/lib/auth/admin"
import { RoleSelect } from "@/components/admin/RoleSelect"
import { UserActions } from "@/components/admin/UserActions"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "border-success/25 bg-success/10 text-success" },
  suspended: { label: "Suspended", className: "border-warning/25 bg-warning/10 text-warning" },
  banned: { label: "Banned", className: "border-danger/25 bg-danger/10 text-danger" },
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Users
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-ink-dim">{total}</span>
        </div>

        <form className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search username or display name…"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/30"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-white/[0.02] text-left">
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
                User
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
                Joined
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
                Role
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
                Status
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
                Moderation
              </th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              const statusMeta = STATUS_LABELS[u.status] ?? STATUS_LABELS.active
              return (
                <tr
                  key={u.user_id}
                  className="border-b border-line transition-colors last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/profile/${u.username}`}
                      className="rounded-sm text-[13px] text-ink hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
                    >
                      {u.display_name}
                    </Link>
                    <span className="block font-mono text-[10px] text-ink-faint">@{u.username}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums text-ink-dim">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <RoleSelect
                      userId={u.user_id}
                      role={u.role}
                      isSelf={u.user_id === me.user_id}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${statusMeta.className}`}
                    >
                      {statusMeta.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
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
                <td colSpan={5} className="px-3 py-12 text-center text-xs text-ink-dim">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Link
            href={`/admin/users?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-disabled={page <= 1}
            className={`rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 ${
              page <= 1
                ? "pointer-events-none opacity-40"
                : "text-ink-dim hover:bg-white/[0.03] hover:text-ink"
            }`}
          >
            ← Prev
          </Link>
          <span className="font-mono text-[10px] tabular-nums text-ink-faint">
            {page} / {totalPages}
          </span>
          <Link
            href={`/admin/users?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-disabled={page >= totalPages}
            className={`rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 ${
              page >= totalPages
                ? "pointer-events-none opacity-40"
                : "text-ink-dim hover:bg-white/[0.03] hover:text-ink"
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  )
}
