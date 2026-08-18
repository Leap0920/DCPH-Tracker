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

const STORAGE_KEY = "dcph-theme"

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
  // Initialise from the exact same source the beforeInteractive FOUC guard
  // in app/layout.tsx used, so provider state and the <html> class can
  // never disagree after hydration. Defaults to LIGHT (white) — dark mode
  // is opt-in via the toggle and persists to localStorage.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light"
    return readStoredTheme() ?? "light"
  })

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

  // Reconcile the <html> class with provider state once mounted. Normally the
  // inline script already did this pre-paint; this covers edge cases where the
  // script did not run (e.g. streaming hydration).
  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

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
