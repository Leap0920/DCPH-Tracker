/**
 * Full-franchise watch order for the tracker's "Full Watch Order" mode.
 *
 * The STEPS array is the source of truth: an ordered list of *selectors*, not
 * of rows. Each step is resolved against the live content table at render time,
 * so the guide self-heals as episodes are added and never hardcodes DB ids.
 *
 * Two rules make it safe:
 *   1. FIRST MATCH WINS — an entry claimed by an earlier step is never re-used,
 *      so overlapping selectors can't duplicate a row.
 *   2. Steps that resolve to nothing are skipped silently, so placeholders for
 *      content the DB doesn't have yet are harmless.
 *
 * Entries no step references (e.g. compilation/manner shorts) intentionally do
 * not appear — this is a curated path through the franchise, not a full index.
 */

/**
 * Structural shape the resolver needs. Declared locally (rather than importing
 * the generated Row type) so this module stays testable with plain fixtures.
 * `dcw_title` / `release_order` are optional: if a schema lacks them, the
 * selectors that depend on them simply never match.
 */
export interface WatchOrderEntryLike {
  id: string
  type: string
  title: string
  episode_number: number | null
  movie_number: number | null
  air_date: string | null
  release_order?: number | null
  dcw_title?: string | null
}

export type WatchOrderStep =
  /** Inclusive episode_number range. Omit `to` for "N onwards". */
  | { kind: "episodes"; from: number; to?: number }
  /** Movie by movie_number. */
  | { kind: "movie"; n: number }
  /** Movie by title — for the crossover/compilation films that have no number. */
  | { kind: "movieTitle"; value: string }
  /** Title substring, optionally scoped to a content type. */
  | { kind: "titleContains"; value: string; type?: string }
  /** "Detective Conan Magic File: 01" / "... Magic File 2: ..." — number extracted. */
  | { kind: "magicFile"; n: number }
  /** Nth TV special in air-date order (1-based). */
  | { kind: "specialSeq"; n: number }
  /** Exact dcw_title within a content type (live-action drama, MK specials). */
  | { kind: "dcwTitle"; type: string; value: string }
  /** Magic Kaito 1412 episodes by episode_number. */
  | { kind: "mk1412"; nums: number[] }
  /** Spin-off entries whose title ends in an index (Zero's Tea Time, Hanzawa). */
  | { kind: "titleNums"; type: string; nums: number[] }

export interface WatchOrderItem<T> {
  entry: T
  /** 1-based position in the full resolved order. */
  position: number
  /** Index into WATCH_ORDER_STEPS that claimed this entry. */
  stepIndex: number
}

/* ───────────────────────── Step builders ───────────────────────── */

const E = (from: number, to?: number): WatchOrderStep => ({ kind: "episodes", from, to })
const M = (n: number): WatchOrderStep => ({ kind: "movie", n })
const MT = (value: string): WatchOrderStep => ({ kind: "movieTitle", value })
const OVA = (value: string): WatchOrderStep => ({ kind: "titleContains", value, type: "ova" })
const MF = (n: number): WatchOrderStep => ({ kind: "magicFile", n })
const SP = (n: number): WatchOrderStep => ({ kind: "specialSeq", n })
const LA = (value: string): WatchOrderStep => ({ kind: "dcwTitle", type: "live_action", value })
const MKS = (value: string): WatchOrderStep => ({ kind: "dcwTitle", type: "magic_kaito", value })
const MK = (...nums: number[]): WatchOrderStep => ({ kind: "mk1412", nums })
const ZTT = (...nums: number[]): WatchOrderStep => ({
  kind: "titleNums",
  type: "zero_tea_time",
  nums,
})
const HZ = (...nums: number[]): WatchOrderStep => ({ kind: "titleNums", type: "hanzawa", nums })

/* ───────────────────────── The order ───────────────────────── */

