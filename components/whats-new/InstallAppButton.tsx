"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { ChevronRight, Download, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

/** Chromium's deferred-install event; not part of TS's DOM lib. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type InstallSnapshot = { installed: boolean; hasPrompt: boolean }

const SHEET_TITLE = "Add to home screen"

/* How long a tapped row keeps waiting for the browser's deferred install
 * prompt before reporting that none is on offer. */
const PROMPT_WAIT_MS = 8000

const WAITING_TEXT = "Getting your browser ready\u2026"
const UNAVAILABLE_TEXT =
  "The install dialog didn\u2019t appear \u2014 if DCPH is already on your home screen you\u2019re all set, otherwise try again in a moment."
const IOS_TEXT = "On iPhone: tap Share, then \u201cAdd to Home Screen\u201d."

/* -------------------------------------------------------------------------
 * Tiny module store.
 *
 * The triggers (dropdown row, drawer row) and the sheet host live in
 * different parts of the tree — the dropdown unmounts its children the
 * moment it closes — so the deferred prompt, the "already installed" flag,
 * and the "sheet should open" signal live here instead of in component
 * state.
 * ---------------------------------------------------------------------- */

let promptEvent: BeforeInstallPromptEvent | null = null
let installedFlag = false
let initialized = false
let snapshot: InstallSnapshot = { installed: false, hasPrompt: false }
const stateSubs = new Set<() => void>()
const openSubs = new Set<() => void>()
const serverSnapshot: InstallSnapshot = { installed: false, hasPrompt: false }
let onBeforeInstall: ((event: Event) => void) | null = null
let onInstalled: (() => void) | null = null

function emit() {
  snapshot = { installed: installedFlag, hasPrompt: promptEvent !== null }
  for (const fn of stateSubs) fn()
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  // Already running as an installed app?
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const standalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  if (iosStandalone || standalone) {
    installedFlag = true
    emit()
    return
  }

  onBeforeInstall = (event: Event) => {
    // Suppress the browser's own mini-infobar; we surface our own control.
    event.preventDefault()
    promptEvent = event as BeforeInstallPromptEvent
    emit()
  }
  onInstalled = () => {
    // Only a confirmed installation retires the offer.
    installedFlag = true
    promptEvent = null
    emit()
  }
  window.addEventListener("beforeinstallprompt", onBeforeInstall)
  window.addEventListener("appinstalled", onInstalled)
}

// Attach as early as possible — the deferred prompt can fire before React's
// first render, and an event we miss is an install offer lost for that visit.
ensureInit()

function subscribeState(fn: () => void) {
  ensureInit()
  stateSubs.add(fn)
  return () => {
    stateSubs.delete(fn)
  }
}

function getSnapshot() {
  return snapshot
}

function subscribeOpen(fn: () => void) {
  openSubs.add(fn)
  return () => {
    openSubs.delete(fn)
  }
}

/** Open the install sheet from anywhere (the triggers call this). */
export function requestInstallSheet() {
  for (const fn of openSubs) fn()
}

/**
 * Spend the deferred prompt right now — the actual "download" action.
 * Returns "unavailable" when the browser never offered one (or refused), so
 * the sheet can surface a plain status note instead.
 *
 * Deliberately does NOT mark the app installed on "accepted": Chrome reports
 * that the moment the user taps Install, and the installation can still be
 * aborted or fail afterwards. Only the real `appinstalled` event (or running
 * standalone) retires the row — so backing out never makes the control
 * disappear.
 */
async function promptInstallNow(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!promptEvent) return "unavailable"
  const event = promptEvent
  let outcome: "accepted" | "dismissed" = "dismissed"
  try {
    await event.prompt()
    const choice = await event.userChoice
    outcome = choice.outcome === "accepted" ? "accepted" : "dismissed"
  } catch {
    // The prompt refused.
    promptEvent = null
    emit()
    return "unavailable"
  }
  // A deferred prompt can only be spent once.
  promptEvent = null
  emit()
  return outcome
}

/** Test helper: drop all module state + window listeners between tests. */
export function __resetInstallStoreForTests() {
  if (typeof window !== "undefined") {
    if (onBeforeInstall) window.removeEventListener("beforeinstallprompt", onBeforeInstall)
    if (onInstalled) window.removeEventListener("appinstalled", onInstalled)
  }
  onBeforeInstall = null
  onInstalled = null
  promptEvent = null
  installedFlag = false
  initialized = false
  snapshot = { installed: false, hasPrompt: false }
  stateSubs.clear()
  openSubs.clear()
}

function useInstallState(): InstallSnapshot {
  return useSyncExternalStore(subscribeState, getSnapshot, () => serverSnapshot)
}

function detectPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent || ""
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (isIOS) return "ios"
  if (/Android/i.test(ua)) return "android"
  return "desktop"
}

