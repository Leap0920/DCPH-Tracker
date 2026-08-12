import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState } from "react"

export default function CallbackPage() {
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const response = await fetch("/api/auth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })

    if (response.ok) {
      window.location.href = "/tracker"
    } else {
      const data = await response.json()
      setError(data.error || "Callback failed")
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-bold text-ink">Verify Email</h1>
          <p className="mt-2 text-sm text-ink-dim">
            Confirm your email to complete registration
          </p>
        </div>

        <form onSubmit={handleConfirm} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="callback-token">Confirmation Token</Label>
            <Input
              id="callback-token"
              type="text"
              autoComplete="token"
              placeholder="Paste the confirmation link from email"
              value={token}
              onChange={(e) => setToken(e.target.value)}
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
            {loading ? "Verifying..." : "Confirm"}
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