/**
 * Device tier — how much graphics the visitor's device should be asked to draw.
 *
 * Three tiers, worst-case wins: every signal below can only LOWER the tier, so a
 * fast desktop stays `high`, a phone tops out at `balanced`, and anything with a
 * weak CPU, little memory, a metered/slow connection or a reduced-motion
 * preference lands on `low`.
 *
 * Two rules keep this predictable for a returning visitor:
 *
 *   1. An explicit choice is final. `source: "user"` preferences are never
 *      touched by detection or by the frame probe — a visitor who picks High on
 *      a phone they know handles it keeps High.
 *   2. An accepted suggestion is adaptive. `source: "auto"` preferences may be
 *      lowered once by the frame probe (see `probeFrameHealth`) when the device
 *      admits it cannot hold the frame budget. It is never raised back
 *      automatically, so quality cannot oscillate between visits.
 *
 * Everything here is pure or explicitly client-only: `readDeviceSignals()` is
 * the only function that touches `navigator`/`matchMedia` and it no-ops on the
 * server, so the module is safe to import from a server-rendered client
 * component.
 */

export type QualityTier = "high" | "balanced" | "low"

/** Best → worst. `indexOf` is how comparisons are made, so keep the order. */
export const TIERS: readonly QualityTier[] = ["high", "balanced", "low"]

export const TIER_STORAGE_KEY = "dcph:characters-quality"

export interface DeviceSignals {
  /** navigator.hardwareConcurrency — logical cores, absent on Safari/Firefox. */
  cores?: number
  /** navigator.deviceMemory — GB, Chromium-only, capped at 8. */
  memoryGB?: number
  /** navigator.connection.saveData — the visitor asked for less data. */
  saveData?: boolean
  /** navigator.connection.effectiveType — "4g", "3g", "2g", "slow-2g". */
  effectiveType?: string
  /** prefers-reduced-motion: reduce — the visitor asked for less motion. */
  reduceMotion?: boolean
  /** (pointer: coarse) — a finger, not a mouse. True on every phone/tablet. */
  coarsePointer?: boolean
  /** Screen area in CSS px², paired with `dpr` as a rough GPU/workload proxy. */
  screenArea?: number
  /** window.devicePixelRatio. */
  dpr?: number
}

export interface TierSuggestion {
  tier: QualityTier
  /** Human-readable reasons, in the order they were applied. Shown in the modal. */
  reasons: string[]
}

/** Lower of two tiers (i.e. the more conservative one). */
export function minTier(a: QualityTier, b: QualityTier): QualityTier {
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b
}

/** One step down the ladder; `low` is the floor. */
export function downgrade(tier: QualityTier): QualityTier {
  const i = TIERS.indexOf(tier)
  return TIERS[Math.min(TIERS.length - 1, i + 1)]
}

/**
 * Turn device signals into a tier. Pure — the whole detection policy is
 * testable without a browser.
 *
 * The starting point is `high`, and each signal can only cap it lower:
 *
 *  - reduced motion            → low     (the visitor does not want the drift)
 *  - save-data / 2g / 3g       → low     (effect work is wasted on a slow link)
 *  - ≤2 GB or ≤2 cores         → low     (budget hardware)
 *  - ≤4 GB or ≤4 cores         → balanced
 *  - coarse pointer (phone)    → balanced (the request: prioritise mobile)
 *  - coarse pointer AND ≤4GB/≤4cores → low (a modest phone needs the still graph)
 *  - ≥3x DPR on a big screen   → balanced (many pixels to repaint per frame)
 */
export function classifyDevice(signals: DeviceSignals): TierSuggestion {
  const reasons: string[] = []
  let tier: QualityTier = "high"

  const cap = (next: QualityTier, reason: string) => {
    if (TIERS.indexOf(next) > TIERS.indexOf(tier)) {
      tier = next
      reasons.push(reason)
    }
  }

  if (signals.reduceMotion) cap("low", "Your system asks for reduced motion")

  const slowLink =
    signals.saveData === true ||
    (signals.effectiveType !== undefined &&
      ["slow-2g", "2g", "3g"].includes(signals.effectiveType))
  if (slowLink) {
    cap("low", signals.saveData ? "Data Saver is on" : "Your connection is slow")
  }

  const { cores, memoryGB } = signals
  if (memoryGB !== undefined && memoryGB <= 2) cap("low", "2 GB of memory or less")
  if (cores !== undefined && cores <= 2) cap("low", "2 CPU cores or fewer")
  if (memoryGB !== undefined && memoryGB > 2 && memoryGB <= 4) {
    cap("balanced", `${memoryGB} GB of memory`)
  }
  if (cores !== undefined && cores > 2 && cores <= 4) {
    cap("balanced", `${cores} CPU cores`)
  }

  if (signals.coarsePointer) cap("balanced", "Touch device")

  /*
   * A 4 GB phone is the tier the low budget was written for. Stopping it at
   * `balanced` meant the heaviest phone could never reach the frame-capped
   * still graph, so it kept paying for drift, particles and a 50fps loop on a
   * device that most visibly struggles. Cores/memory only DOWNGRADE from here,
   * so a fast 8 GB phone is untouched.
   */
  const modestPhone =
    signals.coarsePointer === true &&
    ((memoryGB !== undefined && memoryGB <= 4) ||
      (cores !== undefined && cores <= 4))
  if (modestPhone) cap("low", "Modest phone (4 GB / 4 cores or less)")

  const bigHiDpiScreen =
    signals.screenArea !== undefined &&
    signals.dpr !== undefined &&
    signals.dpr >= 3 &&
    signals.screenArea >= 375 * 667
  if (bigHiDpiScreen) cap("balanced", "High-density screen")

  if (reasons.length === 0) reasons.push("Fast, mouse-driven device")

  return { tier, reasons }
}

