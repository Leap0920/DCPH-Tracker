"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Loader2,
  Mail,
  ShieldAlert,
  User,
  Calendar,
  Smartphone,
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

type AuthErrorKind = "other"

export function AuthModal() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthModalMode>("signin")
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  // Shared
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)

  // Signup-only fields
  const [displayName, setDisplayName] = useState("")
  const [birthday, setBirthday] = useState("")

  // Email OTP flow
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [otpLoading, setOtpLoading] = useState(false)
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

  // Auto-open when the URL carries ?auth=signin|signup
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
      setLoading(false)
      setOtpSent(false)
      setOtpCode("")
      setOtpLoading(false)
      setResendState("idle")
    }
  }, [open])

  function switchMode(next: AuthModalMode) {
    setMode(next)
    setError(null)
    setOtpSent(false)
    setOtpCode("")
    setResendState("idle")
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

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError("Please enter your email address.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Please enter a valid email address.")
      return
    }
    if (mode === "signup" && !displayName.trim()) {
      setError("Please enter your display name.")
      return
    }

    setError(null)
    setOtpLoading(true)

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          mode,
          displayName: displayName.trim(),
          birthday: birthday || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "Failed to send verification code.")
        setOtpLoading(false)
        return
      }
      setOtpSent(true)
      setOtpLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.")
      setOtpLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    const code = otpCode.trim()
    if (code.length < 6) {
      setError("Please enter the 6-digit verification code.")
      return
    }

    setError(null)
    setOtpLoading(true)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: code,
      type: "email",
    })

    if (verifyError) {
      setError(verifyError.message)
      setOtpLoading(false)
      return
    }

    setOpen(false)
    router.push("/tracker")
    router.refresh()
  }

  async function handleResendOtp() {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return
    setResendState("sending")
    setError(null)

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          mode,
          displayName: displayName.trim(),
          birthday: birthday || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "Failed to resend code.")
        setResendState("idle")
        return
      }
      setResendState("sent")
      setTimeout(() => setResendState("idle"), 3000)
    } catch {
      setError("Failed to resend code.")
      setResendState("idle")
    }
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
              ? "Enter your email to receive a verification code."
              : "Join the Detective Conan PH community to start tracking."}
          </DialogDescription>
        </DialogHeader>

        {/* Redirect-time banner (banned / suspended / admin_only) */}
        {urlError && (
          <div
            role="status"
            aria-live="polite"
            className="bg-danger/10 border border-danger/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-danger"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
            <span>{urlError}</span>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex rounded-full border border-line bg-surface-muted p-1">
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

        {/* Email OTP Flow */}
        <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-4">
          {error && (
            <div
              role="status"
              aria-live="polite"
              className="bg-danger/10 border border-danger/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-danger"
            >
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
              <span>{error}</span>
            </div>
          )}

          {mode === "signup" && !otpSent && (
            <>
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
                    className="pl-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
                    className="pl-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink text-sm h-11 transition-colors"
                  />
                </div>
              </div>
            </>
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
                disabled={otpSent}
                className="pl-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors disabled:opacity-60"
              />
            </div>
            {!otpSent && (
              <p className="text-xs text-ink-faint px-1">
                We&apos;ll send a 6-digit verification code to your Gmail.
              </p>
            )}
          </div>

          {!otpSent ? (
            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-2"
              disabled={otpLoading}
            >
              {otpLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Sending code…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Verification Code
                </>
              )}
            </Button>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="auth-otp" className="font-display text-xs font-semibold text-ink-dim">
                  Verification Code
                </Label>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                  <Input
                    id="auth-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                    required
                    pattern="\d{6}"
                    maxLength={6}
                    className="pl-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors tracking-[0.3em] text-center"
                  />
                </div>
                <p className="text-xs text-ink-faint px-1">
                  Enter the code sent to <span className="font-medium text-ink">{email}</span>. Check your spam folder if you don&apos;t see it.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-2"
                disabled={otpLoading}
              >
                {otpLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Verifying…
                  </>
                ) : mode === "signup" ? (
                  "Create Account"
                ) : (
                  "Verify & Sign In"
                )}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendState !== "idle"}
                  className="text-ink-dim hover:text-ink hover:underline transition-colors disabled:opacity-50"
                >
                  {resendState === "sending"
                    ? "Resending…"
                    : resendState === "sent"
                      ? "Code resent ✓"
                      : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false)
                    setOtpCode("")
                    setError(null)
                  }}
                  className="text-ink-dim hover:text-ink hover:underline transition-colors"
                >
                  Change email
                </button>
              </div>
            </>
          )}
        </form>

        {/* Bottom switch link */}
        <div className="pt-5 border-t border-line text-center">
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
