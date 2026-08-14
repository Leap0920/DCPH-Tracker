import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Call this inside Server Components / Server Actions / Route Handlers.
// Each call reads the current cookie store, so session state stays in sync
// with middleware-refreshed tokens.
export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          // Hardened cookie attributes: httpOnly is intentionally NOT set —
          // the browser-side client (createBrowserClient) reads the auth token
          // from document.cookie, so an httpOnly token would log the client
          // out on every navigation. sameSite=lax blocks cross-site CSRF and
          // secure is enforced in production.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              path: "/",
            })
          );
        } catch {
          // Called from a Server Component — safe to ignore because
          // middleware.ts below refreshes the session on every request.
        }
      },
    },
  });
};
