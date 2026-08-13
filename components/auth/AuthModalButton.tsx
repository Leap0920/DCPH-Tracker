"use client"

import { Button } from "@/components/ui/button"
import { openAuthModal, type AuthModalMode } from "@/lib/auth-modal"

/**
 * Button that opens the global auth modal. Exists so server components can
 * trigger the signin/signup modal (client-only behavior) without converting
 * the whole page to a client component.
 */
export function AuthModalButton({
  mode,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { mode: AuthModalMode }) {
  return (
    <Button onClick={() => openAuthModal(mode)} {...props}>
      {children}
    </Button>
  )
}
