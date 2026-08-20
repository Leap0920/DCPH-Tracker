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

/* Same hue identities as the original palette, harmonised for equal
   perceived weight and lifted out of the muddy range on dark surfaces. */
export const FACTION_THEMES: Record<string, FactionTheme> = {
  "Junior Detective League": {
    primary: "#22D3EE",
    glow: "rgba(34, 211, 238, 0.55)",
    darkFill: "#0B4A5E",
    lightFill: "#CFF6FD",
    border: "#67E8F9",
    badge: "Protagonists",
  },
  "Kudo Family": {
    primary: "#38BDF8",
    glow: "rgba(56, 189, 248, 0.5)",
    darkFill: "#0B4166",
    lightFill: "#D6EEFE",
    border: "#7DD3FC",
    badge: "Kudo Family",
  },
  "Black Organization": {
    primary: "#F43F5E",
    glow: "rgba(244, 63, 94, 0.55)",
    darkFill: "#5C1224",
    lightFill: "#FEE0E6",
    border: "#FB7185",
    badge: "Black Organization",
  },
  "Tokyo Metropolitan Police": {
    primary: "#FBBF24",
    glow: "rgba(251, 191, 36, 0.5)",
    darkFill: "#5A3A08",
    lightFill: "#FEF0CC",
    border: "#FCD34D",
    badge: "Police Department",
  },
  "Osaka Police": {
    primary: "#FB923C",
    glow: "rgba(251, 146, 60, 0.5)",
    darkFill: "#5E2A0C",
    lightFill: "#FEE7CF",
    border: "#FDBA74",
    badge: "Osaka Police",
  },
  FBI: {
    primary: "#A78BFA",
    glow: "rgba(167, 139, 250, 0.5)",
    darkFill: "#3B2378",
    lightFill: "#EAE2FE",
    border: "#C4B5FD",
    badge: "FBI / Security",
  },
  "Public Security Bureau": {
    primary: "#C084FC",
    glow: "rgba(192, 132, 252, 0.5)",
    darkFill: "#4A1D7A",
    lightFill: "#F1E3FE",
    border: "#D8B4FE",
    badge: "Public Security",
  },
  "Osaka / Hattori Household": {
    primary: "#FB923C",
    glow: "rgba(251, 146, 60, 0.5)",
    darkFill: "#6B2E0D",
    lightFill: "#FEE7CF",
    border: "#FDBA74",
    badge: "Osaka Sleuths",
  },
  "Phantom Thief Kid": {
    primary: "#818CF8",
    glow: "rgba(129, 140, 248, 0.5)",
    darkFill: "#282B6E",
    lightFill: "#E2E5FE",
    border: "#A5B4FC",
    badge: "Kaitou Kid",
  },
  "Phantom Thief Cast": {
    primary: "#818CF8",
    glow: "rgba(129, 140, 248, 0.5)",
    darkFill: "#282B6E",
    lightFill: "#E2E5FE",
    border: "#A5B4FC",
    badge: "Magic Kaito",
  },
  "Suzuki Family": {
    primary: "#F472B6",
    glow: "rgba(244, 114, 182, 0.45)",
    darkFill: "#631439",
    lightFill: "#FDE2EF",
    border: "#F9A8D4",
    badge: "Suzuki Family",
  },
  "Mouri Family": {
    primary: "#2DD4BF",
    glow: "rgba(45, 212, 191, 0.45)",
    darkFill: "#0C4B47",
    lightFill: "#CDF6F0",
    border: "#5EEAD4",
    badge: "Mouri Family",
  },
  "Mouri Detective Agency": {
    primary: "#2DD4BF",
    glow: "rgba(45, 212, 191, 0.45)",
    darkFill: "#0C4B47",
    lightFill: "#CDF6F0",
    border: "#5EEAD4",
    badge: "Mouri Agency",
  },
  DEFAULT: {
    primary: "#60A5FA",
    glow: "rgba(96, 165, 250, 0.42)",
    darkFill: "#12365E",
    lightFill: "#DCEAFE",
    border: "#93C5FD",
    badge: "Civilians & Allies",
  },
}

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

/** Resolve an affiliation string to its faction key + theme. */
export function resolveFaction(affiliation: string): {
  key: string
  theme: FactionTheme
} {
  const needle = affiliation.toLowerCase()
  for (const key of FACTION_KEYS) {
    if (key !== "DEFAULT" && needle.includes(key.toLowerCase())) {
      return { key, theme: FACTION_THEMES[key] }
    }
  }
  return { key: "DEFAULT", theme: FACTION_THEMES.DEFAULT }
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
