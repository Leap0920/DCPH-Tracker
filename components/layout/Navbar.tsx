"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { Menu, X, User, Settings, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NAV_ROUTES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import type { User as SupabaseUser } from "@supabase/supabase-js"

type NavProfile = { username: string; display_name: string; role: "member" | "moderator" | "admin" }

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [profile, setProfile] = useState<NavProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [navVisible, setNavVisible] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function getSession() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("username, display_name, role")
          .eq("user_id", user.id)
          .single()
        setProfile(profileData as NavProfile | null)
      }
      setLoading(false)
    }

    getSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("username, display_name, role")
          .eq("user_id", currentUser.id)
          .single()
        setProfile(profileData as NavProfile | null)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    const isCharactersPage = pathname.startsWith("/characters")
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768

    // On /characters on desktop, hide navbar by default until cursor approaches top;
    // on mobile, ALWAYS keep navbar visible so users can navigate properly.
    if (isCharactersPage && !isMobile) {
      setNavVisible(false)
    } else {
      setNavVisible(true)
    }

    const handleScroll = () => {
      if (isCharactersPage || (typeof window !== "undefined" && window.innerWidth < 768)) return
      const currentScrollY = window.scrollY
      if (currentScrollY > 80 && !mobileOpen) {
        setNavVisible(false)
      } else {
        setNavVisible(true)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isCharactersPage || (typeof window !== "undefined" && window.innerWidth < 768)) return
      // Reveal navbar ONLY when cursor touches top edge (clientY < 10px) or mobile menu is open
      if (e.clientY < 10 || mobileOpen) {
        setNavVisible(true)
      } else if (e.clientY > 30) {
        setNavVisible(false)
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("mousemove", handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("mousemove", handleMouseMove)
    }
  }, [mobileOpen, pathname])

  return (
    <header className={cn(
      "fixed top-0 left-0 right-0 z-40 border-b border-slate-200 bg-surface/90 backdrop-blur-md transition-transform duration-300 shadow-sm",
      navVisible ? "translate-y-0" : "-translate-y-full"
    )}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <img
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            className="h-8 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
          />
          <span className="font-display text-lg text-ink hidden sm:block">
            Detective Conan <span className="text-ink-dim">PH</span>
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
                  "px-3 py-2 rounded-md text-sm font-display transition-colors",
                  isActive
                    ? "text-ink bg-surface-muted"
                    : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                )}
              >
                {route.label}
              </Link>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {!loading && (
            <>
              {user ? (
                <div className="hidden md:flex items-center gap-2">
                  {profile?.role === "admin" && (
                    <Link href="/admin">
                      <Button variant="ghost" size="sm" className="gap-2 text-ink-dim hover:text-ink font-display text-xs">
                        <ShieldCheck className="h-4 w-4" />
                        Admin
                      </Button>
                    </Link>
                  )}
                  <Link href={profile ? `/profile/${profile.username}` : "#"}>
                    <Button variant="ghost" size="sm" className="gap-2 text-ink-dim hover:text-ink font-display text-xs">
                      <User className="h-4 w-4" />
                      {profile?.display_name || "Profile"}
                    </Button>
                  </Link>
                  <Link href="/settings">
                    <Button variant="ghost" size="icon" aria-label="Settings" className="text-ink-faint hover:text-ink">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal("signin")}
                  className="hidden md:inline-flex items-center justify-center rounded-md border border-slate-200 bg-surface px-3 h-9 text-xs font-display text-ink-dim hover:text-ink hover:border-slate-300 transition-colors"
                >
                  Sign In
                </button>
              )}
            </>
          )}

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-ink-dim"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-surface/95 backdrop-blur-md">
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
                    "px-3 py-2 rounded-md text-sm font-display transition-colors",
                    isActive
                      ? "text-ink bg-surface-muted"
                      : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                  )}
                >
                  {route.label}
                </Link>
              )
            })}
            <div className="mt-4 pt-4 border-t border-slate-200">
              {!loading && (
                <>
                  {user ? (
                    <div className="flex flex-col gap-2">
                      {profile?.role === "admin" && (
                        <Link href="/admin" onClick={() => setMobileOpen(false)}>
                          <Button variant="ghost" className="w-full justify-start gap-2 font-display">
                            <ShieldCheck className="h-4 w-4" />
                            Admin Console
                          </Button>
                        </Link>
                      )}
                      <Link href={profile ? `/profile/${profile.username}` : "#"} onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display">
                          <User className="h-4 w-4" />
                          Profile ({profile?.display_name || "Detective"})
                        </Button>
                      </Link>
                      <Link href="/settings" onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display">
                          <Settings className="h-4 w-4" />
                          Settings
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileOpen(false)
                        openAuthModal("signin")
                      }}
                      className="w-full inline-flex items-center justify-center rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm font-display text-ink-dim hover:text-ink transition-colors"
                    >
                      Sign In
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
