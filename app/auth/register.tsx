import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState } from "react"

export default function RegisterPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [birthday, setBirthday] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
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

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        displayName,
        birthday,
      }),
    })

    if (!response.ok) {
      const data = await response.json()
      setError(data.error || "Registration failed")
      setLoading(false)
      return
    }

    window.location.href = "/tracker"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-ink">Create Account</h1>
          <p className="mt-2 text-sm text-ink-dim">
            Join the Detective Conan PH community
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="register-displayName">Display Name</Label>
            <Input
              id="register-displayName"
              placeholder="Conan Edogawa"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full"
            />
          </div>

          <div>
            <Label htmlFor="register-email">Email Address</Label>
            <Input
              id="register-email"
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
            <Label htmlFor="register-birthday">Birthday</Label>
            <Input
              id="register-birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              required
              className="w-full"
            />
          </div>

          <div>
            <Label htmlFor="register-password">Password</Label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full"
            />
          </div>

          <div>
            <Label htmlFor="register-confirmPassword">Confirm Password</Label>
            <Input
              id="register-confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-200">
          <Link href="/login" className="text-sm text-ink-dim hover:text-ink">
            Already have an account? Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}