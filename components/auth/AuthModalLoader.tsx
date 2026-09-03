"use client"

import dynamic from "next/dynamic"

/**
 * Lazy host for AuthModal. The dialog is invisible until opened (via the
 * global "open-auth-modal" event or a ?auth= query param), so nothing renders
 * as a fallback — splitting it out of the root layout trims every route's
 * initial JS by the auth dialog's weight.
 */
const AuthModal = dynamic(() =>
  import("@/components/auth/AuthModal").then((m) => m.AuthModal)
)

export function AuthModalLoader() {
  return <AuthModal />
}
