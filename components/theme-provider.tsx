"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

/**
 * v2 = dark is now the DEFAULT rather than an opt-in. The key was bumped
 * so visitors who had explicitly chosen "light" under the old theme are
 * migrated to the new default exactly once, instead of being stuck on the
 * legacy palette forever. Must stay in sync with the beforeInteractive
 * FOUC script in app/layout.tsx.
 */
const STORAGE_KEY = "dcph-theme-v2"
const LEGACY_STORAGE_KEY = "dcph-theme"

/** Dark is the product identity — light is a legacy opt-in. */
export const DEFAULT_THEME: Theme = "dark"

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Reads the persisted preference. Returns null when unset or unreadable. */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === "dark" || stored === "light" ? stored : null
  } catch {
    return null
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Hydration-safe: always start dark on both server and client initial render,
  // then reconcile with stored preference after hydration. Reading localStorage
  // during the initial render would give server=dark vs client=light when the
  // user previously chose light, causing a hydration mismatch (server light
  // palette vs client dark palette in the graph). The inline script in
  // app/layout.tsx already removed the `dark` class pre-paint for light users,
  // so the visual flash is avoided; React state syncs in an effect.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark")
  }, [])

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Persistence is best-effort (private mode / storage disabled).
      }
      applyTheme(next)
    },
    [applyTheme]
  )

  const toggleTheme = useCallback(() => {
    const next: Theme =
      document.documentElement.classList.contains("dark") ? "light" : "dark"
    setTheme(next)
  }, [setTheme])

  // After hydration, reconcile with the persisted preference. This is the
  // only place we read localStorage — never during render — so server and
  // client initial HTML are identical (both dark).
  useEffect(() => {
    const stored = readStoredTheme()
    if (stored && stored !== DEFAULT_THEME) {
      setThemeState(stored)
    }
  }, [])

  // Reconcile the <html> class with provider state once mounted. Normally
  // the server-rendered `dark` class + inline script already did this
  // pre-paint; this covers edge cases where the script did not run.
  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  // One-time migration cleanup: drop the pre-v2 key so a stale bundle can
  // never read it again.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // best-effort
    }
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  )

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>")
  return ctx
}