/**
 * "Add to home screen" — the single download control.
 *
 * Tapping it brings up the "Add to home screen" sheet, whose one action —
 * Install — fires the browser's real install flow on the spot, or waits
 * briefly and fires it the moment it's offered. Nothing ever points at the
 * browser's own menu. The row retires only once the app is genuinely
 * installed (or the site is already running as the installed app).
 *
 * Shapes:
 *  - "panel":  full-width button (standalone panels)
 *  - "menu":   a row in the navbar user dropdown
 *  - "drawer": a row in the mobile menu (pass onTriggered to close it)
 */
export function InstallAppButton({
  variant = "panel",
  onTriggered,
}: {
  variant?: "panel" | "menu" | "drawer"
  onTriggered?: () => void
} = {}) {
  const { installed } = useInstallState()
  if (installed) return null

  const trigger = () => {
    onTriggered?.()
    // Show the "Add to home screen" sheet — the install action, sliding up
    // right when the control is pressed.
    requestInstallSheet()
  }

  if (variant === "menu") {
    return (
      <DropdownMenuItem
        onSelect={trigger}
        className="flex items-center gap-2.5 px-3 py-2 text-xs font-display cursor-pointer"
      >
        <Download className="h-4 w-4 text-ink-dim" />
        Add to home screen
      </DropdownMenuItem>
    )
  }

  if (variant === "drawer") {
    return (
      <Button
        variant="ghost"
        onClick={trigger}
        className="w-full justify-start gap-2.5 font-display"
      >
        <Download className="h-4 w-4" />
        Add to home screen
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={trigger}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface-muted px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:border-ink-faint/40 hover:bg-surface"
    >
      <Download className="h-3.5 w-3.5 text-accent-bright" />
      Add to home screen
    </button>
  )
}

/**
 * The install sheet — "Add to home screen". Mount once (Navbar) — it portals
 * to <body> so the header's transform never traps the fixed overlay, and it
 * stays alive while the dropdown/drawer that opened it unmount.
 */
export function InstallSheetHost() {
  const { installed, hasPrompt } = useInstallState()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(
    () =>
      subscribeOpen(() => {
        setBusy(false)
        setNote(null)
        setOpen(true)
      }),
    []
  )

  // A confirmed installation retires the sheet.
  useEffect(() => {
    if (installed) setOpen(false)
  }, [installed])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  // No scrolling underneath the sheet.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const fire = useCallback(async () => {
    const outcome = await promptInstallNow()
    setBusy(false)
    if (outcome === "unavailable") {
      setNote(UNAVAILABLE_TEXT)
    } else {
      // The browser's own dialog took over — the sheet has done its job.
      // (The row itself stays until `appinstalled` confirms a real install.)
      setOpen(false)
    }
  }, [])

  // A prompt that arrives while the row is waiting fires on the spot.
  useEffect(() => {
    if (!busy || !hasPrompt) return
    void fire()
  }, [busy, hasPrompt, fire])

  // And if none ever arrives, report it — in plain words, no menu directions.
  useEffect(() => {
    if (!busy) return
    const timer = window.setTimeout(() => {
      setBusy(false)
      setNote(UNAVAILABLE_TEXT)
    }, PROMPT_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [busy])

  if (!mounted || !open) return null

  const platform = detectPlatform()

  const attempt = () => {
    if (platform === "ios") {
      setNote(IOS_TEXT)
      return
    }
    if (promptEvent) {
      // Immediate: the browser's install flow opens on this tap.
      void fire()
      return
    }
    setNote(null)
    setBusy(true)
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SHEET_TITLE}
        className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-3xl border border-line bg-surface shadow-card sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[22rem] sm:max-w-none sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between pl-4 pr-3 pt-3 sm:pt-4">
          <h2 className="font-display text-sm font-semibold text-ink">{SHEET_TITLE}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-2 pb-3 pt-1 sm:pb-4">
          {/* Install — the app, the one download action. */}
          <button
            type="button"
            onClick={attempt}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface-muted"
          >
            <span className="relative flex h-10 w-10 shrink-0" aria-hidden="true">
              <Image
                src="/tab-icon.png"
                alt=""
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 rounded-full border border-line bg-surface-muted object-contain"
              />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface">
                <Download className="h-2.5 w-2.5 text-accent-bright" />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xs font-medium text-ink">Install</span>
              <span className="block text-[11px] leading-tight text-ink-faint">
                Adds DCPH to your home screen and opens it like an app
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
          </button>

          {(busy || note) && (
            <p
              role="status"
              className="mx-2.5 mb-1.5 mt-1.5 rounded-lg border border-line bg-surface-muted px-3 py-2 text-[11px] leading-snug text-ink-dim"
            >
              {busy ? WAITING_TEXT : note}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