/** Read the live device signals. Server-safe (returns an empty signal set). */
export function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === "undefined" || typeof window === "undefined") return {}
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean; effectiveType?: string }
  }
  const signals: DeviceSignals = {}

  if (typeof nav.hardwareConcurrency === "number") signals.cores = nav.hardwareConcurrency
  if (typeof nav.deviceMemory === "number") signals.memoryGB = nav.deviceMemory
  if (nav.connection?.saveData !== undefined) signals.saveData = nav.connection.saveData
  if (nav.connection?.effectiveType !== undefined) {
    signals.effectiveType = nav.connection.effectiveType
  }
  if (typeof window.matchMedia === "function") {
    signals.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    signals.coarsePointer = window.matchMedia("(pointer: coarse)").matches
  }
  if (typeof window.devicePixelRatio === "number") signals.dpr = window.devicePixelRatio
  if (screen && typeof screen.width === "number" && typeof screen.height === "number") {
    signals.screenArea = screen.width * screen.height
  }

  return signals
}

/** Detection for the current device. */
export function suggestTier(): TierSuggestion {
  return classifyDevice(readDeviceSignals())
}

export interface QualityPreference {
  tier: QualityTier
  /** "user" = chosen in the modal, "auto" = detected and accepted. */
  source: "user" | "auto"
}

export function isQualityTier(value: unknown): value is QualityTier {
  return value === "high" || value === "balanced" || value === "low"
}

/** The stored preference, or null when the visitor has never been asked. */
export function loadPreference(): QualityPreference | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(TIER_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const { tier, source } = parsed as { tier?: unknown; source?: unknown }
    if (!isQualityTier(tier)) return null
    return { tier, source: source === "user" ? "user" : "auto" }
  } catch {
    // Private mode / disabled storage / corrupt JSON: fall back to detection.
    return null
  }
}

export function savePreference(preference: QualityPreference): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(TIER_STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // Storage unavailable — the tier still applies for this session.
  }
}

export interface TierCopy {
  label: string
  blurb: string
  details: string
}

export const TIER_COPY: Record<QualityTier, TierCopy> = {
  high: {
    label: "High",
    blurb: "Every effect on",
    details: "Ambient motion, floating particles, breathing rings and the full string glow.",
  },
  balanced: {
    label: "Balanced",
    blurb: "Recommended for phones",
    details:
      "Keeps the gentle drift and a few particles, but stops the breathing rings that repaint every node.",
  },
  low: {
    label: "Low",
    blurb: "Maximum performance",
    details:
      "A still graph with instant pan and zoom: no ambient motion, particles or animated rings.",
  },
}

export interface FrameHealth {
  /** Mean frame time in ms across the sampled window. */
  meanMs: number
  /** 95th-percentile frame time in ms. */
  p95Ms: number
  frames: number
}

/**
 * Sample real frame times for `durationMs` and decide whether the device is
 * keeping up. Resolves `null` when the page never produced frames (a hidden or
 * frozen tab gives rAF nothing), which must not be read as "slow".
 *
 * The first `warmupFrames` frames are discarded: the graph's own mount, the
 * fonts and the images all land in them on a first visit.
 */
export function probeFrameHealth(
  durationMs = 1600,
  warmupFrames = 20
): Promise<FrameHealth | null> {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const samples: number[] = []
    let last = performance.now()
    const started = last
    let frames = 0

    const tick = (now: number) => {
      const delta = now - last
      last = now
      frames++
      // A gap this large is a tab switch / sleep, not a slow frame.
      if (frames > warmupFrames && delta < 200) samples.push(delta)
      if (now - started < durationMs + warmupFrames * 8 && samples.length < 240) {
        requestAnimationFrame(tick)
        return
      }
      if (samples.length < 30) {
        resolve(null)
        return
      }
      const sorted = [...samples].sort((a, b) => a - b)
      resolve({
        meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        frames: samples.length,
      })
    }
    requestAnimationFrame(tick)
  })
}

/** Thresholds for `probeFrameHealth` verdicts. */
export const SLOW_FRAME_P95_MS = 34
export const SLOW_FRAME_MEAN_MS = 22

/** True when the sampled frames say the device is struggling. */
export function isStruggling(health: FrameHealth | null): boolean {
  if (!health) return false
  return health.p95Ms > SLOW_FRAME_P95_MS || health.meanMs > SLOW_FRAME_MEAN_MS
}
