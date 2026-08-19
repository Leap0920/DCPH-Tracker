/**
 * Fail fast and loudly on missing configuration, instead of letting
 * `process.env.X!` blow up mid-request with an unreadable error.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `Set it in .env.local and in the Vercel project settings.`
    )
  }
  return value
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL")
export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
)

/** Host of the Supabase project, used to build CSP allowlists. */
export const SUPABASE_HOST = (() => {
  try {
    return new URL(SUPABASE_URL).host
  } catch {
    return ""
  }
})()