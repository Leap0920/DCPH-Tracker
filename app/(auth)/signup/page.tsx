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

    const cleanEmail = email.trim().toLowerCase()

    // Generate a clean, unique username behind the scenes to satisfy database constraints
    const generatedUsername = await generateUniqueUsername(displayName, cleanEmail)

    // Sign up
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
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
    <Card className="w-full max-w-md bg-white border border-gray-200 shadow-xl shadow-gray-100/50 rounded-2xl relative overflow-hidden">
      
      <CardHeader className="text-center pb-4 pt-6">
        <div className="flex justify-center mb-4">
          <img
            src="/img/logo_DCPH.png"
            alt="Detective Conan PH Logo"
            className="h-14 w-auto object-contain transition-transform duration-300 hover:scale-105"
          />
        </div>
        <CardTitle className="font-display text-2xl font-bold tracking-tight text-gray-900">
          Create an account
        </CardTitle>
        <CardDescription className="text-gray-500 text-sm mt-1.5">
          Join the Detective Conan PH community to start tracking.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-8">
        <form onSubmit={handleSignup} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-600">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="displayName" className="font-display text-xs font-semibold uppercase tracking-wider text-gray-500">
              Display Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="displayName"
                placeholder="Conan Edogawa"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="pl-10 bg-white border border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 rounded-lg text-gray-900 placeholder:text-gray-400/50 text-sm h-11 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="font-display text-xs font-semibold uppercase tracking-wider text-gray-500">
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="email"
                type="email"
                placeholder="detective@conan.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-10 bg-white border border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 rounded-lg text-gray-900 placeholder:text-gray-400/50 text-sm h-11 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birthday" className="font-display text-xs font-semibold uppercase tracking-wider text-gray-500">
              Birthday
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                required
                className="pl-10 bg-white border border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 rounded-lg text-gray-900 text-sm h-11 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="font-display text-xs font-semibold uppercase tracking-wider text-gray-500">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="pl-10 pr-10 bg-white border border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 rounded-lg text-gray-900 placeholder:text-gray-400/50 text-sm h-11 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="font-display text-xs font-semibold uppercase tracking-wider text-gray-500">
              Confirm Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="pl-10 pr-10 bg-white border border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 rounded-lg text-gray-900 placeholder:text-gray-400/50 text-sm h-11 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full bg-gray-950 hover:bg-gray-800 text-white font-semibold text-sm h-11 rounded-full transition-all shadow-sm hover:scale-[1.01] mt-4" 
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="text-gray-900 hover:underline font-bold transition-colors">
              Sign In
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
