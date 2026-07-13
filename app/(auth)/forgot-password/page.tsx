"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, ShieldAlert, KeyRound, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    const origin = typeof window !== "undefined" ? window.location.origin : ""

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    })

    if (resetError) {
      setError(resetError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  return (
    <Card className="w-full max-w-md bg-case-file border border-white/5 shadow-dossier relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-[3px] bg-poison-red" />
      
      <CardHeader className="text-center pb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-poison-red-bright animate-pulse" />
          <span className="case-number font-mono text-[10px] text-silver-steel tracking-widest">
            CASE FILE — ACCESS RECOVERY
          </span>
        </div>
        <CardTitle className="font-display text-2xl uppercase tracking-wider text-dossier-cream">
          Request Password Reset
        </CardTitle>
        <CardDescription className="text-dossier-cream-dim text-sm mt-1">
          Provide your email address to receive decryption recovery link.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {success ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-4 text-xs text-green-400">
              <p className="font-bold mb-1">Transmission Sent</p>
              <p>Check your email for the password recovery link. Follow it to reset your credentials.</p>
            </div>
            <Link href="/login" className="block">
              <Button variant="outline" className="w-full gap-2 font-display uppercase tracking-wider text-xs border-white/10 text-dossier-cream-dim hover:text-dossier-cream h-11">
                <ArrowLeft className="h-4 w-4" />
                Return to Access Gate
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleResetRequest} className="space-y-5">
            {error && (
              <div className="bg-poison-red/10 border border-poison-red-bright/30 rounded-sm p-3 flex gap-2 items-start text-xs text-poison-red-bright">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider text-silver-steel">
                Registered Email
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

            <Button 
              type="submit" 
              className="w-full bg-poison-red hover:bg-poison-red-bright text-dossier-cream font-display uppercase tracking-widest text-xs h-11 rounded-sm transition-all border border-poison-red-bright/20 shadow-md hover:scale-[1.01]" 
              disabled={loading}
            >
              {loading ? "Sending..." : "Request Recovery Link"}
            </Button>
          </form>
        )}

        {!success && (
          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <Link href="/login" className="inline-flex items-center gap-2 font-mono text-xs text-silver-steel hover:text-dossier-cream transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Access Gate
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
