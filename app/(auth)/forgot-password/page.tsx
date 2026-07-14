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
    const cleanEmail = email.trim().toLowerCase()

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
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
          Reset Password
        </CardTitle>
        <CardDescription className="text-gray-500 text-sm mt-1.5">
          Enter your email address to receive a password recovery link.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-8">
        {success ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
              <p className="font-semibold mb-1">Recovery Email Sent</p>
              <p>Check your email for the password recovery link. Follow the instructions in the email to reset your password.</p>
            </div>
            <Link href="/login" className="block">
              <Button variant="outline" className="w-full gap-2 border-gray-200 text-gray-700 hover:bg-gray-50 rounded-full h-11 text-sm font-semibold transition-all">
                <ArrowLeft className="h-4 w-4" />
                Return to Sign In
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleResetRequest} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex gap-2 items-start text-xs text-red-600">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                <span>{error}</span>
              </div>
            )}

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

            <Button 
              type="submit" 
              className="w-full bg-gray-950 hover:bg-gray-800 text-white font-semibold text-sm h-11 rounded-full transition-all shadow-sm hover:scale-[1.01]" 
              disabled={loading}
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </Button>
          </form>
        )}

        {!success && (
          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <Link href="/login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 hover:underline transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
