"use client"

import { useEffect } from "react"

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    // Development: leave no worker in control. A worker registered by an earlier
    // production run on this origin serves /_next/static/* cache-first, and dev
    // chunk URLs carry no content hash — so it keeps handing back the old bundle
    // on every reload (stale modules, and "Loading chunk ... failed" once one of
    // those files stops existing). Clearing it here means a local production
    // build can never poison the next `npm run dev`.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
        .catch(() => {})
      if (typeof caches !== "undefined") {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .catch(() => {})
      }
      return
    }

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
