"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"]

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Check username availability
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .single()

    if (existing) {
      setError("Username already taken")
      setLoading(false)
      return
    }

    // Sign up
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName || username },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // Create profile
    if (authData.user) {
      const profileData: ProfileInsert = {
        user_id: authData.user.id,
        username,
        display_name: displayName || username,
      }
      const { error: profileError } = await supabase
        .from("profiles")
        .insert(profileData)

      if (profileError) {
        setError("Account created but profile setup failed. Please contact support.")
        setLoading(false)
        return
      }
    }

    router.push("/tracker")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="case-number mb-2">CASE FILE — REGISTRATION</div>
        <CardTitle>Join the organization</CardTitle>
        <CardDescription>
          Create your agent profile and start tracking cases.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Agent Codename</Label>
            <Input
              id="username"
              placeholder="your-codename"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              required
              minLength={3}
              maxLength={30}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              placeholder="Your real name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
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
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="text-sm text-poison-red-bright">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Registering..." : "Register"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-dossier-cream-dim">
          Already an agent?{" "}
          <Link href="/login" className="text-poison-red-bright hover:underline">
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
