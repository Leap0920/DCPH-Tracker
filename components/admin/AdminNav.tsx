"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Film, Image as ImageIcon, BookOpen, RefreshCw, Users, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/content", label: "Content", icon: Film, exact: true },
  { href: "/admin/content/covers", label: "Missing Covers", icon: ImageIcon },
  { href: "/admin/arcs", label: "Story Arcs", icon: BookOpen },
  { href: "/admin/sync", label: "Sync", icon: RefreshCw },
  { href: "/admin/users", label: "Users", icon: Users },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1">
      {ADMIN_NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/")
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-display transition-colors",
              active
                ? "bg-gray-900 text-white"
                : "text-ink-dim hover:bg-surface-muted hover:text-ink"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}

      <Link
        href="/tracker"
        className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-faint hover:text-ink transition-colors"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        Back to app
      </Link>
    </nav>
  )
}
