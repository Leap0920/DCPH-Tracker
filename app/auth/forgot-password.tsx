import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState } from "react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })

    if (response.ok) {
      setSuccess(true)
      setLoading(false)
    } else {
      const data = await response.json()
      setError(data.error || "Failed to send reset link")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-ink">Reset Password</h1>
          <p className="mt-2 text-sm text-ink-dim">
            Enter your email and we'll send you a reset link
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="forgot-email">Email Address</Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="detective@conan.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
              Confirmation email sent — check your inbox (and spam).
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send Reset Link"}
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-200">
          <Link href="/login" className="text-sm text-ink-dim hover:text-ink">
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}