"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Film,
  Image as ImageIcon,
  BookOpen,
  RefreshCw,
  Users,
  ArrowLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/content", label: "Content", icon: Film, exact: true },
  { href: "/admin/content/covers", label: "Missing Covers", icon: ImageIcon },
  { href: "/admin/arcs", label: "Story Arcs", icon: BookOpen },
  { href: "/admin/sync", label: "Sync", icon: RefreshCw },
  { href: "/admin/users", label: "Users", icon: Users },
]

function useIsActive(pathname: string) {
  return (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
}

export function AdminNav({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "bar"
}) {
  const pathname = usePathname()
  const isActive = useIsActive(pathname)

  if (variant === "bar") {
    return (
      <nav
        aria-label="Admin sections"
        className="-mx-4 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex min-w-max items-center gap-1">
          {ADMIN_NAV.map((item) => {
            const active = isActive(item.href, item.exact)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40",
                    active
                      ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-ink"
                      : "text-ink-dim hover:text-ink"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <nav aria-label="Admin sections" className="flex flex-col">
      <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        Manage
      </p>

      <ul className="flex flex-col gap-px">
        {ADMIN_NAV.map((item) => {
          const active = isActive(item.href, item.exact)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page",
                  active
                    ? "bg-white/[0.06] text-ink"
                    : "text-ink-dim hover:bg-white/[0.03] hover:text-ink"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity",
                    active ? "bg-ink opacity-100" : "opacity-0"
                  )}
                />
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-ink" : "text-ink-faint group-hover:text-ink-dim"
                  )}
                />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="my-3 h-px bg-line" />

      <Link
        href="/tracker"
        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        Back to app
      </Link>
    </nav>
  )
}
