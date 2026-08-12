import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: NextRequest) {
  try {
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
        return NextResponse.json({ error: "Invalid token" }, { status: 400 })
      }
    }

    // Login
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    return NextResponse.json({ success: true, user: data.user?.email })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: "Auth endpoints available" })
}