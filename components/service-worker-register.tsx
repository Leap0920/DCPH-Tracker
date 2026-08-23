"use client"

import { useEffect } from "react"

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    let cancelled = false

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        })
        if (cancelled) return

        // Pick up a new SW build without requiring a hard reload.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A newer version is waiting; it activates on next full load.
            }
          })
        })
      } catch {
        // Registration failures are non-fatal — the app works without the SW.
      }
    }

    // Defer past hydration and first paint so registration never competes
    // with the initial render.
    if (document.readyState === "complete") {
      void register()
    } else {
      window.addEventListener("load", register, { once: true })
    }

    return () => {
      cancelled = true
      window.removeEventListener("load", register)
    }
  }, [])

  return null
}

export default ServiceWorkerRegister
