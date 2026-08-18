"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Lock, ShieldAlert, KeyRound, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  const [loading, setLoading] = useState(false)
  const [isSessionValid, setIsSessionValid] = useState<boolean | null>(null)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function checkSession() {
      // Supabase automatically signs the user in via URL parameters on password recovery redirect
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setIsSessionValid(true)
      } else {
        setIsSessionValid(false)
      }
    }
    checkSession()
  }, [supabase])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

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

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    
    // Redirect to sign in after 3 seconds
    setTimeout(() => {
      router.push("/?auth=signin")
      router.refresh()
    }, 3000)
  }

  if (isSessionValid === false) {
    return (
      <Card className="w-full max-w-md bg-surface border border-ink-dim/20 shadow-card rounded-2xl relative overflow-hidden">
        <CardHeader className="text-center pb-4 pt-6">
          <div className="flex justify-center mb-4">
            <img
              src="/img/logo_DCPH.png"
              alt="Detective Conan PH Logo"
              className="h-14 w-auto object-contain transition-transform duration-300 hover:scale-105"
            />
          </div>
          <CardTitle className="font-display text-2xl font-bold tracking-tight text-ink">
            Invalid Recovery Link
          </CardTitle>
          <CardDescription className="text-ink-dim text-sm mt-1.5">
            Your recovery session has expired or the token is invalid.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center px-6 pb-8">
          <p className="text-sm text-ink-dim mb-6">
            Please request a new password recovery link from the recovery page.
          </p>
          <Link href="/forgot-password">
            <Button className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card">
              Request New Link
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md bg-surface border border-ink-dim/20 shadow-card rounded-2xl relative overflow-hidden">
      
      <CardHeader className="text-center pb-4 pt-6">
        <div className="flex justify-center mb-4">
          <img
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            className="h-14 w-auto object-contain transition-transform duration-300 hover:scale-105"
          />
        </div>
        <CardTitle className="font-display text-2xl font-bold tracking-tight text-ink">
          Reset Password
        </CardTitle>
        <CardDescription className="text-ink-dim text-sm mt-1.5">
          Set a new password for your account to restore access.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-8">
        {success ? (
          <div className="space-y-4 text-center">
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-sm text-green-400 flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-400 shrink-0" />
              <div>
                <p className="font-semibold mb-1">Password Reset Complete</p>
                <p>Your password has been successfully updated. Redirecting to sign in...</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-400">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {isSessionValid === null && (
              <div className="text-center font-display text-xs text-ink-faint animate-pulse py-4 font-medium">
                Validating recovery link...
              </div>
            )}

            {isSessionValid && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="font-display text-xs font-semibold text-ink-dim">
                    New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <Input
                      id="password"
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
                  <Label htmlFor="confirmPassword" className="font-display text-xs font-semibold text-ink-dim">
                    Confirm New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter new password"
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
                  className="w-full bg-accent hover:bg-accent-bright text-white font-semibold text-sm h-11 rounded-full transition-all shadow-card hover:scale-[1.01] mt-2" 
                  disabled={loading}
                >
                  {loading ? "Updating password..." : "Reset Password"}
                </Button>
              </>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
