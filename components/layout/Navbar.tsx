"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Menu, X, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NAV_ROUTES } from "@/lib/constants"
import { cn } from "@/lib/utils"

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-noir-black/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-sm bg-poison-red flex items-center justify-center">
            <span className="font-display text-sm font-bold text-dossier-cream">DC</span>
          </div>
          <span className="font-display text-lg uppercase tracking-wide text-dossier-cream hidden sm:block">
            Detective Conan <span className="text-poison-red-bright">PH</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ROUTES.map((route) => {
            const isActive = pathname === route.href || 
              (route.href !== "/" && pathname.startsWith(route.href))
            return (
              <Link
                key={route.href}
                href={route.href}
                className={cn(
                  "px-3 py-2 rounded-sm text-sm font-display uppercase tracking-wide transition-colors",
                  isActive
                    ? "text-dossier-cream bg-case-file-raised"
                    : "text-silver-steel hover:text-dossier-cream hover:bg-case-file-raised/50"
                )}
              >
                {route.label}
              </Link>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Search">
            <Search className="h-4 w-4" />
          </Button>

          <Link href="/login" className="hidden md:block">
            <Button variant="outline" size="sm">
              Sign In
            </Button>
          </Link>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/5 bg-noir-black/95 backdrop-blur-md">
          <div className="flex flex-col px-6 py-4 gap-1">
            {NAV_ROUTES.map((route) => {
              const isActive = pathname === route.href ||
                (route.href !== "/" && pathname.startsWith(route.href))
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2 rounded-sm text-sm font-display uppercase tracking-wide transition-colors",
                    isActive
                      ? "text-dossier-cream bg-case-file-raised"
                      : "text-silver-steel hover:text-dossier-cream hover:bg-case-file-raised/50"
                  )}
                >
                  {route.label}
                </Link>
              )
            })}
            <div className="mt-4 pt-4 border-t border-white/5">
              <Link href="/login" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" size="sm" className="w-full">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
