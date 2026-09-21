"use client"

import { useSyncExternalStore } from "react"

/**
 * Cache of MediaQueryList objects — one per query string.
 *
 * useSyncExternalStore calls getSnapshot on every render (and on every store
 * consistency check); without this cache each call allocated a fresh
 * MediaQueryList (query parse + object alloc) per component per render, and
 * each subscription registered a listener on a duplicate MQL object.
 */
const mqlCache = new Map<string, MediaQueryList>()

function getMql(query: string): MediaQueryList {
  let mql = mqlCache.get(query)
  if (!mql) {
    mql = window.matchMedia(query)
    mqlCache.set(query, mql)
  }
  return mql
}

/**
 * Hydration-safe matchMedia hook.
 *
 * Reads synchronously on the client via useSyncExternalStore, so the FIRST
 * client render already reflects the real viewport (the old useState+effect
 * version rendered `false` for a frame, which made the characters bottom
 * sheet flash its desktop layout before flipping). Falls back to `false` on
 * the server.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = getMql(query)
      mql.addEventListener("change", onStoreChange)
      return () => mql.removeEventListener("change", onStoreChange)
    },
    () => getMql(query).matches,
    () => false,
  )
}
