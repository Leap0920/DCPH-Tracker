import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name, role, status, birthday")
      .eq("user_id", user.id)
      .single()

    return NextResponse.json({ profile })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, display_name, role, status, birthday } = body
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        username,
        display_name,
        role: role || "member",
        status: status || "active",
        birthday: birthday || null,
      })
      .eq("user_id", user.id)
      .select()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    return NextResponse.json({ profile })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}