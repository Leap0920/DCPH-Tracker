"use client"

import { useState } from "react"
import Image from "next/image"
import { Mail, ShieldAlert, ArrowLeft, Lock, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { openAuthModal } from "@/lib/auth-modal"
import { createClient } from "@/utils/supabase/client"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [verified, setVerified] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError("Please enter your email address.")
      return
    }
    setLoading(true)
    setError(null)

    try {
      // Use the rate-limited API route which sends a recovery email/code
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(
          data?.error ??
            (res.status === 429
              ? "Too many reset requests. Please try again later."
              : "Could not send the verification code. Please try again.")
        )
        return
      }

      setOtpSent(true)
    } catch {
      setError("Network error. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    const code = otpCode.trim()
    if (code.length < 6) {
      setError("Please enter the 6-digit verification code.")
      return
    }
    setLoading(true)
    setError(null)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: code,
      type: "recovery",
    })

    if (verifyError) {
      // Fallback: try email OTP type (if project sends code as email OTP)
      const { error: emailOtpError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: code,
        type: "email",
      })
      if (emailOtpError) {
        setError(verifyError.message)
        setLoading(false)
        return
      }
    }

    setVerified(true)
    setLoading(false)
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }
    setLoading(true)
    setError(null)

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <Card className="w-full max-w-md bg-surface border border-line shadow-card rounded-2xl relative overflow-hidden">
        <CardHeader className="text-center pb-4 pt-6">
          <div className="flex justify-center mb-4">
            <Image
              src="/img/logo_DCPH.png"
              alt="Detective Conan PH Logo"
              width={56}
              height={56}
              priority
              className="h-14 w-14 object-contain transition-transform duration-300 hover:scale-105"
            />
          </div>
          <CardTitle className="font-display text-2xl font-bold tracking-tight text-ink">
            Password Reset Complete
          </CardTitle>
          <CardDescription className="text-ink-dim text-sm mt-1.5">
            Your password has been updated. You can now sign in with your new password.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-8">
          <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-sm text-success">
            <p>Your password has been successfully reset.</p>
          </div>
          <Button
            className="w-full mt-4 rounded-full h-11 text-sm font-semibold"
            onClick={() => openAuthModal("signin")}
          >
            Return to Sign In
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md bg-surface border border-line shadow-card rounded-2xl relative overflow-hidden">
      
      <CardHeader className="text-center pb-4 pt-6">
        <div className="flex justify-center mb-4">
          <Image
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            width={56}
            height={56}
            priority
            className="h-14 w-14 object-contain transition-transform duration-300 hover:scale-105"
          />
        </div>
        <CardTitle className="font-display text-2xl font-bold tracking-tight text-ink">
          Reset Password
        </CardTitle>
        <CardDescription className="text-ink-dim text-sm mt-1.5">
          {!otpSent
            ? "Enter your email address to receive a verification code."
            : verified
              ? "Enter your new password."
              : "Enter the 6-digit code sent to your Gmail."}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-8">
        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-danger mb-4">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-danger" />
            <span>{error}</span>
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={handleSendCode} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="font-display text-xs font-semibold text-ink-dim">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="email"
                  type="email"
                  placeholder="detective@conan.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
              </div>
              <p className="text-xs text-ink-faint px-1">
                We&apos;ll send a 6-digit verification code to your Gmail.
              </p>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01]" 
              disabled={loading}
            >
              {loading ? "Sending..." : "Send Verification Code"}
            </Button>
          </form>
        ) : !verified ? (
          <form onSubmit={handleVerifyCode} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="otp" className="font-display text-xs font-semibold text-ink-dim">
                Verification Code
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
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
                Code sent to <span className="font-medium text-ink">{email}</span>. Check your spam folder.
              </p>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01]" 
              disabled={loading}
            >
              {loading ? "Verifying..." : "Verify Code"}
            </Button>

            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false)
                  setOtpCode("")
                  setError(null)
                }}
                className="text-ink-dim hover:text-ink hover:underline"
              >
                Change email
              </button>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading}
                className="text-ink-dim hover:text-ink hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="font-display text-xs font-semibold text-ink-dim">
                New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="pl-10 pr-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="font-display text-xs font-semibold text-ink-dim">
                Confirm New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 bg-surface border border-line focus:border-accent focus:ring-1 focus:ring-accent rounded-lg text-ink placeholder:text-ink-faint text-sm h-11 transition-colors"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-2" 
              disabled={loading}
            >
              {loading ? "Updating..." : "Reset Password"}
            </Button>
          </form>
        )}

        <div className="mt-8 pt-6 border-t border-line">
          <button
            type="button"
            onClick={() => openAuthModal("signin")}
            className="inline-flex items-center gap-2 text-sm text-ink-dim hover:text-ink hover:underline transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Sign In
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
