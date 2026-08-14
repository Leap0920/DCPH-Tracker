import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, handleApiError } from "@/lib/api-utils"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import {
  validateEmail,
  validatePassword,
  validateUsername,
  validateDisplayName,
} from "@/lib/validation"

export async function POST(request: NextRequest) {
  try {
    // Brute-force / credential-stuffing guard: 10 attempts / 5 min per IP.
    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return fail(429, "Too many attempts. Please try again later.")
    }

    const body = await request.json()
    const { email, password } = body

    if (email && password) {
      // Login — keep the response identical whether the email exists or
      // not, so attackers can't enumerate registered addresses.
      const supabase = await createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        return fail(401, "Invalid email or password")
      }

      return NextResponse.json({ success: true })
    }

    // Registration — validate server-side before touching Supabase.
    const emailError = validateEmail(email)
    if (emailError) return fail(400, emailError)

    const passwordError = validatePassword(password)
    if (passwordError) return fail(400, passwordError)

    const usernameError = validateUsername(body.displayName || "")
    if (usernameError) return fail(400, usernameError)

    const displayNameError = validateDisplayName(body.displayName || "")
    if (displayNameError) return fail(400, displayNameError)

    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: body.displayName || "",
          email: email,
        },
      },
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