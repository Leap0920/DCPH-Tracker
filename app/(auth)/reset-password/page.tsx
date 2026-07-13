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
    
    // Redirect to login after 3 seconds
    setTimeout(() => {
      router.push("/login")
      router.refresh()
    }, 3000)
  }

  if (isSessionValid === false) {
    return (
      <Card className="w-full max-w-md bg-case-file border border-white/5 shadow-dossier relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[3px] bg-poison-red" />
        <CardHeader className="text-center pb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-poison-red-bright animate-pulse" />
            <span className="case-number font-mono text-[10px] text-silver-steel tracking-widest">
              CASE FILE — ACCESS DENIED
            </span>
          </div>
          <CardTitle className="font-display text-2xl uppercase tracking-wider text-dossier-cream">
            Invalid Recovery Link
          </CardTitle>
          <CardDescription className="text-dossier-cream-dim text-sm mt-1">
            Your recovery session has expired or the token is invalid.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-dossier-cream-dim mb-6">
            Please request a new password recovery link from the recovery gate.
          </p>
          <Link href="/forgot-password">
            <Button className="w-full bg-poison-red hover:bg-poison-red-bright text-dossier-cream font-display uppercase tracking-widest text-xs h-11 rounded-sm">
              Request New Link
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md bg-case-file border border-white/5 shadow-dossier relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-poison-red" />
      
      <CardHeader className="text-center pb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-poison-red-bright animate-pulse" />
          <span className="case-number font-mono text-[10px] text-silver-steel tracking-widest">
            CASE FILE — DECRYPTION OVERWRITE
          </span>
        </div>
        <CardTitle className="font-display text-2xl uppercase tracking-wider text-dossier-cream">
          Reset Credentials
        </CardTitle>
        <CardDescription className="text-dossier-cream-dim text-sm mt-1">
          Set a new master password for your detective files.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {success ? (
          <div className="space-y-4 text-center">
            <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-4 text-xs text-green-400 flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-400 shrink-0" />
              <div>
                <p className="font-bold mb-1">Decryption Overwrite Complete</p>
                <p>Your password has been successfully updated. Redirecting to access gate...</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {error && (
              <div className="bg-poison-red/10 border border-poison-red-bright/30 rounded-sm p-3 flex gap-2 items-start text-xs text-poison-red-bright">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {isSessionValid === null && (
              <div className="text-center font-mono text-xs text-silver-steel animate-pulse py-4">
                VALIDATING RECOVERY TOKEN...
              </div>
            )}

            {isSessionValid && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
                    New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="pl-10 pr-10 bg-noir-black border-white/5 focus:border-poison-red-bright/50 focus:ring-1 focus:ring-poison-red-bright/50 rounded-sm text-dossier-cream placeholder:text-silver-steel/30 text-sm h-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-silver-steel/40 hover:text-dossier-cream transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
                    Confirm New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pl-10 pr-10 bg-noir-black border-white/5 focus:border-poison-red-bright/50 focus:ring-1 focus:ring-poison-red-bright/50 rounded-sm text-dossier-cream placeholder:text-silver-steel/30 text-sm h-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-silver-steel/40 hover:text-dossier-cream transition-colors"
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-poison-red hover:bg-poison-red-bright text-dossier-cream font-display uppercase tracking-widest text-xs h-11 rounded-sm transition-all border border-poison-red-bright/20 shadow-md hover:scale-[1.01] mt-2" 
                  disabled={loading}
                >
                  {loading ? "Rewriting master file..." : "Overwrite Password"}
                </Button>
              </>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
