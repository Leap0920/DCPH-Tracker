import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState } from "react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const cleanEmail = email.trim().toLowerCase()
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, password }),
    })

    if (!response.ok) {
      const data = await response.json()
      setError(data.error || "Login failed")
      setErrorKind("credentials")
      setLoading(false)
      return
    }

    window.location.href = "/tracker"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-ink">Sign In</h1>
          <p className="mt-2 text-sm text-ink-dim">
            Welcome back to Detective Conan PH
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="login-email">Email Address</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="detective@conan.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
            />
          </div>

          <div>
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-200">
          <Link href="/forgot-password" className="text-sm text-ink-dim hover:text-ink">
            Forgot Password?
          </Link>
        </div>
      </div>
    </div>
  )
}