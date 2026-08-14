import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { fail, handleApiError } from "@/lib/api-utils"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    // Same brute-force guard as /api/auth.
    const rl = rateLimit(authRateLimitKey(request))
    if (!rl.allowed) {
      return fail(429, "Too many attempts. Please try again later.")
    }

    const body = await request.json()
    const { token, email } = body

    if (token) {
      // Confirm email via Supabase REST API
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/confirms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!}`,
          },
          body: JSON.stringify({ email, token }),
        }
      )

      if (response.ok) {
        return NextResponse.json({ success: true })
      } else {
        return fail(400, "Invalid token")
      }
    }

    // Login — generic failure message to prevent email enumeration.
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    })

    if (error) {
      return fail(401, "Invalid email or password")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, "callback")
  }
}

export async function GET() {
  // Remove endpoint-existence disclosure.
  return fail(404, "Not found")
}