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
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-sm bg-gray-900 flex items-center justify-center transition-colors group-hover:bg-gray-800">
            <span className="font-display text-sm font-bold text-white">DC</span>
          </div>
          <span className="font-display text-lg uppercase tracking-wide text-gray-900 hidden sm:block">
            Detective Conan <span className="text-gray-500">PH</span>
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
                    ? "text-gray-900 bg-gray-100"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                )}
              >
                {route.label}
              </Link>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Search" className="text-gray-500 hover:text-gray-900">
            <Search className="h-4 w-4" />
          </Button>

          {!loading && (
            <>
              {user ? (
                <div className="hidden md:flex items-center gap-2">
                  <Link href={profile ? `/profile/${profile.username}` : "#"}>
                    <Button variant="ghost" size="sm" className="gap-2 text-gray-500 hover:text-gray-900 font-display uppercase tracking-wider text-xs">
                      <User className="h-4 w-4" />
                      {profile?.display_name || "Profile"}
                    </Button>
                  </Link>
                  <Link href="/settings">
                    <Button variant="ghost" size="icon" aria-label="Settings" className="text-gray-400 hover:text-gray-900">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-2 font-display uppercase tracking-wider text-xs border-gray-200 hover:border-gray-400 hover:bg-gray-50 text-gray-500 hover:text-gray-900">
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </Button>
                </div>
              ) : (
                <Link href="/login" className="hidden md:block">
                  <Button variant="outline" size="sm" className="font-display uppercase tracking-wider text-xs border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900">
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
            className="md:hidden text-gray-600"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white/95 backdrop-blur-md">
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
                      ? "text-gray-900 bg-gray-100"
                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  {route.label}
                </Link>
              )
            })}
            <div className="mt-4 pt-4 border-t border-gray-200">
              {!loading && (
                <>
                  {user ? (
                    <div className="flex flex-col gap-2">
                      <Link href={profile ? `/profile/${profile.username}` : "#"} onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display uppercase tracking-wider">
                          <User className="h-4 w-4" />
                          Profile ({profile?.display_name || "Detective"})
                        </Button>
                      </Link>
                      <Link href="/settings" onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2 font-display uppercase tracking-wider">
                          <Settings className="h-4 w-4" />
                          Settings
                        </Button>
                      </Link>
                      <Button variant="outline" onClick={handleSignOut} className="w-full justify-start gap-2 border-gray-200 hover:border-gray-400 text-gray-500 hover:text-gray-900 font-display uppercase tracking-wider">
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </Button>
                    </div>
                  ) : (
                    <Link href="/login" onClick={() => setMobileOpen(false)}>
                      <Button variant="outline" size="sm" className="w-full font-display uppercase tracking-wider border-gray-200 text-gray-600">
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
