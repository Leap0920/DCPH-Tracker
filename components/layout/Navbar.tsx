"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { Menu, X, Search, LogOut, User, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NAV_ROUTES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function getSession() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("user_id", user.id)
          .single()
        setProfile(profileData)
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
          .select("username, display_name")
          .eq("user_id", currentUser.id)
          .single()
        setProfile(profileData)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setMobileOpen(false)
    router.push("/")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-noir-black/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-sm bg-poison-red flex items-center justify-center transition-colors group-hover:bg-poison-red-bright">
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

          {!loading && (
            <>
              {user ? (
                <div className="hidden md:flex items-center gap-2">
                  <Link href={profile ? `/profile/${profile.username}` : "#"}>
                    <Button variant="ghost" size="sm" className="gap-2 text-dossier-cream-dim hover:text-dossier-cream font-display uppercase tracking-wider text-xs">
                      <User className="h-4 w-4 text-poison-red-bright" />
                      {profile?.display_name || "Profile"}
                    </Button>
                  </Link>
                  <Link href="/settings">
                    <Button variant="ghost" size="icon" aria-label="Settings" className="text-silver-steel hover:text-dossier-cream">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-2 font-display uppercase tracking-wider text-xs border-white/10 hover:border-poison-red-bright hover:bg-poison-red/10 text-dossier-cream-dim hover:text-dossier-cream">
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </Button>
                </div>
              ) : (
                <Link href="/login" className="hidden md:block">
                  <Button variant="outline" size="sm" className="font-display uppercase tracking-wider text-xs border-poison-red/30 hover:border-poison-red-bright text-dossier-cream">
                    Sign In
                  </Button>
                </Link>
              )}
            </>
          )}

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
              {!loading && (
                <>
                  {user ? (
                    <div className="flex flex-col gap-2">
                      <Link href={profile ? `/profile/${profile.username}` : "#"} onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display uppercase tracking-wider">
                          <User className="h-4 w-4 text-poison-red-bright" />
                          Profile ({profile?.display_name || "Detective"})
                        </Button>
                      </Link>
                      <Link href="/settings" onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display uppercase tracking-wider">
                          <Settings className="h-4 w-4 text-poison-red-bright" />
                          Settings
                        </Button>
                      </Link>
                      <Button variant="outline" onClick={handleSignOut} className="w-full justify-start gap-2 border-poison-red-bright/30 text-poison-red-bright hover:bg-poison-red/10 font-display uppercase tracking-wider">
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </Button>
                    </div>
                  ) : (
                    <Link href="/login" onClick={() => setMobileOpen(false)}>
                      <Button variant="outline" size="sm" className="w-full font-display uppercase tracking-wider">
                        Sign In
                      </Button>
                    </Link>
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
