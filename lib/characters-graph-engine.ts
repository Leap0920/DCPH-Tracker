/*
  characters-graph-engine — pure data layer for the CharactersWeb remake.

  Everything here is plain functions on plain data (no sigma import, no DOM)
  so vitest can verify the graph model without a browser. The component
  feeds this spec into graphology + sigma inside a client-only effect.

  Shapes:
  - Nodes: authored layout from Character.x/y (deterministic golden-angle
    spiral fallback for the few entries without coordinates).
  - Edges: one graphology edge per Relationship (multi graph). Parallel
    threads (same pair, several types) get alternating `curvature` values
    consumed by @sigma/edge-curve.
  - Colors: delegated to graph-theme.ts so graph, legend and dossier always
    agree in both themes.
*/

import type { Character, Relationship, RelationshipType } from "@/lib/characters-guide";
import {
  LOCKED_EDGE_COLOR,
  LOCKED_THEME,
  clamp,
  getNodeRadius,
  getRelationshipColor,
  hash32,
  resolveFaction,
} from "@/components/characters/graph-theme";

export interface GraphNodeAttrs {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  tier: 0 | 1 | 2;
  factionKey: string;
  locked: boolean;
  /** sigma display overrides (set by the node reducer). */
  forceLabel?: boolean;
}

export interface GraphEdgeAttrs {
  type: "curved";
  relationshipType: RelationshipType;
  color: string;
  size: number;
  curvature: number;
  locked: boolean;
  /** sigma display overrides (set by the edge reducer). */
  hidden?: boolean;
  zIndex?: number;
}

export interface GraphSpec {
  nodes: { key: string; attrs: GraphNodeAttrs }[];
  edges: {
    key: string;
    source: string;
    target: string;
    attrs: GraphEdgeAttrs;
  }[];
}

/* ── tuning shared with the component ─────────────────────────────── */
export const EDGE_WIDTH = 1.5;
/** Curvature for the first thread of a pair; grows per parallel sibling. */
export const BASE_CURVATURE = 0.16;
export const CURVATURE_STEP = 0.16;

/** "#RRGGBB" + alpha (0..1) -> "#RRGGBBAA" (sigma-friendly). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  const a = Math.round(clamp(alpha, 0, 1) * 255);
  return `#${full}${a.toString(16).padStart(2, "0")}`;
}

/** Deterministic fallback position for nodes without authored x/y. */
export function fallbackPosition(
  id: string,
  index: number
): { x: number; y: number } {
  const seed = hash32(id);
  const angle = index * 2.3999632 + (seed % 628) / 100;
  const radius = 240 + ((seed >>> 8) % 620);
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

export function pairKey(r: Pick<Relationship, "source" | "target">): string {
  return [r.source, r.target].sort().join("|");
}

/**
 * Build the full node/edge spec for the graph.
 * Pure: same inputs -> same outputs, no side effects.
 */
export function buildGraphSpec(
  characters: Character[],
  relationships: Relationship[]
): GraphSpec {
  const degree = new Map<string, number>();
  for (const r of relationships) {
    if (!characters.some((c) => c.id === r.source)) continue;
    if (!characters.some((c) => c.id === r.target)) continue;
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }

  const nodes = characters.map((c, index) => {
    const { key: factionKey, theme: fTheme } = resolveFaction(c.affiliation);
    const d = degree.get(c.id) ?? 0;
    const r = getNodeRadius(c, d);
    const locked = Boolean((c as Character & { locked?: boolean }).locked);
    const pos =
      c.x === undefined || c.y === undefined
        ? fallbackPosition(c.id, index)
        : { x: c.x, y: c.y };
    return {
      key: c.id,
      attrs: {
        x: pos.x,
        y: pos.y,
        size: r,
        color: locked ? LOCKED_THEME.stroke : fTheme.primary,
        label: c.name.split("/")[0].trim(),
        tier: (r >= 20 ? 0 : r >= 16 ? 1 : 2) as 0 | 1 | 2,
        factionKey,
        locked,
      },
    };
  });

  const counts = new Map<string, number>();
  const keyOf = (r: Relationship) => pairKey(r);
  for (const r of relationships) {
    if (!nodes.some((n) => n.key === r.source)) continue;
    if (!nodes.some((n) => n.key === r.target)) continue;
    const key = pairKey(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const used = new Map<string, number>();
  const edges: GraphSpec["edges"] = [];
  for (const r of relationships) {
    if (!nodes.some((n) => n.key === r.source)) continue;
    if (!nodes.some((n) => n.key === r.target)) continue;
    const key = pairKey(r);
    const total = counts.get(key) ?? 1;
    const idx = used.get(key) ?? 0;
    used.set(key, idx + 1);
    const off = idx - (total - 1) / 2;
    const locked = Boolean((r as Relationship & { locked?: boolean }).locked);
    edges.push({
      key: r.id,
      source: r.source,
      target: r.target,
      attrs: {
        type: "curved",
        relationshipType: r.type,
        color: locked ? LOCKED_EDGE_COLOR : getRelationshipColor(r.type, true),
        size: EDGE_WIDTH,
        // Signed so parallel threads bow to alternating sides.
        curvature: off === 0 ? 0.16 : (off < 0 ? -1 : 1) * (0.16 + Math.abs(off) * 0.22),
        locked,
      },
    });
  }

  return { nodes, edges };
}
