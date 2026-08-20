import { requireAdmin } from "@/lib/auth/admin"
import { AdminNav } from "@/components/admin/AdminNav"

export const metadata = {
  title: "Admin — Detective Conan PH",
  robots: { index: false, follow: false },
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Defense-in-depth: middleware also blocks non-admins, but guard here too.
  const profile = await requireAdmin()

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur supports-[backdrop-filter]:bg-page/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="font-display text-[13px] tracking-tight text-ink">
            Admin
          </span>
          <span aria-hidden className="text-ink-faint">
            /
          </span>
          <span className="truncate font-mono text-[11px] text-ink-dim">
            {profile.display_name}
          </span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint sm:inline-flex">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-emerald-500/80"
            />
            Live
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="md:hidden">
          <AdminNav variant="bar" />
        </div>

        <div className="grid gap-8 py-6 md:grid-cols-[196px_1fr] md:gap-10 md:py-8">
          <aside className="hidden md:sticky md:top-20 md:block md:self-start">
            <AdminNav />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  )
}
