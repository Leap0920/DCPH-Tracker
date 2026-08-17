"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  User,
  Calendar,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createClient } from "@/utils/supabase/client"
import { cn } from "@/lib/utils"
import type { AuthModalMode } from "@/lib/auth-modal"

type AuthErrorKind = "credentials" | "unconfirmed" | "other"

/** Map Supabase auth error messages to friendly, actionable categories. */
function classifyAuthError(message: string): AuthErrorKind {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "credentials"
  }
  if (m.includes("email not confirmed") || m.includes("not confirmed")) {
    return "unconfirmed"
  }
  return "other"
}

export function AuthModal() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthModalMode>("signin")
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  // Shared across both tabs so switching keeps the email typed
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null)
  // Banner message coming from a redirect query param (e.g. ?auth=signin&error=banned).
  // Deliberately NOT reset when the modal opens/closes — it reflects the URL state.
  const [urlError, setUrlError] = useState<string | null>(null)
  // Cold-start feedback: idle → connecting (2s) → slow (8s).
  const [connectStatus, setConnectStatus] = useState<"idle" | "connecting" | "slow">("idle")
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSent, setResendSent] = useState(false)

  // Signup-only fields
  const [displayName, setDisplayName] = useState("")
  const [birthday, setBirthday] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle")

  // Listen for the global "open-auth-modal" event dispatched by openAuthModal()
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: AuthModalMode }>).detail
      setMode(detail?.mode === "signup" ? "signup" : "signin")
      setOpen(true)
    }
    window.addEventListener("open-auth-modal", handler)
    return () => window.removeEventListener("open-auth-modal", handler)
  }, [])

  // Auto-open when the URL carries ?auth=signin|signup (middleware redirects
  // from protected routes to "/?auth=signin" now that /login is gone).
  // Depends on pathname so it also fires on client-side navigations (e.g. the
  // reset-password page doing router.push("/?auth=signin")) — not just mounts.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authMode = params.get("auth")
    if (authMode === "signup") {
      setMode("signup")
      setOpen(true)
    } else if (authMode === "signin") {
      setMode("signin")
      setOpen(true)
    }
    const errorParam = params.get("error")
    if (errorParam === "banned") {
      setUrlError("Your account has been banned. Contact support if you believe this is a mistake.")
    } else if (errorParam === "suspended") {
      setUrlError("Your account is temporarily suspended.")
    } else if (errorParam === "admin_only") {
      setUrlError("This area is restricted to administrators.")
    }
  }, [pathname])

  // Reset transient state every time the modal opens
  useEffect(() => {
    if (open) {
      setError(null)
      setErrorKind(null)
      setConnectStatus("idle")
      setLoading(false)
      setResendSent(false)
      setNeedsConfirmation(false)
      setResendState("idle")
    }
  }, [open])

  function switchMode(next: AuthModalMode) {
    setMode(next)
    setError(null)
    setErrorKind(null)
    setNeedsConfirmation(false)
    setResendState("idle")
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setErrorKind(null)
    setResendSent(false)
    setConnectStatus("idle")

    const cleanEmail = email.trim().toLowerCase()

    // Supabase free-tier projects hibernate after ~7 days of inactivity — the
    // first request after a pause can take several seconds to wake up.
    const connectingTimer = setTimeout(() => setConnectStatus("connecting"), 2000)
    const slowTimer = setTimeout(() => setConnectStatus("slow"), 8000)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    })

    clearTimeout(connectingTimer)
    clearTimeout(slowTimer)
    setConnectStatus("idle")

    if (authError) {
      setError(authError.message)
      setErrorKind(classifyAuthError(authError.message))
      setLoading(false)
      return
    }

    setOpen(false)
    router.push("/tracker")
    router.refresh()
  }

  async function handleResendConfirmation() {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return
    setResendLoading(true)
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: cleanEmail,
    })
    setResendLoading(false)
    if (error) {
      setError(error.message)
      setErrorKind("other")
      return
    }
    setResendSent(true)
  }

  async function generateUniqueUsername(name: string, mail: string): Promise<string> {
    const base =
      (name || mail.split("@")[0]).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 15) ||
      "detective"

    let attempts = 0
    let candidate = base
    while (attempts < 10) {
      const usernameToCheck =
        attempts === 0 ? candidate : `${candidate}${Math.floor(100 + Math.random() * 900)}`
      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", usernameToCheck)
        .maybeSingle()

      if (!data && !fetchError) {
        return usernameToCheck
      }
      attempts++
    }
    return `${base}${Date.now().toString().slice(-4)}`
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      setLoading(false)
      return
    }

    const cleanEmail = email.trim().toLowerCase()

    // Generate a clean, unique username behind the scenes to satisfy database constraints
    const generatedUsername = await generateUniqueUsername(displayName, cleanEmail)

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/callback?next=/tracker`,
        data: {
          username: generatedUsername,
          display_name: displayName,
          birthday: birthday,
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // If email confirmation is required, Supabase returns no active session.
    if (!authData.session) {
      setNeedsConfirmation(true)
      setLoading(false)
      return
    }

    setOpen(false)
    router.push("/tracker")
    router.refresh()
  }

  async function handleResend() {
    setResendState("sending")
    setError(null)
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/callback?next=/tracker`,
      },
    })
    if (resendError) {
      setError(resendError.message)
      setResendState("idle")
      return
    }
    setResendState("sent")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="flex justify-center mb-3">
            <img
              src="/img/logo_DCPH.png"
              alt="Detective Conan PH Logo"
              className="h-12 w-auto object-contain"
            />
          </div>
          <DialogTitle className="font-display text-xl font-bold tracking-tight text-ink">
            {mode === "signin" ? "Welcome back" : "Create an account"}
          </DialogTitle>
          <DialogDescription className="text-ink-dim text-sm mt-1">
            {mode === "signin"
              ? "Sign in to your account to view your tracked cases."
              : "Join the Detective Conan PH community to start tracking."}
          </DialogDescription>
        </DialogHeader>

        {/* Redirect-time banner (banned / suspended / admin_only) */}
        {urlError && (
          <div
            role="status"
            aria-live="polite"
            className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-600"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
            <span>{urlError}</span>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex rounded-full border border-slate-200 bg-surface-muted p-1">
          {(["signin", "signup"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => switchMode(tab)}
              className={cn(
                "flex-1 rounded-full py-2 text-sm font-display transition-colors",
                mode === tab
                  ? "bg-accent text-white shadow-sm"
                  : "text-ink-dim hover:text-ink"
              )}
            >
              {tab === "signin" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} aria-busy={loading} className="space-y-5">
            {/* Cold-start status: shown while the (possibly hibernating) server wakes */}
            {loading && connectStatus === "connecting" && (
              <div
                role="status"
                aria-live="polite"
                className="bg-sky-50 border border-sky-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-sky-700"
              >
                <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
                <span>Connecting to the server… first sign-in can take a few seconds.</span>
              </div>
            )}
            {loading && connectStatus === "slow" && (
              <div
                role="status"
                aria-live="polite"
                className="bg-sky-50 border border-sky-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-sky-700"
              >
                <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin" />
                <span>Still connecting… please wait.</span>
              </div>
            )}

            {/* Friendly error for wrong credentials */}
            {error && errorKind === "credentials" && (
              <div
                role="status"
                aria-live="polite"
                className="bg-red-50 border border-red-200 rounded-lg p-3.5 text-xs text-red-600"
              >
                <div className="flex gap-2 items-start">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                  <div className="space-y-1">
                    <p>
                      That email or password doesn&apos;t match. Check for typos, or reset your
                      password.
                    </p>
                    <Link
                      href="/forgot-password"
                      onClick={() => setOpen(false)}
                      className="inline-block font-semibold text-red-700 underline underline-offset-2 hover:text-red-800 transition-colors"
                    >
                      Reset your password
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Friendly error + resend for unconfirmed email */}
            {error && errorKind === "unconfirmed" && (
              <div
                role="status"
                aria-live="polite"
                className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-700"
              >
                <div className="flex gap-2 items-start">
                  <Mail className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <div className="space-y-1.5">
                    <p>
                      Please confirm your email first. Check your inbox (and spam) for the
                      confirmation link.
                    </p>
                    {resendSent ? (
                      <p className="font-semibold text-emerald-700">
                        Confirmation email sent. Check your inbox.
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendConfirmation}
                        disabled={resendLoading}
                        className="font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900 disabled:opacity-60 transition-colors"
                      >
                        {resendLoading ? "Sending…" : "Resend confirmation email"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Fallback: raw error message */}
            {error && errorKind === "other" && (
              <div
                role="status"
                aria-live="polite"
                className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-600"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="font-display text-xs font-semibold text-ink-dim">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  placeholder="detective@conan.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label htmlFor="auth-password" className="font-display text-xs font-semibold text-ink-dim">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  onClick={() => setOpen(false)}
                  className="text-xs text-ink-dim hover:text-ink hover:underline transition-colors"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        ) : needsConfirmation ? (
          <div className="space-y-4 text-center">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
              <p className="font-semibold mb-1">Confirm your email</p>
              <p>
                We sent a confirmation link to <span className="font-medium">{email}</span>.
                Open it to activate your account, then sign in.
              </p>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600 text-left">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState !== "idle"}
              className="text-sm text-ink-dim hover:text-ink hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendState === "sending"
                ? "Resending..."
                : resendState === "sent"
                  ? "Confirmation email resent ✓"
                  : "Didn't get it? Resend confirmation email"}
            </button>
            <Button
              className="w-full rounded-full h-11 text-sm font-semibold"
              onClick={() => switchMode("signin")}
            >
              Go to Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSignUp} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-600">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-displayName" className="font-display text-xs font-semibold text-ink-dim">
                Display Name
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-displayName"
                  placeholder="Conan Edogawa"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="pl-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-email2" className="font-display text-xs font-semibold text-ink-dim">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-email2"
                  type="email"
                  autoComplete="email"
                  placeholder="detective@conan.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-birthday" className="font-display text-xs font-semibold text-ink-dim">
                Birthday
              </Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-birthday"
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  required
                  className="pl-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink text-sm h-11 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-password2" className="font-display text-xs font-semibold text-ink-dim">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-password2"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="pl-10 pr-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-confirmPassword" className="font-display text-xs font-semibold text-ink-dim">
                Confirm Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="auth-confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 bg-surface border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim transition-colors"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-4"
              disabled={loading}
            >
              {loading ? "Creating account..." : "Create Account"}
            </Button>
          </form>
        )}

        {/* Bottom switch link */}
        <div className="pt-5 border-t border-slate-100 text-center">
          <p className="text-sm text-ink-dim">
            {mode === "signin" ? (
              <>
                New to Detective Conan PH?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="text-ink hover:underline font-bold transition-colors"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="text-ink hover:underline font-bold transition-colors"
                >
                  Sign In
                </button>
              </>
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
