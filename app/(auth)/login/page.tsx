"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

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

    router.push("/tracker")
    router.refresh()
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first")
      return
    }

    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    setError(null)
    alert("Check your email for the magic link!")
    setLoading(false)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="case-number mb-2">CASE FILE — SIGN IN</div>
        <CardTitle>Welcome back, agent</CardTitle>
        <CardDescription>
          Sign in to access your case files and tracker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="agent@organization.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-poison-red-bright">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleMagicLink}
            disabled={loading}
          >
            Send Magic Link
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-dossier-cream-dim">
          No account yet?{" "}
          <Link href="/signup" className="text-poison-red-bright hover:underline">
            Register as new agent
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
