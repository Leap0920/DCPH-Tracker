"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Menu, X, Home, BookOpen, Trophy, MessageCircle, Settings, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NAV_ROUTES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

const iconMap: Record<string, typeof Home> = {
  "/": Home,
  "/tracker": BookOpen,
  "/arcs": BookOpen,
  "/community/rankings": Trophy,
  "/community/chat/general": MessageCircle,
}

export function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile hamburger button - fixed top-left */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden bg-noir-black/90 border border-case-file-border"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-screen w-64 bg-noir-surface border-r border-case-file-border flex flex-col transition-transform duration-300",
          "md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="p-6 border-b border-case-file-border">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-sm bg-poison-red flex items-center justify-center shadow-lg shadow-poison-red/20">
              <span className="font-display text-base font-bold text-dossier-cream">DC</span>
            </div>
            <div>
              <span className="font-display text-lg uppercase tracking-wide text-dossier-cream block leading-tight">
                Detective Conan
              </span>
              <span className="font-display text-sm uppercase tracking-wide text-poison-red-bright">
                PH
              </span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ROUTES.map((route) => {
            const isActive = pathname === route.href ||
              (route.href !== "/" && pathname.startsWith(route.href))
            const Icon = iconMap[route.href] || BookOpen

            return (
              <Link
                key={route.href}
                href={route.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-display uppercase tracking-wide transition-colors",
                  isActive
                    ? "text-dossier-cream bg-case-file-raised border-l-2 border-poison-red-bright"
                    : "text-silver-steel hover:text-dossier-cream hover:bg-case-file-raised/50 border-l-2 border-transparent"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {route.label}
              </Link>
            )
          })}
        </nav>

        {/* User profile section */}
        <div className="p-4 border-t border-case-file-border">
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-2 rounded-sm hover:bg-case-file-raised transition-colors"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-case-file text-dossier-cream text-xs font-display">
                DC
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-display text-dossier-cream truncate">
                Agent
              </p>
              <p className="text-xs text-dossier-cream-dim truncate">
                Settings
              </p>
            </div>
            <Settings className="h-4 w-4 text-silver-steel shrink-0" />
          </Link>
        </div>
      </aside>
    </>
  )
}
