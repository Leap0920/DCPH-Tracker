export type AuthModalMode = "signin" | "signup"

/** Dispatch a window event that AuthModal listens for — lets any component
 *  open the auth modal without prop drilling. */
export function openAuthModal(mode: AuthModalMode) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-auth-modal", { detail: { mode } }))
  }
}
