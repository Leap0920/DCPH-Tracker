"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme, type Theme } from "@/components/theme-provider"

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown
}

/**
 * Dark/light toggle. On supported browsers the flip runs through
 * document.startViewTransition so the global CSS plays the diagonal
 * slash wipe reveal (globals.css ::view-transition-* rules). Falls back
 * to an instant swap when the API is missing or the user prefers
 * reduced motion.
 */
export function ThemeToggle({
  className,
  withLabel = false,
}: {
  className?: string
  withLabel?: boolean
}) {
  const { theme, setTheme } = useTheme()

  const handleClick = () => {
    const next: Theme = theme === "dark" ? "light" : "dark"
    const doc = document as DocumentWithViewTransition
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    if (doc.startViewTransition && !reducedMotion) {
      doc.startViewTransition(() => setTheme(next))
    } else {
      setTheme(next)
    }
  }

  const isDark = theme === "dark"

  return (
    <Button
      variant="ghost"
      size={withLabel ? "sm" : "icon"}
      onClick={handleClick}
      aria-label="Toggle dark mode"
      aria-pressed={isDark}
      className={className}
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      {withLabel && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
    </Button>
  )
}
