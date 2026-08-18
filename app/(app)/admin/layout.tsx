import { requireAdmin } from "@/lib/auth/admin"
import { AdminNav } from "@/components/admin/AdminNav"
import { ShieldCheck } from "lucide-react"

export const metadata = {
  title: "Admin â€” Detective Conan PH",
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
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-page">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <h1 className="font-display text-xl tracking-tight text-ink">
            Admin Console
          </h1>
          <p className="text-xs text-ink-dim">
            Signed in as {profile.display_name}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <AdminNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
