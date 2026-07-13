"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, User, Mail, Calendar, Lock, ShieldCheck, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

export default function SignupPage() {
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [birthday, setBirthday] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function generateUniqueUsername(name: string, mail: string): Promise<string> {
    const base = (name || mail.split("@")[0])
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 15) || "detective"
    
    let attempts = 0
    let candidate = base
    while (attempts < 10) {
      const usernameToCheck = attempts === 0 ? candidate : `${candidate}${Math.floor(100 + Math.random() * 900)}`
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

  async function handleSignup(e: React.FormEvent) {
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

    // Generate a clean, unique username behind the scenes to satisfy database constraints
    const generatedUsername = await generateUniqueUsername(displayName, email)

    // Sign up
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          username: generatedUsername, 
          display_name: displayName,
          birthday: birthday
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // The profiles table has a trigger on auth.users (on_auth_user_created)
    // which automatically inserts the profile based on raw_user_meta_data.
    // Therefore, we must NOT manually insert into profiles here to avoid duplicate key errors.
    
    router.push("/tracker")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md bg-case-file border border-white/5 shadow-dossier relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-poison-red" />
      
      <CardHeader className="text-center pb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-poison-red-bright animate-pulse" />
          <span className="case-number font-mono text-[10px] text-silver-steel tracking-widest">
            CASE FILE — REGISTRATION GATE
          </span>
        </div>
        <CardTitle className="font-display text-2xl uppercase tracking-wider text-dossier-cream">
          Register as Detective
        </CardTitle>
        <CardDescription className="text-dossier-cream-dim text-sm mt-1">
          Create your detective credentials to join the investigation.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSignup} className="space-y-4">
          {error && (
            <div className="bg-poison-red/10 border border-poison-red-bright/30 rounded-sm p-3 flex gap-2 items-start text-xs text-poison-red-bright">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="displayName" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
              Display Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
              <Input
                id="displayName"
                placeholder="Conan Edogawa"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="pl-10 bg-noir-black border-white/5 focus:border-poison-red-bright/50 focus:ring-1 focus:ring-poison-red-bright/50 rounded-sm text-dossier-cream placeholder:text-silver-steel/30 text-sm h-11"
              />
            </div>
          </div>

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
            <Label htmlFor="birthday" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
              Birthday
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                required
                className="pl-10 bg-noir-black border-white/5 focus:border-poison-red-bright/50 focus:ring-1 focus:ring-poison-red-bright/50 rounded-sm text-dossier-cream placeholder:text-silver-steel/30 text-sm h-11"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
              Password
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
              Confirm Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-silver-steel/40" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter password"
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
            {loading ? "Registering..." : "Start Investigation"}
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <p className="font-mono text-xs text-dossier-cream-dim">
            Already registered?{" "}
            <Link href="/login" className="text-poison-red-bright hover:underline font-bold transition-colors">
              Access Gate
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