export const WATCH_ORDER_STEPS: readonly WatchOrderStep[] = [
  E(1, 54),
  M(1),
  E(55, 97),
  M(2),
  E(98, 139),
  OVA("Aoyama Short Stories Part 1"),
  E(140, 140),
  M(3),
  E(141, 173),
  OVA("Secret File 01"),
  OVA("Aoyama Short Stories Part 2"),
  E(174, 186),
  M(4),
  E(187, 231),
  M(5),
  E(232, 262),
  OVA("Secret File 02"),
  E(263, 275),
  M(6),
  E(276, 303),
  OVA("Secret File 03"),
  E(304, 315),
  M(7),
  E(316, 344),
  OVA("Secret File 04"),
  E(345, 356),
  SP(1), // Time Travel of the Silver Sky
  M(8),
  E(357, 383),
  OVA("Secret File 05"),
  E(384, 396),
  M(9),
  E(397, 434),
  M(10),
  OVA("Secret File 06"),
  E(435, 452),
  LA("Live Action Drama Special 01"),
  E(453, 459),
  OVA("Secret File 07"),
  E(460, 468),
  MF(1),
  E(469, 470),
  M(11),
  E(471, 490),
  OVA("Secret File 08"),
  LA("Live Action Drama Special 02"),
  SP(2), // Black History
  E(491, 504),
  MF(2),
  M(12),
  E(505, 520),
  OVA("Secret File 09"),
  E(521, 529),
  SP(3), // Lupin III vs. Detective Conan (TV special)
  E(530, 531),
  MF(3),
  M(13),
  E(532, 561),
  OVA("Secret File 10"),
  E(562, 570),
  M(14),
  MF(4),
  MKS("Magic Kaito Special 01"),
  E(571, 610),
  OVA("Detective Conan vs Wooo"),
  LA("Live Action Drama Special 03"),
  M(15),
  MF(5),
  E(611, 616),
  OVA("Secret File 11"),
  E(617, 623),
  LA("Live Action Drama Episode 01-02"),
  E(624, 624),
  LA("Live Action Drama Episode 03"),
  E(625, 626),
  MKS("Magic Kaito Special 02-03"),
  LA("Live Action Drama Episodes 04-07"),
  E(627, 628),
  LA("Live Action Drama Episodes 08-09"),
  E(629, 630),
  LA("Live Action Drama Episodes 10-11"),
  E(631, 631),
  MKS("Magic Kaito Special 04"),
  LA("Live Action Drama Episode 12-13"),
  E(632, 634),
  MKS("Magic Kaito Special 05"),
  E(635, 641),
  OVA("Secret File 12"),
  MKS("Magic Kaito Special 06"),
  E(642, 651),
  M(16),
  OVA("Bonus File 1"),
  LA("Live Action Drama Special 04"),
  E(652, 666),
  MKS("Magic Kaito Special 07-08"),
  E(667, 670),
  MKS("Magic Kaito Special 09"),
  E(671, 674),
  MKS("Magic Kaito Special 10"),
  E(675, 680),
  MKS("Magic Kaito Special 11-12"),
  E(681, 694),
  M(17),
  E(695, 721),
  MT("Lupin III vs. Detective Conan: The Movie"),
  E(722, 735),
  M(18),
  E(736, 753),
  MK(1),
  E(754, 756),
  MK(2, 3, 4),
  E(757, 758),
  MK(5, 6),
  E(759, 760),
  MK(7, 8),
  E(761, 762),
  MK(9, 10, 11),
  SP(4), // Fugitive: Kogoro Mouri
  MK(12),
  SP(5), // The Disappearance of Conan Edogawa
  E(763, 764),
  MK(13, 14),
  E(765, 766),
  MK(15, 16),
  E(767, 767),
  MK(17, 18),
  E(768, 768),
  MK(19),
  E(769, 769),
  MK(20),
  E(770, 771),
  MK(21, 22),
  E(772, 773),
  MK(23, 24),
  E(774, 774),
  M(19),
  E(775, 813),
  M(20),
  E(814, 841),
  SP(6), // Episode One
  E(842, 855),
  M(21),
  E(856, 898),
  M(22),
  OVA("Bonus File 02"), // placeholder — no such row today, skipped silently
  E(899, 936),
  M(23),
  E(937, 1002),
  MT("The Scarlet Alibi"),
  M(24),
  E(1003, 1038),
  ZTT(1, 2),
  E(1039, 1039),
  SP(7), // Love Story at Police Headquarters ~Wedding Eve~
  M(25),
  ZTT(3),
  E(1040, 1040),
  ZTT(4),
  E(1041, 1041),
  ZTT(5),
  E(1042, 1042),
  ZTT(6),
  E(1043, 1058),
  HZ(1),
  E(1059, 1059),
  HZ(2),
  E(1060, 1060),
  HZ(3, 4),
  E(1061, 1061),
  HZ(5),
  E(1062, 1062),
  HZ(6),
  E(1063, 1063),
  HZ(7),
  E(1064, 1064),
  HZ(8),
  E(1065, 1065),
  HZ(9),
  E(1066, 1066),
  HZ(10, 11, 12),
  E(1067, 1076),
  SP(8), // Star Detectives Assemble
  E(1077, 1080),
  MT("Compilation Movie (The Story of Haibara)"),
  M(26),
  E(1081, 1120),
  MT("Conan vs Kid"), // placeholder — no such row today, skipped silently
  M(27),
  E(1121, 1160),
  M(28),
  E(1161), // open-ended: everything from 1161 on
]

/* ───────────────────────── Matching helpers ───────────────────────── */

/** Case- and whitespace-insensitive comparison key. */
function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Trailing index in a title: "The Culprit Hanzawa 12" -> 12. */
function trailingNumber(title: string): number | null {
  const match = /(\d+)\s*$/.exec(title.trim())
  if (!match || match[1] === undefined) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isInteger(n) ? n : null
}

/** Matches "Magic File: 01", "Magic File 2: ...", "Magic File3". */
const MAGIC_FILE_RE = /magic file\D*0*(\d+)/i

function magicFileNumber(title: string): number | null {
  const match = MAGIC_FILE_RE.exec(title)
  if (!match || match[1] === undefined) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isInteger(n) ? n : null
}

