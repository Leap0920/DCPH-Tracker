import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Refreshes the auth session on every request that matches middleware.ts's
// matcher, and gates protected routes (tracker, settings, profile edit, chat).
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: don't run logic between createServerClient and getUser —
  // it can randomly log users out (see Supabase SSR docs).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPaths = ["/tracker", "/settings", "/community/chat", "/admin", "/analytics"];
  const isProtected = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("auth", "signin");
    return NextResponse.redirect(redirectUrl);
  }

  // Enforce moderation status on protected routes (banned accounts are locked
  // out entirely; suspended accounts keep basic browsing but lose chat/admin).
  if (isProtected && user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("status, role")
      .eq("user_id", user.id)
      .maybeSingle();

    // If the status column hasn't been migrated yet, the query fails — treat
    // the profile as active so the app keeps working until the migration runs.
    if (!profileError && profile) {
      const status = profile.status ?? "active";

      if (status === "banned") {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/";
        redirectUrl.searchParams.set("auth", "signin");
        redirectUrl.searchParams.set("error", "banned");
        return NextResponse.redirect(redirectUrl);
      }

      if (status === "suspended" && ["/community/chat", "/admin"].some((p) => request.nextUrl.pathname.startsWith(p))) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/tracker";
        redirectUrl.searchParams.set("error", "suspended");
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  // Admin area additionally requires the 'admin' role.
  if (request.nextUrl.pathname.startsWith("/admin") && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (profile?.role !== "admin") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/tracker";
      redirectUrl.searchParams.set("error", "admin_only");
      return NextResponse.redirect(redirectUrl);
    }
  }

  return supabaseResponse;
}
