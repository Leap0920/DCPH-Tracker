"use client"

import { useSyncExternalStore } from "react"

/*
 * Shared store for "character chrome hidden" state.
 *
 * The chat widget is mounted globally in app/layout.tsx (via ChatWidgetLoader)
 * and must NOT unmount when a character dossier opens on /characters — that
 * would wipe chat history and auth state. This tiny pub/sub lets the
 * characters explorer publish a visibility flag and the ChatWidget subscribe
 * to it, so the launcher/panel are hidden with CSS while staying mounted.
 */

let chromeHidden = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return chromeHidden
}

function getServerSnapshot(): boolean {
  return false
}

/** Publish whether global chrome (chat launcher/panel) should be hidden. */
export function setCharacterChromeHidden(hidden: boolean): void {
  if (hidden === chromeHidden) return
  chromeHidden = hidden
  listeners.forEach((notify) => notify())
}

/** Subscribe to the chrome-hidden flag (ChatWidget + any future chrome). */
export function useCharacterChromeHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
