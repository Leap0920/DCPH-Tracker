"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Lock, Mail, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const redirectTo = searchParams ? searchParams.get("redirectTo") || "/tracker" : "/tracker"

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md bg-case-file border border-white/5 shadow-dossier relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-poison-red" />
      
      <CardHeader className="text-center pb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <ShieldAlert className="h-4 w-4 text-poison-red-bright animate-pulse" />
          <span className="case-number font-mono text-[10px] text-silver-steel tracking-widest">
            CASE FILE — DECRYPTION GATE
          </span>
        </div>
        <CardTitle className="font-display text-2xl uppercase tracking-wider text-dossier-cream">
          Welcome back, detective
        </CardTitle>
        <CardDescription className="text-dossier-cream-dim text-sm mt-1">
          Decrypt access credentials to view tracked intel.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleLogin} className="space-y-5">
          {error && (
            <div className="bg-poison-red/10 border border-poison-red-bright/30 rounded-sm p-3 flex gap-2 items-start text-xs text-poison-red-bright">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
              <Input
                id="email"
                type="email"
                placeholder="detective@conan.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-10 bg-noir-black border-white/5 focus:border-poison-red-bright/50 focus:ring-1 focus:ring-poison-red-bright/50 rounded-sm text-dossier-cream placeholder:text-silver-steel/30 text-sm h-11"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="font-mono text-[10px] uppercase text-poison-red-bright hover:underline hover:text-red-400 transition-colors"
              >
                Forgot Password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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

          <Button 
            type="submit" 
            className="w-full bg-poison-red hover:bg-poison-red-bright text-dossier-cream font-display uppercase tracking-widest text-xs h-11 rounded-sm transition-all border border-poison-red-bright/20 shadow-md hover:scale-[1.01]" 
            disabled={loading}
          >
            {loading ? "Decrypting..." : "Access Dossier"}
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <p className="font-mono text-xs text-dossier-cream-dim">
            Unregistered detective?{" "}
            <Link href="/signup" className="text-poison-red-bright hover:underline font-bold transition-colors">
              Begin Investigation
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-silver-steel font-mono animate-pulse uppercase tracking-wider text-xs">Initializing Secure Gate...</div>}>
      <LoginForm />
    </Suspense>
  )
}
