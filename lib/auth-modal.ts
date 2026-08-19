/**
 * Auth Modal Logic — extracted from components/auth/AuthModal.tsx
 * Exported as a standalone lib for use by Navbar, AuthModal, and other components.
 *
 * Uses the global `open-auth-modal` event (dispatched by Navbar.tsx) to trigger
 * the modal. The lib handles:
 *   - Opening/closing the dialog
 *   - Mode switching (signin ↔ signup)
 *   - Form submission (sign in, sign up, resend confirmation)
 *   - Error classification and display
 *   - Username generation for signup
 */

export type AuthModalMode = "signin" | "signup"

export type AuthMethod = "email" | "phone"

export type AuthErrorKind = "credentials" | "unconfirmed" | "other"

export type AuthFormData = {
  email: string
  password: string
  displayName?: string
  birthday?: string
  confirmPassword?: string
  token?: string
  code?: string
}

/** Map Supabase auth error messages to friendly, actionable categories. */
export function classifyAuthError(message: string): AuthErrorKind {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "credentials"
  }
  if (m.includes("email not confirmed") || m.includes("not confirmed")) {
    return "unconfirmed"
  }
  return "other"
}

/**
 * Open the auth modal dialog.
 * Called by Navbar.tsx via `open-auth-modal` event.
 */
export function openAuthModal(mode: AuthModalMode, method: AuthMethod = "email") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-auth-modal", { detail: { mode, method } }))
  }
}

/**
 * Switch between sign-in and sign-up modes.
 * Dispatches a window event so AuthModal component can update its internal state.
 */
export function switchMode(next: AuthModalMode) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth-mode-change", { detail: { mode: next } }))
  }
}

/**
 * Generate a unique username.
 */
export async function generateUniqueUsername(
  supabase: any,
  name: string,
  mail: string
): Promise<string> {
  const base =
    (name || mail.split("@")[0]).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 15) ||
    "detective"

  let attempts = 0
  let candidate = base
  while (attempts < 10) {
    const usernameToCheck =
      attempts === 0 ? candidate : `${candidate}${Math.floor(100 + Math.random() * 900)}`
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", usernameToCheck)
      .maybeSingle()

    if (!data && !fetchError) {
      return usernameToCheck
    }
    attempts++
  }
  return `${base}${Date.now().toString().slice(-4)}`
}

/**
 * Handle sign-in form submission.
 */
export async function handleSignIn(
  supabase: any,
  form: AuthFormData
): Promise<{ success: boolean; error?: string; errorKind?: AuthErrorKind }> {
  const cleanEmail = form.email.trim().toLowerCase()

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password: form.password,
  })

  if (authError) {
    return {
      success: false,
      error: authError.message,
      errorKind: classifyAuthError(authError.message),
    }
  }

  return { success: true }
}

/**
 * Handle sign-up form submission.
 */
export async function handleSignUp(
  supabase: any,
  form: AuthFormData
): Promise<{ success: boolean; error?: string; needsConfirmation?: boolean }> {
  if (form.password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" }
  }

  if (form.password !== form.confirmPassword) {
    return { success: false, error: "Passwords do not match" }
  }

  const generatedUsername = await generateUniqueUsername(supabase, form.displayName || "", form.email)

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: form.email,
    password: form.password,
    options: {
      emailRedirectTo: `${window.location.origin}/callback?next=/tracker`,
      data: {
        username: generatedUsername,
        display_name: form.displayName,
        birthday: form.birthday,
      },
    },
  })

  if (authError) {
    return { success: false, error: authError.message }
  }

  if (!authData.session) {
    return { success: false, needsConfirmation: true }
  }

  return { success: true }
}

/**
 * Handle resend confirmation.
 */
export async function handleResendConfirmation(
  supabase: any,
  email: string
): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanEmail) return { success: false, error: "Email is required" }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: cleanEmail,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Handle resend request.
 */
export async function handleResend(
  supabase: any,
  email: string
): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: cleanEmail,
    options: {
      emailRedirectTo: `${window.location.origin}/callback?next=/tracker`,
    },
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}