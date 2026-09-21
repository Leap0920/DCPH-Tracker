/*
  graph-theme — the single source of truth for graph colors.

  Both the SVG graph and the HTML chrome (legend chips, dossier thread dots)
  read from here, so a relationship's color is identical everywhere in both
  themes. Relationship colors are theme-aware because the authored palette
  contains values that vanish against one background (adversary #0F172A is
  invisible on the dark canvas).
*/

import type { Character, RelationshipType } from "@/lib/characters-guide"

export interface FactionTheme {
  primary: string
  glow: string
  darkFill: string
  lightFill: string
  border: string
  badge: string
}

/*
  The faction taxonomy. The 15 keys and their hues come from the reviewed art
  direction (`example-design/tools/extract-data.mjs`); `AFFILIATION_FACTION`
  maps every one of the 42 authored affiliation strings explicitly, so no
  affiliation can fall through to a catch-all bucket by accident the way a
  substring match let it.
*/
export type FactionKey =
  | "JDL"
  | "KUDO"
  | "OSAKA"
  | "MOURI"
  | "SUZUKI"
  | "KID"
  | "TMPD"
  | "POLICE"
  | "PSB"
  | "FBI"
  | "MI6"
  | "CIA"
  | "BO"
  | "MIYANO"
  | "CIVILIAN"

export const FACTIONS: Record<
  FactionKey,
  { label: string; short: string; hue: string }
> = {
  JDL:      { label: "Junior Detective League", short: "JDL",  hue: "#22D3EE" },
  KUDO:     { label: "Kudo Family",             short: "KUD",  hue: "#38BDF8" },
  OSAKA:    { label: "Osaka & Hattori",         short: "OSA",  hue: "#FB923C" },
  MOURI:    { label: "Mouri & Kisaki",          short: "MOR",  hue: "#2DD4BF" },
  SUZUKI:   { label: "Suzuki Family",           short: "SUZ",  hue: "#F472B6" },
  KID:      { label: "Kaitou Kid",              short: "KID",  hue: "#818CF8" },
  TMPD:     { label: "Tokyo Metropolitan PD",   short: "TMPD", hue: "#FBBF24" },
  POLICE:   { label: "Regional Police",         short: "RPD",  hue: "#D9A441" },
  PSB:      { label: "Public Security Bureau",  short: "PSB",  hue: "#C084FC" },
  FBI:      { label: "FBI",                     short: "FBI",  hue: "#A78BFA" },
  MI6:      { label: "MI6 & Sera Family",       short: "MI6",  hue: "#8B9CF7" },
  CIA:      { label: "CIA",                     short: "CIA",  hue: "#94A3B8" },
  BO:       { label: "Black Organization",      short: "B.O.", hue: "#F43F5E" },
  MIYANO:   { label: "Miyano Family",           short: "MIY",  hue: "#E879B9" },
  CIVILIAN: { label: "Civilians & Allies",      short: "CIV",  hue: "#60A5FA" },
}

/** Every authored `Character.affiliation` resolves through here. */
export const AFFILIATION_FACTION: Record<string, FactionKey> = {
  "Junior Detective League": "JDL",
  "Kudo Family": "KUDO",
  "Osaka / Hattori Household": "OSAKA",
  "Osaka Cast": "OSAKA",
  "Osaka Police": "OSAKA",
  "Hattori Family": "OSAKA",
  "Mouri Detective Agency": "MOURI",
  "Mouri Family": "MOURI",
  "Kisaki Law Offices": "MOURI",
  "Suzuki Family": "SUZUKI",
  "Suzuki Family / Martial Arts Cast": "SUZUKI",
  "Phantom Thief Kid": "KID",
  "Phantom Thief Cast": "KID",
  "Kaito Kid Legacy": "KID",
  "Tokyo Metropolitan Police": "TMPD",
  "Nagano Police": "POLICE",
  "Gunma Police": "POLICE",
  "Shizuoka Police": "POLICE",
  "Saitama Police": "POLICE",
  "Kyoto Police": "POLICE",
  "Regional Police": "POLICE",
  "Hokkaido Police": "POLICE",
  "Public Security Bureau": "PSB",
  "Public Security Bureau (deceased)": "PSB",
  "Public Security Bureau / Black Organization": "PSB",
  FBI: "FBI",
  "MI6 / Sera Family": "MI6",
  "Akai Family / MI6": "MI6",
  "Teitan High School": "MI6",
  "CIA / Black Organization": "CIA",
  "CIA Connection": "CIA",
  "Black Organization": "BO",
  "Black Organization (deceased)": "BO",
  "Miyano Family": "MIYANO",
  "Beika Inventor & Supporting Cast": "CIVILIAN",
  "Haneda Family": "CIVILIAN",
  Civilian: "CIVILIAN",
  "Media / Celebrity": "CIVILIAN",
  "Soccer World": "CIVILIAN",
  "Café Poirot": "CIVILIAN",
  "Nagoya Detectives": "CIVILIAN",
  "Teitan Elementary": "CIVILIAN",
}

