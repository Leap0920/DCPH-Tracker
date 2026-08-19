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
  MessageSquare,
  Phone,
  ShieldAlert,
  Smartphone,
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
import type { AuthModalMode, AuthMethod } from "@/lib/auth-modal"

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
  const [method, setMethod] = useState<AuthMethod>("email")
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

  // Phone OTP fields
  const [phone, setPhone] = useState("")
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [otpLoading, setOtpLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  // Listen for the global "open-auth-modal" event dispatched by openAuthModal()
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: AuthModalMode; method?: AuthMethod }>).detail
      setMode(detail?.mode === "signup" ? "signup" : "signin")
      setMethod(detail?.method === "phone" ? "phone" : "email")
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
      setPhoneError(null)
      setOtpSent(false)
      setOtpCode("")
      setOtpLoading(false)
      setOauthLoading(false)
    }
  }, [open])

  function switchMode(next: AuthModalMode) {
    setMode(next)
    setError(null)
    setErrorKind(null)
    setNeedsConfirmation(false)
    setResendState("idle")
    setPhoneError(null)
    setOtpSent(false)
    setOtpCode("")
  }

  function switchMethod(next: AuthMethod) {
    setMethod(next)
    setError(null)
    setErrorKind(null)
    setPhoneError(null)
    setOtpSent(false)
    setOtpCode("")
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

  /** Start Google OAuth. Supabase redirects to the callback route on success. */
  async function handleGoogleSignIn() {
    setOauthLoading(true)
    setError(null)
    setErrorKind(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback?next=/tracker`,
      },
    })
    if (oauthError) {
      setError(oauthError.message)
      setErrorKind("other")
      setOauthLoading(false)
    }
    // On success the browser navigates to Google — the modal stays mounted.
  }

  /** Normalize a PH-style number into E.164 (e.g. "09171234567" → "+639171234567"). */
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/[^\d]/g, "")
    if (digits.startsWith("0")) return `+63${digits.slice(1)}`
    if (digits.startsWith("63")) return `+${digits}`
    return `+${digits}`
  }

  function validatePhone(raw: string): string | null {
    const normalized = normalizePhone(raw)
    // E.164: +63 (2) + 9/10-digit local number
    if (normalized.length < 12 || normalized.length > 15) {
      return "Enter a valid phone number (e.g. 0917 123 4567)"
    }
    return null
  }

  /** Send the SMS one-time code (creates an account on signup, or just signs in). */
  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    const phoneErrorMsg = validatePhone(phone)
    if (phoneErrorMsg) {
      setPhoneError(phoneErrorMsg)
      return
    }
    setPhoneError(null)
    setOtpLoading(true)
    setError(null)
    setErrorKind(null)

    const normalizedPhone = normalizePhone(phone)

    if (mode === "signup") {
      // Signup via phone — create the account with a generated username.
      const generatedUsername = await generateUniqueUsername(displayName, `${normalizedPhone}@phone.local`)
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
        options: {
          shouldCreateUser: true,
          data: {
            username: generatedUsername,
            display_name: displayName || generatedUsername,
            birthday: birthday || null,
          },
        },
      })
      if (otpError) {
        setPhoneError(otpError.message)
        setOtpLoading(false)
        return
      }
      setOtpSent(true)
      setOtpLoading(false)
      return
    }

    // Signin via phone — do NOT create an account for unknown numbers.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: { shouldCreateUser: false },
    })
    if (otpError) {
      setPhoneError(otpError.message)
      setOtpLoading(false)
      return
    }
    setOtpSent(true)
    setOtpLoading(false)
  }

  /** Verify the SMS code and complete sign-in / signup. */
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (otpCode.trim().length < 6) {
      setPhoneError("Enter the 6-digit code from your SMS.")
      return
    }
    setPhoneError(null)
    setOtpLoading(true)
    setError(null)
    setErrorKind(null)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: normalizePhone(phone),
      token: otpCode.trim(),
      type: "sms",
    })

    if (verifyError) {
      setPhoneError(verifyError.message)
      setOtpLoading(false)
      return
    }

    setOpen(false)
    router.push("/tracker")
    router.refresh()
  }

  /** Resend the SMS one-time code. */
  async function handleResendOtp() {
    setOtpLoading(true)
    setPhoneError(null)
    const normalizedPhone = normalizePhone(phone)
    const { error: resendError } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        shouldCreateUser: mode === "signup",
        ...(mode === "signup" && {
          data: {
            username: displayName || "detective",
            display_name: displayName || "Detective",
            birthday: birthday || null,
          },
        }),
      },
    })
    if (resendError) {
      setPhoneError(resendError.message)
      setOtpLoading(false)
      return
    }
    setOtpLoading(false)
  }

  /** Render the phone OTP flow (shared by signin and signup). */
  const phoneFlow = (
    <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} aria-busy={otpLoading} className="space-y-4">
      {phoneError && (
        <div
          role="status"
          aria-live="polite"
          className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-400"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
          <span>{phoneError}</span>
        </div>
      )}

      {mode === "signup" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="auth-phone-name" className="font-display text-xs font-semibold text-ink-dim">
              Display Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <Input
                id="auth-phone-name"
                placeholder="Conan Edogawa"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auth-phone-birthday" className="font-display text-xs font-semibold text-ink-dim">
              Birthday
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <Input
                id="auth-phone-birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                required
                className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink text-sm h-11 transition-colors"
              />
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="auth-phone" className="font-display text-xs font-semibold text-ink-dim">
          Phone Number
        </Label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <Input
            id="auth-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0917 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={otpSent}
            required
            className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors disabled:opacity-60"
          />
        </div>
        <p className="text-xs text-ink-faint px-1">
          Philippine numbers: 0917 123 4567. International: include your country code.
        </p>
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
              <MessageSquare className="h-4 w-4 mr-2" />
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
                className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors tracking-[0.3em] text-center"
              />
            </div>
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
              "Sign In"
            )}
          </Button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={otpLoading}
              className="text-ink-dim hover:text-ink hover:underline transition-colors disabled:opacity-50"
            >
              {otpLoading ? "Resending…" : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => switchMethod("email")}
              className="text-ink-dim hover:text-ink hover:underline transition-colors"
            >
              Use email instead
            </button>
          </div>
        </>
      )}
    </form>
  )

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
            className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-400"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <span>{urlError}</span>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex rounded-full border border-ink-dim/20 bg-surface-muted p-1">
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

        {/* Google OAuth */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={oauthLoading}
          className={cn(
            "w-full flex items-center justify-center gap-3 h-11 rounded-full border border-ink-dim/20 bg-surface text-ink text-sm font-semibold transition-all",
            "hover:bg-surface-muted hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none shadow-card"
          )}
        >
          {oauthLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          )}
          {oauthLoading ? "Redirecting to Google…" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-ink-dim/10" />
          <span className="text-xs font-display text-ink-faint">or</span>
          <div className="h-px flex-1 bg-ink-dim/10" />
        </div>

        {/* Method switcher: Email / Phone */}
        <div className="flex rounded-full border border-ink-dim/15 bg-surface-muted p-1">
          {(["email", "phone"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMethod(m)}
              className={cn(
                "flex-1 rounded-full py-2 text-sm font-display transition-colors",
                method === m
                  ? "bg-accent text-white shadow-sm"
                  : "text-ink-dim hover:text-ink"
              )}
            >
              {m === "email" ? "Email" : "Phone"}
            </button>
          ))}
        </div>

        {/* Email/Phone method hint */}
        {method === "phone" && (
          <p className="text-xs text-ink-faint text-center -mt-2">
            {mode === "signup"
              ? "Enter your phone number — we'll send a verification code."
              : "No password needed — we'll text you a one-time code."}
          </p>
        )}

        {mode === "signin" && method === "email" ? (
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
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-xs text-red-400"
              >
                <div className="flex gap-2 items-start">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                  <div className="space-y-1">
                    <p>
                      That email or password doesn&apos;t match. Check for typos, or reset your
                      password.
                    </p>
                    <Link
                      href="/forgot-password"
                      onClick={() => setOpen(false)}
                      className="inline-block font-semibold text-red-400 underline underline-offset-2 hover:text-red-300 transition-colors"
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
                className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3.5 text-xs text-amber-400"
              >
                <div className="flex gap-2 items-start">
                  <Mail className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
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
                        className="font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-300 disabled:opacity-60 transition-colors"
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
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-400"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
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
                  className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
                  className="pl-10 pr-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
        ) : mode === "signin" && method === "phone" ? (
          phoneFlow
        ) : needsConfirmation ? (
          <div className="space-y-4 text-center">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-sm text-green-400">
              <p className="font-semibold mb-1">Confirm your email</p>
              <p>
                We sent a confirmation link to <span className="font-medium">{email}</span>.
                Open it to activate your account, then sign in.
              </p>
            </div>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 text-left">
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
        ) : method === "phone" ? (
          phoneFlow
        ) : (
          <form onSubmit={handleSignUp} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-400">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
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
                  className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
                  className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
                  className="pl-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink text-sm h-11 transition-colors"
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
                  className="pl-10 pr-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
                  className="pl-10 pr-10 bg-surface border border-ink-dim/20 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
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
        <div className="pt-5 border-t border-ink-dim/10 text-center">
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