/** Human-readable step description, for diagnostics. */
export function describeStep(step: WatchOrderStep): string {
  switch (step.kind) {
    case "episodes":
      return step.to === undefined
        ? `Episodes ${step.from} onwards`
        : step.from === step.to
          ? `Episode ${step.from}`
          : `Episodes ${step.from}-${step.to}`
    case "movie":
      return `Movie ${step.n}`
    case "movieTitle":
      return `Movie "${step.value}"`
    case "titleContains":
      return `${step.type ?? "any"} title ~ "${step.value}"`
    case "magicFile":
      return `Magic File ${step.n}`
    case "specialSeq":
      return `TV special #${step.n} (air-date order)`
    case "dcwTitle":
      return `${step.type} "${step.value}"`
    case "mk1412":
      return `Magic Kaito 1412 ep ${step.nums.join(", ")}`
    case "titleNums":
      return `${step.type} #${step.nums.join(", ")}`
  }
}

/* ───────────────────────── Resolver ───────────────────────── */

interface ResolveResult<T> {
  items: WatchOrderItem<T>[]
  /** Indexes of steps that matched nothing. */
  emptySteps: number[]
}

function resolveInternal<T extends WatchOrderEntryLike>(entries: T[]): ResolveResult<T> {
  const byType = new Map<string, T[]>()
  const episodes: T[] = []
  const movies: T[] = []

  for (const entry of entries) {
    const bucket = byType.get(entry.type)
    if (bucket) bucket.push(entry)
    else byType.set(entry.type, [entry])
    if (entry.type === "episode") episodes.push(entry)
    else if (entry.type === "movie") movies.push(entry)
  }

  const ofType = (type: string): T[] => byType.get(type) ?? []

  // TV specials have no reliable numbering, so air date defines their order.
  const specials = [...ofType("special")].sort((a, b) => {
    const byDate = norm(a.air_date).localeCompare(norm(b.air_date))
    return byDate !== 0 ? byDate : a.title.localeCompare(b.title)
  })

  function selectStep(step: WatchOrderStep): T[] {
    switch (step.kind) {
      case "episodes":
        return episodes.filter((e) => {
          const n = e.episode_number
          return n !== null && n >= step.from && (step.to === undefined || n <= step.to)
        })
      case "movie":
        return movies.filter((e) => e.movie_number === step.n)
      case "movieTitle": {
        const needle = norm(step.value)
        return movies.filter((e) => norm(e.title).includes(needle))
      }
      case "titleContains": {
        const needle = norm(step.value)
        const pool = step.type === undefined ? entries : ofType(step.type)
        return pool.filter((e) => norm(e.title).includes(needle))
      }
      case "magicFile":
        // Title-only: "Detective Conan Magic File" is unambiguous across types.
        return entries.filter((e) => magicFileNumber(e.title) === step.n)
      case "specialSeq": {
        const hit = specials[step.n - 1]
        return hit ? [hit] : []
      }
      case "dcwTitle": {
        const needle = norm(step.value)
        return ofType(step.type).filter((e) => norm(e.dcw_title) === needle)
      }
      case "mk1412":
        return ofType("magic_kaito").filter(
          (e) => e.episode_number !== null && step.nums.includes(e.episode_number)
        )
      case "titleNums":
        return ofType(step.type).filter((e) => {
          const n = trailingNumber(e.title)
          return n !== null && step.nums.includes(n)
        })
    }
  }

  /** Sort key inside a multi-entry step. */
  const seq = (entry: T): number =>
    entry.episode_number ?? trailingNumber(entry.title) ?? entry.release_order ?? 0

  const claimed = new Set<string>()
  const items: WatchOrderItem<T>[] = []
  const emptySteps: number[] = []

  WATCH_ORDER_STEPS.forEach((step, stepIndex) => {
    const matches = selectStep(step)
      .filter((entry) => !claimed.has(entry.id))
      .sort((a, b) => seq(a) - seq(b))
    if (matches.length === 0) {
      emptySteps.push(stepIndex)
      return
    }
    for (const entry of matches) {
      claimed.add(entry.id)
      items.push({ entry, position: items.length + 1, stepIndex })
    }
  })

  return { items, emptySteps }
}

/** The franchise in viewing order. Pure — safe inside useMemo. */
export function resolveWatchOrder<T extends WatchOrderEntryLike>(entries: T[]): WatchOrderItem<T>[] {
  return resolveInternal(entries).items
}

/**
 * Steps that matched nothing — the way to catch a typo'd title selector.
 * Some emptiness is expected (Bonus File 02, MK1412 episodes absent from the DB).
 */
export function findUnresolvedSteps<T extends WatchOrderEntryLike>(
  entries: T[]
): { index: number; label: string }[] {
  return resolveInternal(entries).emptySteps.map((index) => {
    const step = WATCH_ORDER_STEPS[index]
    return { index, label: step ? describeStep(step) : `step ${index}` }
  })
}
