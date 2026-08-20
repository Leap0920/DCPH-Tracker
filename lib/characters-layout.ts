/**
 * Deterministic layout for the Characters graph.
 *
 * Hand-authored coordinates are authoritative and are never moved. Characters
 * without coordinates are placed on a ring around their faction anchor using a
 * hash of their id (stable across reloads and machines), then pushed apart by a
 * short relaxation pass so no two nodes overlap.
 *
 * This keeps adding a character to a one-line data edit instead of a
 * coordinate-tuning exercise.
 */

export interface LayoutInput {
  id: string
  affiliation: string
  x?: number
  y?: number
  radius?: number
}

export interface LayoutPoint {
  id: string
  x: number
  y: number
}

export const CANVAS = { width: 2600, height: 1900 } as const

/**
 * Cluster anchors on the canvas. Keys are matched case-insensitively as
 * substrings of `affiliation`, longest key first, so "Osaka Police" beats
 * "Police". `FALLBACK` catches everything else.
 */
export const FACTION_ANCHORS: Record<string, { x: number; y: number }> = {
  "black organization": { x: 1180, y: 560 },
  "public security": { x: 1620, y: 760 },
  fbi: { x: 1980, y: 520 },
  cia: { x: 2240, y: 640 },
  "tokyo metropolitan police": { x: 760, y: 1180 },
  "osaka police": { x: 260, y: 1280 },
  "nagano police": { x: 1120, y: 1560 },
  "gunma police": { x: 1400, y: 1620 },
  "shizuoka police": { x: 1640, y: 1480 },
  "kyoto police": { x: 480, y: 1600 },
  police: { x: 980, y: 1420 },
  "detective boys": { x: 300, y: 700 },
  "teitan elementary": { x: 140, y: 880 },
  "teitan high": { x: 520, y: 200 },
  "suzuki": { x: 900, y: 180 },
  "kaito kid": { x: 1500, y: 200 },
  "kid killer": { x: 1700, y: 300 },
  "kudo": { x: 200, y: 120 },
  "mouri": { x: 620, y: 620 },
  "miyano": { x: 1300, y: 380 },
  "haneda": { x: 2100, y: 260 },
  media: { x: 2280, y: 1160 },
  celebrity: { x: 2280, y: 1160 },
  civilian: { x: 1900, y: 1560 },
  FALLBACK: { x: 1300, y: 950 },
}

/** Deterministic 32-bit string hash (FNV-1a). */
function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic float in [0, 1) from a string + salt. */
function rand01(value: string, salt: number): number {
  return hash32(`${value}:${salt}`) / 0x100000000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveAnchor(affiliation: string): { x: number; y: number } {
  const needle = (affiliation ?? "").toLowerCase()
  const keys = Object.keys(FACTION_ANCHORS)
    .filter((key) => key !== "FALLBACK")
    .sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (needle.includes(key)) return FACTION_ANCHORS[key]
  }
  return FACTION_ANCHORS.FALLBACK
}

export interface ResolveLayoutOptions {
  /** Minimum centre-to-centre distance between any two nodes. */
  minDistance?: number
  /** Relaxation iterations. 60 is plenty for ~150 nodes. */
  iterations?: number
  /** Keep nodes this far from the canvas edge. */
  padding?: number
}

/**
 * Produce a final position for every character. Nodes that arrived with
 * coordinates are pinned; the rest are seeded around their faction anchor and
 * relaxed against everything, pinned nodes included.
 */
export function resolveLayout(
  characters: readonly LayoutInput[],
  options: ResolveLayoutOptions = {},
): Map<string, LayoutPoint> {
  const minDistance = options.minDistance ?? 70
  const iterations = options.iterations ?? 60
  const padding = options.padding ?? 50

  interface Node extends LayoutPoint {
    pinned: boolean
    radius: number
  }

  // Seed.
  const nodes: Node[] = characters.map((character, index) => {
    if (typeof character.x === "number" && typeof character.y === "number") {
      return {
        id: character.id,
        x: character.x,
        y: character.y,
        pinned: true,
        radius: character.radius ?? minDistance / 2,
      }
    }

    const anchor = resolveAnchor(character.affiliation)
    // Golden-angle spiral keeps same-faction newcomers from stacking up.
    const step = rand01(character.id, 1)
    const angle = (index * 2.399963229728653) + step * Math.PI * 2
    const ring = 120 + rand01(character.id, 2) * 190

    return {
      id: character.id,
      x: clamp(anchor.x + Math.cos(angle) * ring, padding, CANVAS.width - padding),
      y: clamp(anchor.y + Math.sin(angle) * ring, padding, CANVAS.height - padding),
      pinned: false,
      radius: character.radius ?? minDistance / 2,
    }
  })

  // Relax.
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.pinned && b.pinned) continue

        const target = Math.max(minDistance, a.radius + b.radius + 18)
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)

        if (distance === 0) {
          // Coincident: nudge deterministically instead of randomly.
          dx = (rand01(a.id + b.id, 3) - 0.5) || 0.5
          dy = (rand01(b.id + a.id, 4) - 0.5) || 0.5
          distance = Math.hypot(dx, dy)
        }

        if (distance >= target) continue

        const push = (target - distance) / distance / 2
        const ox = dx * push
        const oy = dy * push

        if (!a.pinned) {
          a.x = clamp(a.x - ox, padding, CANVAS.width - padding)
          a.y = clamp(a.y - oy, padding, CANVAS.height - padding)
        }
        if (!b.pinned) {
          b.x = clamp(b.x + ox, padding, CANVAS.width - padding)
          b.y = clamp(b.y + oy, padding, CANVAS.height - padding)
        }
      }
    }
  }

  const result = new Map<string, LayoutPoint>()
  for (const node of nodes) {
    result.set(node.id, { id: node.id, x: Math.round(node.x), y: Math.round(node.y) })
  }
  return result
}