/** The dark board ground. `darkFill` mixes toward it, `lightFill` toward white. */
const BOARD_GROUND = "#0B1220"

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgbOf(a)
  const [br, bg, bb] = rgbOf(b)
  const byte = (v: number) =>
    Math.round(v).toString(16).padStart(2, "0").toUpperCase()
  const mix = (x: number, y: number) => byte(x + (y - x) * t)
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`
}

/*
  The five surface variants the components expect, derived from the one hue the
  art direction actually chose. Pure and deterministic, run once at module load
  for the 8 factions that have no hand-authored theme — no new hue is invented,
  only the tints the existing palette already sits between.
*/
function themeFromHue(key: FactionKey): FactionTheme {
  const hue = FACTIONS[key].hue
  const [r, g, b] = rgbOf(hue)
  return {
    primary: hue,
    glow: `rgba(${r}, ${g}, ${b}, 0.5)`,
    darkFill: mixHex(hue, BOARD_GROUND, 0.66),
    lightFill: mixHex(hue, "#FFFFFF", 0.86),
    border: mixHex(hue, "#FFFFFF", 0.42),
    badge: FACTIONS[key].label,
  }
}

/* Same hue identities as the original palette, harmonised for equal perceived
   weight and lifted out of the muddy range on dark surfaces. Seven factions
   carry a hand-authored theme; the rest are derived from their hue below. */
const AUTHORED_FACTION_THEMES: Partial<Record<FactionKey, FactionTheme>> = {
  JDL: {
    primary: "#22D3EE",
    glow: "rgba(34, 211, 238, 0.55)",
    darkFill: "#0B4A5E",
    lightFill: "#CFF6FD",
    border: "#67E8F9",
    badge: "Protagonists",
  },
  KUDO: {
    primary: "#38BDF8",
    glow: "rgba(56, 189, 248, 0.5)",
    darkFill: "#0B4166",
    lightFill: "#D6EEFE",
    border: "#7DD3FC",
    badge: "Kudo Family",
  },
  BO: {
    primary: "#F43F5E",
    glow: "rgba(244, 63, 94, 0.55)",
    darkFill: "#5C1224",
    lightFill: "#FEE0E6",
    border: "#FB7185",
    badge: "Black Organization",
  },
  TMPD: {
    primary: "#FBBF24",
    glow: "rgba(251, 191, 36, 0.5)",
    darkFill: "#5A3A08",
    lightFill: "#FEF0CC",
    border: "#FCD34D",
    badge: "Police Department",
  },
  OSAKA: {
    primary: "#FB923C",
    glow: "rgba(251, 146, 60, 0.5)",
    darkFill: "#5E2A0C",
    lightFill: "#FEE7CF",
    border: "#FDBA74",
    badge: "Osaka Police",
  },
  MOURI: {
    primary: "#2DD4BF",
    glow: "rgba(45, 212, 191, 0.45)",
    darkFill: "#0C4B47",
    lightFill: "#CDF6F0",
    border: "#5EEAD4",
    badge: "Mouri Agency",
  },
  CIVILIAN: {
    primary: "#60A5FA",
    glow: "rgba(96, 165, 250, 0.42)",
    darkFill: "#12365E",
    lightFill: "#DCEAFE",
    border: "#93C5FD",
    badge: "Civilians & Allies",
  },
}

export const FACTION_THEMES: Record<string, FactionTheme> = Object.fromEntries(
  (Object.keys(FACTIONS) as FactionKey[]).map((key) => [
    key,
    AUTHORED_FACTION_THEMES[key] ?? themeFromHue(key),
  ])
)

/** Locked/silhouette palette. Deliberately outside FACTION_THEMES so a locked
 *  node can never be tinted by the faction it belongs to. */
export const LOCKED_THEME = {
  fill: "#1E293B",
  fillLight: "#E2E8F0",
  stroke: "#64748B",
  glow: "rgba(100, 116, 139, 0.25)",
  label: "#94A3B8",
  dash: "6 5",
} as const

/** Neutral colour for a silhouetted red string. */
export const LOCKED_EDGE_COLOR = "#475569"

export const FACTION_KEYS = Object.keys(FACTION_THEMES)

/** Stable DOM-safe id fragment for a faction key (used for <radialGradient id>). */
export function factionSlug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** Resolve an affiliation string to its faction key + theme. Explicit lookup —
 *  an unmapped affiliation is civilians, never a substring accident. */
export function resolveFaction(affiliation: string): {
  key: string
  theme: FactionTheme
} {
  const key = AFFILIATION_FACTION[affiliation] ?? "CIVILIAN"
  return { key, theme: FACTION_THEMES[key] ?? FACTION_THEMES.CIVILIAN }
}

export function getFactionTheme(affiliation: string): FactionTheme {
  return resolveFaction(affiliation).theme
}

/*
  Relationship colors. `light` keeps the authored hue for the light canvas;
  `dark` is the same hue lifted so it survives the near-black canvas.
  adversary is deliberately monochrome — stark, and distinct from the
  mid-grey colleague thread in both themes.
*/
const RELATIONSHIP_COLORS: Record<
  RelationshipType,
  { light: string; dark: string }
> = {
  romance: { light: "#DC2626", dark: "#FB7185" },
  family: { light: "#D97706", dark: "#FBBF24" },
  friendship: { light: "#2563EB", dark: "#60A5FA" },
  rivalry: { light: "#7C3AED", dark: "#A78BFA" },
  mentor: { light: "#059669", dark: "#34D399" },
  colleague: { light: "#64748B", dark: "#94A3B8" },
  secret_identity: { light: "#DB2777", dark: "#F472B6" },
  adversary: { light: "#111827", dark: "#E2E8F0" },
}

/** The one resolver used by graph edges, legend chips and dossier dots. */
export function getRelationshipColor(
  type: RelationshipType,
  isDark: boolean
): string {
  const entry = RELATIONSHIP_COLORS[type]
  if (!entry) return isDark ? "#94A3B8" : "#64748B"
  return isDark ? entry.dark : entry.light
}

/** Node sizing by narrative importance (unchanged rules). */
export function getNodeRadius(c: Character, degree: number): number {
  if (c.id === "conan-edogawa") return 26
  if (
    c.id === "ran-mouri" ||
    c.id === "ai-haibara" ||
    c.id === "kogoro-mouri" ||
    c.id === "heiji-hattori" ||
    c.id === "kaitou-kid" ||
    c.id === "tooru-amuro" ||
    c.id === "shuichi-akai" ||
    c.id === "gin"
  ) {
    return 20
  }
  if (
    c.id === "vermouth" ||
    c.id === "inspector-megure" ||
    c.id === "officer-sato" ||
    c.id === "officer-takagi" ||
    c.id === "kazuha-toyama" ||
    c.id === "professor-agasa" ||
    c.id === "yusaku-kudo" ||
    c.id === "yukiko-kudo" ||
    c.id === "vodka" ||
    c.id === "jodie-starling" ||
    c.id === "sonoko-suzuki"
  ) {
    return 16
  }
  return Math.min(11 + Math.min(degree * 0.6, 5), 15)
}

/** Deterministic 32-bit string hash — seeds per-node drift so the motion is
 *  stable across renders and identical on every reload (no jitter). */
export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic [0,1) from a seed + salt. */
export function rand01(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  x >>>= 0
  return x / 4294967296
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
