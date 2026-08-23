import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, handleApiError } from "@/lib/api-utils"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { isSameOriginRequest } from "@/lib/csrf"
import {
  validateEmail,
  validatePassword,
  validateUsername,
  validateDisplayName,
} from "@/lib/validation"

export async function POST(request: NextRequest) {
  try {
    // CSRF guard: reject cross-origin POSTs before consuming a rate-limit slot.
    if (!isSameOriginRequest(request)) return fail(403, "Forbidden")

    // Brute-force / credential-stuffing guard: 10 attempts / 5 min per IP.
    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return fail(429, "Too many attempts. Please try again later.")
    }

    const body = await request.json()
    const mode = body?.mode === "signup" ? "signup" : "signin"
    const email = typeof body?.email === "string" ? body.email.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""

    if (mode === "signin") {
      if (!email || !password) return fail(400, "Email and password are required")
      const supabase = await createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return fail(401, "Invalid email or password")
      return NextResponse.json({ success: true })
    }

    // signup
    const emailError = validateEmail(email)
    if (emailError) return fail(400, emailError)
    const passwordError = validatePassword(password)
    if (passwordError) return fail(400, passwordError)

    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : ""

    const usernameError = validateUsername(username)
    if (usernameError) return fail(400, usernameError)
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) return fail(400, displayNameError)

    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: displayName } },
    })

    if (error) {
      // Generic message — never echo Supabase's "already registered" etc.
      return fail(400, "Registration failed. Please try again.")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, "auth")
  }
}

export async function GET() {
  // Remove endpoint-existence disclosure: auth endpoints answer 404.
  return fail(404, "Not found")
}