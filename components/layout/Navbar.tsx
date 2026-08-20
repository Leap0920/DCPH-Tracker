"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import {
  Menu,
  X,
  User,
  Settings,
  ShieldCheck,
  Search,
  ChevronDown,
  BookOpen,
  Users,
  BarChart3,
  Trophy,
  MessageSquare,
  LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { NotificationBell } from "@/components/notifications/NotificationBell"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NAV_MAIN, NAV_EXPLORE, NAV_COMMUNITY, avatarUrl } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import type { User as SupabaseUser } from "@supabase/supabase-js"

type NavProfile = {
  username: string
  display_name: string
  role: "member" | "moderator" | "admin"
  avatar_url?: string | null
}

const iconMap: Record<string, React.ElementType> = {
  BookOpen,
  Users,
  BarChart3,
  Trophy,
  MessageSquare,
}

/** Shared sliding indicator under the active desktop nav item. */
function NavUnderline() {
  return (
    <motion.span
      layoutId="dcph-nav-underline"
      className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-accent"
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
    />
  )
}

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [profile, setProfile] = useState<NavProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [navVisible, setNavVisible] = useState(true)
  const [scrolled, setScrolled] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const lastYRef = useRef(0)
  const rafRef = useRef(0)
  const supabase = createClient()

  useEffect(() => {
    async function getSession() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("username, display_name, role, avatar_url")
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
          .select("username, display_name, role, avatar_url")
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

  /*
    Auto-hide behaviour.

    Previously this compared scrollY against a fixed 80px threshold with no
    memory of the previous position, so once you passed 80px the header was
    gone until you scrolled all the way back to the top — scrolling UP
    mid-page did nothing. Now it is direction-aware: hide on down, reveal on
    up, always reveal in the top zone, all behind a rAF guard. `focusin`
    reveals the header for keyboard users, who otherwise had no way to reach
    it on /characters (the old reveal was mouse-position only).
  */
  useEffect(() => {
    const onCharacters = pathname.startsWith("/characters")
    const isNarrow = () => window.innerWidth < 768

    lastYRef.current = window.scrollY
    setScrolled(window.scrollY > 8)
    setNavVisible(!(onCharacters && !isNarrow()))

    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const y = window.scrollY
        const dy = y - lastYRef.current
        lastYRef.current = y
        setScrolled(y > 8)

        if (onCharacters || isNarrow() || mobileOpen) return
        if (y < 80) {
          setNavVisible(true)
          return
        }
        if (Math.abs(dy) < 5) return
        setNavVisible(dy < 0)
      })
    }

    // On /characters the header stays out of the way until the cursor
    // reaches the very top edge. Hiding only once the pointer is fully
    // clear of the 64px bar (not at 30px) stops it snapping away
    // mid-click.
    const onMouseMove = (e: MouseEvent) => {
      if (!onCharacters || isNarrow() || mobileOpen) return
      if (e.clientY < 12) setNavVisible(true)
      else if (e.clientY > 72) setNavVisible(false)
    }

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (target instanceof Node && headerRef.current?.contains(target)) {
        setNavVisible(true)
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("mousemove", onMouseMove, { passive: true })
    document.addEventListener("focusin", onFocusIn)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("focusin", onFocusIn)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [mobileOpen, pathname])

  // The mobile drawer must never be orphaned by an auto-hide.
  useEffect(() => {
    if (mobileOpen) setNavVisible(true)
  }, [mobileOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  const isExploreActive = NAV_EXPLORE.some(item => pathname.startsWith(item.href))
  const isCommunityActive = NAV_COMMUNITY.some(item => pathname.startsWith(item.href))

  /* Exactly one underline owner — NAV_MAIN and the dropdown groups can both
     claim "active" for overlapping hrefs, and two elements sharing a
     layoutId makes framer thrash. */
  const activeMainHref = NAV_MAIN.find(
    (r) => r.href === pathname || (r.href !== "/" && pathname.startsWith(r.href))
  )?.href
  const underlineKey =
    activeMainHref ??
    (isExploreActive ? "__explore" : isCommunityActive ? "__community" : null)

  return (
    <header
      ref={headerRef}
      className={cn(
        "fixed top-0 left-0 right-0 z-40 border-b bg-surface/90 backdrop-blur-md transition-[transform,box-shadow,background-color,border-color] duration-300",
        scrolled
          ? "border-line shadow-card bg-surface/95"
          : "border-transparent shadow-none",
        navVisible ? "translate-y-0" : "-translate-y-full"
      )}
    >
      {/* Hairline accent — a quiet signature that the bar is "live". */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent transition-opacity duration-500",
          scrolled ? "opacity-100" : "opacity-0"
        )}
      />

      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <img
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            className="h-8 w-auto object-contain transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3"
          />
          <span className="font-display text-lg text-ink hidden sm:block">
            Detective Conan <span className="text-ink-dim transition-colors duration-300 group-hover:text-accent-bright">PH</span>
          </span>
        </Link>

        {/* Desktop grouped nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_MAIN.map((route) => {
            const isActive = route.href === activeMainHref
            return (
              <Link
                key={route.href}
                href={route.href}
                className={cn(
                  "relative px-3 py-2 rounded-md text-sm font-display transition-colors",
                  isActive
                    ? "text-ink font-medium"
                    : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                )}
              >
                {route.label}
                {underlineKey === route.href && <NavUnderline />}
              </Link>
            )
          })}

          {/* Explore Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "group relative flex items-center gap-1 px-3 py-2 rounded-md text-sm font-display transition-colors outline-none",
                  isExploreActive
                    ? "text-ink font-medium"
                    : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                )}
              >
                Explore
                <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-data-[state=open]:rotate-180" />
                {underlineKey === "__explore" && <NavUnderline />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-1.5 bg-surface/95 backdrop-blur-md">
              {NAV_EXPLORE.map((item) => {
                const Icon = item.icon ? iconMap[item.icon] : null
                const isActive = pathname.startsWith(item.href)
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-start gap-2.5 p-2 rounded-md cursor-pointer transition-colors",
                        isActive ? "bg-surface-muted text-ink" : "hover:bg-surface-muted/60"
                      )}
                    >
                      {Icon && (
                        <Icon className="h-4 w-4 mt-0.5 text-accent-bright shrink-0 transition-transform duration-200 group-hover:scale-110" />
                      )}
                      <div>
                        <div className="font-display text-xs font-medium text-ink">{item.label}</div>
                        <div className="text-[11px] text-ink-faint leading-tight mt-0.5">{item.description}</div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Community Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "group relative flex items-center gap-1 px-3 py-2 rounded-md text-sm font-display transition-colors outline-none",
                  isCommunityActive
                    ? "text-ink font-medium"
                    : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                )}
              >
                Community
                <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-data-[state=open]:rotate-180" />
                {underlineKey === "__community" && <NavUnderline />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-1.5 bg-surface/95 backdrop-blur-md">
              {NAV_COMMUNITY.map((item) => {
                const Icon = item.icon ? iconMap[item.icon] : null
                const isActive = pathname.startsWith(item.href)
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-start gap-2.5 p-2 rounded-md cursor-pointer transition-colors",
                        isActive ? "bg-surface-muted text-ink" : "hover:bg-surface-muted/60"
                      )}
                    >
                      {Icon && (
                        <Icon className="h-4 w-4 mt-0.5 text-accent-bright shrink-0 transition-transform duration-200 group-hover:scale-110" />
                      )}
                      <div>
                        <div className="font-display text-xs font-medium text-ink">{item.label}</div>
                        <div className="text-[11px] text-ink-faint leading-tight mt-0.5">{item.description}</div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          <Link href="/search">
            <Button variant="ghost" size="icon" aria-label="Search" className="text-ink-faint hover:text-ink hover:scale-110 transition-transform">
              <Search className="h-4 w-4" />
            </Button>
          </Link>

          <NotificationBell className="hidden md:block" />

          {!loading && (
            <>
              {user ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="group hidden md:flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-line bg-surface-muted hover:border-accent/60 transition-all outline-none"
                    >
                      <img
                        src={profile?.avatar_url || avatarUrl(profile?.display_name || user.email || "Detective")}
                        alt={profile?.display_name || "Profile"}
                        className="h-6 w-6 rounded-full object-cover border border-line"
                      />
                      <span className="font-display text-xs text-ink font-medium max-w-[110px] truncate">
                        {profile?.display_name || "Detective"}
                      </span>
                      <ChevronDown className="h-3 w-3 text-ink-dim opacity-70 transition-transform duration-300 group-data-[state=open]:rotate-180" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 p-1.5 bg-surface/95 backdrop-blur-md">
                    <DropdownMenuLabel className="px-3 py-2">
                      <div className="font-display text-xs font-bold text-ink truncate">
                        {profile?.display_name || "Detective"}
                      </div>
                      <div className="text-[11px] text-ink-faint font-normal truncate">
                        @{profile?.username || user.email?.split("@")[0]}
                      </div>
                      {profile?.role === "admin" && (
                        <span className="inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent/15 text-accent-bright font-semibold">
                          <ShieldCheck className="h-3 w-3" /> Admin
                        </span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={profile ? `/profile/${profile.username}` : "#"} className="flex items-center gap-2.5 px-3 py-2 text-xs font-display cursor-pointer">
                        <User className="h-4 w-4 text-ink-dim" />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    {profile?.role === "admin" && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin" className="flex items-center gap-2.5 px-3 py-2 text-xs font-display cursor-pointer text-accent-bright font-medium">
                          <ShieldCheck className="h-4 w-4" />
                          Admin Console
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem asChild>
                      <Link href="/settings" className="flex items-center gap-2.5 px-3 py-2 text-xs font-display cursor-pointer">
                        <Settings className="h-4 w-4 text-ink-dim" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-3 py-1.5 flex items-center justify-between">
                      <span className="text-xs font-display text-ink-dim">Theme</span>
                      <ThemeToggle className="h-7 w-7 text-ink-faint hover:text-ink" />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-display text-danger hover:text-danger/80 cursor-pointer focus:bg-danger/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="hidden md:flex items-center gap-2">
                  <ThemeToggle className="text-ink-faint hover:text-ink" />
                  <button
                    type="button"
                    onClick={() => openAuthModal("signin")}
                    className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-3 h-8 text-xs font-display text-ink-dim hover:text-ink hover:border-accent/60 transition-colors"
                  >
                    Sign In
                  </button>
                </div>
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
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile nav */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="md:hidden border-t border-line bg-surface/95 backdrop-blur-md max-h-[calc(100vh-4rem)] overflow-y-auto"
        >
          <div className="flex flex-col px-6 py-4 gap-4">
            {/* Section: Main */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">Main</div>
              <div className="flex flex-col gap-1">
                {NAV_MAIN.map((route) => {
                  const isActive = pathname === route.href || (route.href !== "/" && pathname.startsWith(route.href))
                  return (
                    <Link
                      key={route.href}
                      href={route.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "px-3 py-2.5 rounded-md text-sm font-display transition-colors",
                        isActive
                          ? "text-ink bg-surface-muted font-medium border-l-2 border-accent"
                          : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                      )}
                    >
                      {route.label}
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Section: Explore */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">Explore</div>
              <div className="flex flex-col gap-1">
                {NAV_EXPLORE.map((item) => {
                  const Icon = item.icon ? iconMap[item.icon] : null
                  const isActive = pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-display transition-colors",
                        isActive
                          ? "text-ink bg-surface-muted font-medium border-l-2 border-accent"
                          : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4 text-accent-bright" />}
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Section: Community */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">Community</div>
              <div className="flex flex-col gap-1">
                {NAV_COMMUNITY.map((item) => {
                  const Icon = item.icon ? iconMap[item.icon] : null
                  const isActive = pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-display transition-colors",
                        isActive
                          ? "text-ink bg-surface-muted font-medium border-l-2 border-accent"
                          : "text-ink-dim hover:text-ink hover:bg-surface-muted"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4 text-accent-bright" />}
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Section: Account / Auth */}
            <div className="pt-3 border-t border-line">
              <NotificationBell mobile />
              {!loading && (
                <>
                  {user ? (
                    <div className="flex flex-col gap-1 mt-2">
                      {profile?.role === "admin" && (
                        <Link href="/admin" onClick={() => setMobileOpen(false)}>
                          <Button variant="ghost" className="w-full justify-start gap-2.5 font-display text-accent-bright">
                            <ShieldCheck className="h-4 w-4" />
                            Admin Console
                          </Button>
                        </Link>
                      )}
                      <Link href={profile ? `/profile/${profile.username}` : "#"} onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2.5 font-display">
                          <User className="h-4 w-4" />
                          Profile ({profile?.display_name || "Detective"})
                        </Button>
                      </Link>
                      <Link href="/settings" onClick={() => setMobileOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2.5 font-display">
                          <Settings className="h-4 w-4" />
                          Settings
                        </Button>
                      </Link>
                      <ThemeToggle withLabel className="w-full justify-start gap-2.5 font-display text-ink-dim hover:text-ink px-4 py-2" />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setMobileOpen(false)
                          handleSignOut()
                        }}
                        className="w-full justify-start gap-2.5 font-display text-danger hover:text-danger/80"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 mt-2">
                      <ThemeToggle withLabel className="w-full justify-start gap-2.5 font-display text-ink-dim hover:text-ink px-4 py-2" />
                      <button
                        type="button"
                        onClick={() => {
                          setMobileOpen(false)
                          openAuthModal("signin")
                        }}
                        className="w-full inline-flex items-center justify-center rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-display text-ink-dim hover:text-ink hover:border-accent/60 transition-colors"
                      >
                        Sign In
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </header>
  )
}