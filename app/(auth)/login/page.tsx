"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

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

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null)
  const [loading, setLoading] = useState(false)
  // Cold-start feedback: idle → connecting (2s) → slow (8s).
  const [connectStatus, setConnectStatus] = useState<"idle" | "connecting" | "slow">("idle")
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSent, setResendSent] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const redirectToRaw = searchParams ? searchParams.get("redirectTo") : null
  const redirectTo =
    redirectToRaw && redirectToRaw.startsWith("/") && !redirectToRaw.startsWith("//")
      ? redirectToRaw
      : "/tracker"

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setErrorKind(null)
    setResendSent(false)
    setConnectStatus("idle")

    const cleanEmail = email.trim().toLowerCase()

    // Supabase free-tier projects hibernate after ~7 days of inactivity — the
    // first request after a pause can take several seconds to wake up. Surface
    // that so the user doesn't think sign-in is stuck.
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

    router.push(redirectTo)
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

  return (
    <Card className="w-full max-w-md bg-surface border border-slate-200 shadow-card rounded-2xl relative overflow-hidden">
      
      <CardHeader className="text-center pb-4 pt-6">
        <div className="flex justify-center mb-4">
          <img
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            className="h-14 w-auto object-contain transition-transform duration-300 hover:scale-105"
          />
        </div>
        <CardTitle className="font-display text-2xl font-bold tracking-tight text-ink">
          Welcome back
        </CardTitle>
        <CardDescription className="text-ink-dim text-sm mt-1.5">
          Sign in to your account to view your tracked cases.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-8">
        <form onSubmit={handleLogin} aria-busy={loading} className="space-y-5">
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
                    Please confirm your email first — check your inbox (and spam) for the
                    confirmation link.
                  </p>
                  {resendSent ? (
                    <p className="font-semibold text-emerald-700">
                      Confirmation email sent — check your inbox.
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
            <Label htmlFor="email" className="font-display text-xs font-semibold text-ink-dim">
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <Input
                id="email"
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
              <Label htmlFor="password" className="font-display text-xs font-semibold text-ink-dim">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs text-ink-dim hover:text-ink hover:underline transition-colors"
              >
                Forgot Password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
              <Input
                id="password"
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

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-sm text-ink-dim">
            New to Detective Conan PH?{" "}
            <Link href="/signup" className="text-ink hover:underline font-bold transition-colors">
              Create an account
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-ink-faint font-mono animate-pulse text-xs">Initializing Secure Gate...</div>}>
      <LoginForm />
    </Suspense>
  )
}
