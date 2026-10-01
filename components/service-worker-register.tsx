"use client"

import { useEffect } from "react"

/* Query-bumped script URL: the browser's own SW update checks are cookie-less,
 * and the dev tunnel (ngrok free tier) answers cookie-less browser requests
 * with its HTML warning page — so updates to a plain "/sw.js" silently stall
 * forever. A new ?v= makes the browser fetch a never-seen URL, installing the
 * new worker cold. Bump it whenever public/sw.js changes. */
const SW_SCRIPT_URL = "/sw.js?v=4"

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
        // Workers stuck on an older script URL can never pick up new code
        // (their update check was poisoned — see SW_SCRIPT_URL) — drop them so
        // the new script is fetched cold, then register it.
        const registrations = await navigator.serviceWorker.getRegistrations()
        const isCurrent = (registration: ServiceWorkerRegistration) =>
          [registration.active, registration.installing, registration.waiting].some(
            (worker) => worker?.scriptURL.includes("?v=4")
          )
        const stale = registrations.filter((registration) => !isCurrent(registration))
        if (stale.length > 0) {
          await Promise.all(stale.map((registration) => registration.unregister()))
        }
        if (cancelled) return

        await navigator.serviceWorker.register(SW_SCRIPT_URL, {
          scope: "/",
          updateViaCache: "none",
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
