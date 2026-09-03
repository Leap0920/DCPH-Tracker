"use client";

/*
  CharactersWeb — Obsidian-inspired interactive red-strings graph.

  Camera model
  ------------
  The SVG viewBox is exactly the container's CSS-pixel box (driven by a
  ResizeObserver), so ONE world unit at k=1 is ONE CSS pixel and
  screen -> world is exactly ((sx - cam.x) / k, (sy - cam.y) / k). The old
  `pad` letterbox hack is gone; it made every pan/zoom anchor computation
  wrong on any container taller than 2000x1400.

  Motion model
  ------------
  A single requestAnimationFrame loop owns three things and writes straight
  to the DOM (no React state at 60fps):
    1. camera  — cam glides toward target with exponential smoothing, so
                 queued wheel events accumulate into one continuous zoom
                 instead of stepping. There is NO CSS transition on the
                 world transform.
    2. drift   — each node floats on a sum of two sines seeded from its id.
                 Node transforms AND edge path `d`s are recomputed from the
                 same drifted coordinates each frame, so strings never
                 detach from the circles.
    3. particles — ambient screen-space motes behind the graph.

  React renders structure once; the loop renders every frame. Node
  positions live in a mutable ref, so dragging a node costs zero renders.

  Theming
  -------
  SVG paint values are JS strings, not CSS custom properties — `fill="rgb(var(--x))"`
  does not resolve on a presentation attribute. So the palette below mirrors the
  token hexes from app/globals.css by hand; if a token changes there, change it
  here too. The DOM chrome (search, dock, badge) uses the real tokens.

  `theme` defaults to "dark" because dark is the app default. It must still match
  the `dark` class on <html>, since the container uses token classes (bg-page)
  while the canvas uses this prop — pass the live theme from the parent.
*/

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useReducedMotion } from "framer-motion";
import {
  CHARACTERS,
  RELATIONSHIPS,
  type Character,
  type Relationship,
  type RelationshipType,
} from "@/lib/characters-guide";
import {
  FACTION_THEMES,
  LOCKED_EDGE_COLOR,
  LOCKED_THEME,
  clamp,
  getNodeRadius,
  getRelationshipColor,
  hash32,
  rand01,
  resolveFaction,
  type FactionTheme,
} from "@/components/characters/graph-theme";
import { RotateCcw, Search, Sparkles, Target, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export { FACTION_THEMES, getFactionTheme } from "@/components/characters/graph-theme";

// Hydration-safe isomorphic layout effect: runs synchronously before paint on
// client to eliminate 1-frame position/opacity flashes, falls back to useEffect on SSR.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Hydration-safe matchMedia hook. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/* ── tuning ───────────────────────────────────────────────────────── */
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.35;
const ZOOM_TO_NODE = 1.9;
const FIT_MIN_K = 0.6;
const FIT_MAX_K = 1.6;

/** Camera smoothing time constant (ms). Lower = snappier. */
const CAM_TAU = 85;
/** Inertia applied to the pan target on release (ms of projected travel). */
const PAN_INERTIA_MS = 140;

const DRIFT_AMP = 3.5;
/* ── anti-collision ───────────────────────────────────────────────
 * Circles push each other apart when their radii overlap. The push is
 * stored as a persistent per-node offset that decays back toward the
 * node's home position, so a collision reads as an impact-and-settle
 * rather than a snap. Offsets never touch `base` — drag / fit /
 * zoomToConan keep reading the untouched seeded layout.
 * ---------------------------------------------------------------- */
const COLLIDE_PAD = 2;          // world px of breathing room beyond r_i + r_j — tight packing per user request
const COLLIDE_ITERS = 4;        // Gauss-Seidel relaxation passes per frame
const COLLIDE_STIFF = 0.8;      // fraction of each overlap resolved per pass — snappier settle
const COLLIDE_MAX_OFFSET = 16;  // hard cap on displacement from home (world px) — keep close to authored layout
const COLLIDE_RELAX_TAU = 260;  // ms; how fast a pushed circle drifts back home
const BASE_BOW = 6;
const PARALLEL_GAP = 22;
const STRING_WIDTH = 2;
const DIM_OPACITY = 0.1;
const PARTICLE_COUNT = 30;
/** Idle seconds before the animation loop parks (drift + CSS keyframes stop). */
const IDLE_PARK_MS = 4000;

/* ── stable style objects ──────────────────────────────────────
 * Module-scope so re-rendered edges/nodes never hand React a fresh object
 * identity (which would force a DOM style write) for an unchanged transition. */
const EDGE_STYLE: CSSProperties = {
  transition: "opacity 180ms ease, stroke-width 180ms ease",
};
const EDGE_STYLE_HIDDEN: CSSProperties = {
  transition: "opacity 180ms ease, stroke-width 180ms ease",
  display: "none",
};

/* ── canvas palette (mirrors the CSS tokens; see header note) ────── */
const CANVAS = {
  dark: {
    bg0: "#0A0A0A",                       // --surface, gradient core
    bg1: "#000000",                       // --page, gradient falloff
    dot: "rgba(161,161,161,0.12)",        // --ink-dim at low alpha
    label: "#EDEDED",                     // --ink
    labelStrong: "#FFFFFF",
    labelHalo: "#000000",                 // --page
    strokeStrong: "#FFFFFF",
    particle: "#A1A1A1",                  // --ink-dim
    dotRadius: 1.1,
    stringActive: 0.75,
    stringIdle: 0.26,
  },
  light: {
    bg0: "#FFFFFF",
    bg1: "#E7ECF3",
    dot: "rgba(100,116,139,0.34)",
    label: "#171717",
    labelStrong: "#0A0A0A",
    labelHalo: "#FFFFFF",
    strokeStrong: "#171717",
    particle: "#64748B",
    dotRadius: 1.3,
    stringActive: 0.62,
    stringIdle: 0.18,
  },
} as const;

/* ── geometry helpers ─────────────────────────────────────────────── */

function quadPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  offsetIndex: number
): string {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const arc = BASE_BOW + offsetIndex * PARALLEL_GAP;
  const cx = mx + (-dy / len) * arc;
  const cy = my + (dx / len) * arc;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(
    1
  )} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The rectangle of the viewport that is actually free of floating chrome.
 * Fit and center math targets THIS, not the raw container — which is why the
 * mobile bottom sheet and the desktop dossier no longer bury the graph.
 */
function usableRect(
  w: number,
  h: number,
  isMobile: boolean,
  panelOpen: boolean
): Rect {
  const top = 100; // search + filter control column
  const left = isMobile ? 16 : 28;
  const right = panelOpen && !isMobile ? 416 : isMobile ? 16 : 28;
  const bottom = panelOpen && isMobile ? Math.round(h * 0.48) + 20 : 92;
  return {
    x: left,
    y: top,
    w: Math.max(140, w - left - right),
    h: Math.max(140, h - top - bottom),
  };
}

function labelOpacityFor(k: number, tier: 0 | 1 | 2): number {
  if (tier === 0) return 1;
  if (tier === 1) return clamp(k / 0.55, 0.75, 1);
  return clamp((k - 0.35) / 0.25, 0, 1);
}

/* ── per-node / per-edge specs ────────────────────────────────────── */

type NodeSpec = {
  c: Character;
  r: number;
  tier: 0 | 1 | 2;
  factionKey: string;
  theme: FactionTheme;
  degree: number;
  /** Hoisted at build time so the render loop never re-casts Character. */
  locked: boolean;
  f1: number;
  f2: number;
  f3: number;
  f4: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  breatheDur: number;
  breatheDelay: number;
};

type EdgeSpec = {
  rel: Relationship;
  s: number;
  t: number;
  off: number;
  /** Static paint hoisted out of render — resolved once per graph build. */
  locked: boolean;
  color: string;
  dash: string | undefined;
};

type Particle = {
  x0: number;
  y0: number;
  r: number;
  base: number;
  vy: number;
  fx: number;
  px: number;
  fo: number;
  po: number;
};

function pairKey(r: Relationship): string {
  return [r.source, r.target].sort().join("|");
}

export interface CharactersWebProps {
  characters?: Character[];
  relationships?: Relationship[];
  onSelectCharacter: (character: Character | null) => void;
  selectedCharacterId?: string | null;
  activeFilter?: RelationshipType | null;
  /** Rendered inside the top-left control column, below the search field. */
  topLeftSlot?: React.ReactNode;
  theme?: "light" | "dark";
  className?: string;
}

/* ── memoized leaf components ────────────────────────────────────
 * The graph lives in one stateful parent; every hover, search keystroke,
 * selection and (debounced) resize used to reconcile the ENTIRE SVG tree
 * (~95 nodes × 12 elements + 153 paths). These leaves isolate that churn:
 * memo() bails out every node/edge whose live props did not change, so a
 * hover flips exactly two NodeViews and the strings whose dim state is real.
 *
 * All paints that never change (faction glow URL, locked flag, edge color /
 * dash) are hoisted into NodeSpec / EdgeSpec at graph-build time; only the
 * few genuinely live values arrive as props here.
 * ---------------------------------------------------------------- */

type NodeViewProps = {
  n: NodeSpec;
  i: number;
  isDark: boolean;
  pal: (typeof CANVAS)[keyof typeof CANVAS];
  isSelected: boolean;
  isHovered: boolean;
  isSearchMatch: boolean;
  nodeEls: { current: (SVGGElement | null)[] };
  labelEls: { current: (SVGGElement | null)[] };
  grabbingRef: { current: boolean };
  didDragRef: { current: boolean };
  onSelectNode: (index: number) => void;
  onNodePointerDown: (index: number, e: ReactPointerEvent) => void;
  onHoverChange: (id: string | null) => void;
};

/**
 * One character node. The ROOT <g> is the element the rAF loop repositions
 * through nodeEls (transform is DOM-owned, never a React prop), so this root
 * also carries the interactive chrome — role, focus, hover and pointer
 * handlers that previously lived on two redundant wrapper <g>s. Everything
 * inside is laid out at (0, 0); the label <g> carries its own translate.
 */
const NodeView = memo(function NodeView({
  n,
  i,
  isDark,
  pal,
  isSelected,
  isHovered,
  isSearchMatch,
  nodeEls,
  labelEls,
  grabbingRef,
  didDragRef,
  onSelectNode,
  onNodePointerDown,
  onHoverChange,
}: NodeViewProps) {
  const isConan = n.c.id === "conan-edogawa";
  const emphasised = isSelected || isHovered;

  return (
    <g
      ref={(el) => {
        nodeEls.current[i] = el;
      }}
      role="button"
      tabIndex={0}
      aria-label={`${n.c.name}, ${n.c.role}, ${n.degree} relationships`}
      className="group cursor-pointer outline-none"
      onPointerDown={(e) => onNodePointerDown(i, e)}
      onClick={() => {
        if (didDragRef.current) {
          didDragRef.current = false;
          return;
        }
        onSelectNode(i);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectNode(i);
        }
      }}
      onMouseEnter={() => {
        if (!grabbingRef.current) onHoverChange(n.c.id);
      }}
      onMouseLeave={() => {
        if (!grabbingRef.current) onHoverChange(null);
      }}
      onFocus={() => onHoverChange(n.c.id)}
      onBlur={() => onHoverChange(null)}
    >
      {isConan && (
        <circle
          key="conan-ripple"
          className="dcph-ripple"
          r={n.r + 12}
          fill="none"
          stroke={n.theme.primary}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}

      {/* Breathing ring — pure opacity keyframes, zero layout overhead */}
      <circle
        key="breathe-ring"
        className="dcph-breathe"
        r={n.r + 3}
        fill="none"
        stroke={n.theme.border}
        strokeWidth={1}
        pointerEvents="none"
        style={
          {
            "--dcph-dur": `${n.breatheDur}s`,
            "--dcph-delay": `${n.breatheDelay}s`,
          } as CSSProperties
        }
      />

      {/* State ring — the hover + selection/search highlight merged into one
          element. Selected/search nodes pin opacity via inline style (inline
          beats the utility class); otherwise the ring fades in on CSS
          :hover, so plain hover costs zero React re-renders of this node. */}
      <circle
        key="state-ring"
        r={n.r + 7}
        fill="none"
        stroke={isSelected ? pal.strokeStrong : n.theme.border}
        strokeWidth={2}
        className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={isSelected || isSearchMatch ? { opacity: 1 } : undefined}
        pointerEvents="none"
      />

      {/* Main node circle */}
      <circle
        key="node-body"
        r={n.r}
        fill={
          isSelected
            ? n.theme.primary
            : isDark
              ? n.theme.darkFill
              : n.theme.lightFill
        }
        stroke={emphasised ? pal.strokeStrong : n.theme.border}
        strokeWidth={isConan ? 3.5 : isSelected ? 3 : 2}
        opacity={1}
        className="transition-[fill,stroke] duration-200"
      />

      {/* Center core dot */}
      <circle
        key="node-core"
        r={isConan ? 6 : n.r > 16 ? 4.5 : 3.5}
        fill={emphasised ? pal.strokeStrong : n.theme.primary}
        pointerEvents="none"
      />

      {/* Label — stable key and ref, never unmounted */}
      <g
        key="node-label"
        ref={(el) => {
          labelEls.current[i] = el;
        }}
        transform={`translate(0, ${n.r + 15})`}
        pointerEvents="none"
      >
        <text
          textAnchor="middle"
          className={cn(
            "select-none font-display tracking-tight",
            isConan
              ? "text-[14px] font-extrabold"
              : n.r > 16
                ? "text-[13px] font-bold"
                : "text-[12px] font-semibold"
          )}
          style={{
            fill: emphasised ? pal.labelStrong : pal.label,
            paintOrder: "stroke",
            stroke: pal.labelHalo,
            strokeWidth: 3,
            strokeLinejoin: "round",
            vectorEffect: "non-scaling-stroke",
          }}
        >
          {n.c.name.split("/")[0].trim()}
        </text>
      </g>
    </g>
  );
});

/**
 * One relationship string. Static paint (color, locked dash, fill mode) is
 * hoisted into EdgeSpec at graph-build time; only display/dim state arrives
 * as live props. `d` is owned by the rAF loop — never a React prop.
 */
const EdgeView = memo(function EdgeView({
  e,
  i,
  edgeEls,
  hidden,
  isTarget,
  opacity,
}: {
  e: EdgeSpec;
  i: number;
  edgeEls: { current: (SVGPathElement | null)[] };
  hidden: boolean;
  isTarget: boolean;
  opacity: number;
}) {
  return (
    <path
      ref={(el) => {
        edgeEls.current[i] = el;
      }}
      fill="none"
      stroke={e.color}
      strokeWidth={isTarget ? STRING_WIDTH + 1.8 : STRING_WIDTH}
      strokeLinecap="round"
      strokeDasharray={e.dash}
      opacity={opacity}
      style={hidden ? EDGE_STYLE_HIDDEN : EDGE_STYLE}
    />
  );
});

export default function CharactersWeb({
  characters = CHARACTERS,
  relationships = RELATIONSHIPS,
  onSelectCharacter,
  selectedCharacterId,
  activeFilter,
  topLeftSlot,
  // Dark is the app default (see app/layout.tsx), so it is the default here too.
  theme = "dark",
  className = "",
}: CharactersWebProps) {
  const reduce = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isDark = theme === "dark";

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  /* ── refs the rAF loop reads ───────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const targetRef = useRef({ x: 0, y: 0, k: 1 });
  const minZoomRef = useRef(FIT_MIN_K);
  const sizeRef = useRef({ w: 0, h: 0 });
  const isMobileRef = useRef(isMobile);
  const panelOpenRef = useRef(Boolean(selectedCharacterId));
  const reduceRef = useRef(Boolean(reduce));
  const userAdjustedRef = useRef(false);
  const didFitRef = useRef(false);
  const forcedLabelsRef = useRef<Set<number>>(new Set());
  const labelsDirtyRef = useRef(true);
  const isGrabbingRef = useRef(false);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);
  useEffect(() => {
    panelOpenRef.current = Boolean(selectedCharacterId);
  }, [selectedCharacterId]);
  useEffect(() => {
    reduceRef.current = Boolean(reduce);
  }, [reduce]);

  /* ── derived graph model ───────────────────────────────────────── */

  const { nodes, edges, indexById } = useMemo(() => {
    const indexById = new Map<string, number>();
    characters.forEach((c, i) => indexById.set(c.id, i));

    const degree = new Map<string, number>();
    for (const r of relationships) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
    }

    const nodes: NodeSpec[] = characters.map((c) => {
      const seed = hash32(c.id);
      const d = degree.get(c.id) ?? 0;
      const r = getNodeRadius(c, d);
      // Destructured (not spread) so the faction key lands on `factionKey` —
      // resolveFaction returns it as `key`, which collides conceptually with
      // React's reserved prop name and does not match NodeSpec.
      const { key: factionKey, theme } = resolveFaction(c.affiliation);
      return {
        c,
        r,
        tier: r >= 20 ? 0 : r >= 16 ? 1 : 2,
        factionKey,
        theme,
        degree: d,
        locked: false,
        // Periods land between ~12s and ~30s — slow enough to read as "alive",
        // never fast enough to look like a physics simulation.
        f1: 0.00021 + rand01(seed, 1) * 0.00028,
        f2: 0.00033 + rand01(seed, 2) * 0.00035,
        f3: 0.00019 + rand01(seed, 3) * 0.00027,
        f4: 0.00036 + rand01(seed, 4) * 0.00032,
        p1: rand01(seed, 5) * Math.PI * 2,
        p2: rand01(seed, 6) * Math.PI * 2,
        p3: rand01(seed, 7) * Math.PI * 2,
        p4: rand01(seed, 8) * Math.PI * 2,
        breatheDur: 3.2 + rand01(seed, 9) * 2.4,
        breatheDelay: rand01(seed, 10) * 3,
      };
    });

    const counts = new Map<string, number>();
    for (const r of relationships) {
      const key = pairKey(r);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const used = new Map<string, number>();
    const edges: EdgeSpec[] = [];
    for (const r of relationships) {
      const s = indexById.get(r.source);
      const t = indexById.get(r.target);
      if (s === undefined || t === undefined) continue;
      const key = pairKey(r);
      const total = counts.get(key) ?? 1;
      const idx = used.get(key) ?? 0;
      used.set(key, idx + 1);
      edges.push({
        rel: r,
        s,
        t,
        off: idx - (total - 1) / 2,
        locked: false,
        color: getRelationshipColor(r.type, isDark),
        dash: undefined,
      });
    }

    return { nodes, edges, indexById };
  }, [characters, relationships, isDark]);

  /** Base (authored, drag-mutated) positions + per-frame drifted positions. */
  const geom = useMemo(() => {
    const n = nodes.length;
    const base = new Float64Array(n * 2);
    const curX = new Float64Array(n);
    const curY = new Float64Array(n);
    nodes.forEach((node, i) => {
      const x = node.c.x ?? 0;
      const y = node.c.y ?? 0;
      base[i * 2] = x;
      base[i * 2 + 1] = y;
      curX[i] = x;
      curY[i] = y;
    });
    return { base, curX, curY };
  }, [nodes]);

  /** Content bounding box, inflated for label boxes and drift headroom. */
  const bbox = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const halfLabel = Math.max(n.r + 8, 48);
      const cx = n.c.x ?? 0;
      const cy = n.c.y ?? 0;
      minX = Math.min(minX, cx - halfLabel);
      maxX = Math.max(maxX, cx + halfLabel);
      minY = Math.min(minY, cy - n.r - 12);
      maxY = Math.max(maxY, cy + n.r + 30);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { minX: -500, minY: -500, w: 1000, h: 1000 };
    }
    const m = DRIFT_AMP + 6;
    return {
      minX: minX - m,
      minY: minY - m,
      w: maxX - minX + m * 2,
      h: maxY - minY + m * 2,
    };
  }, [nodes]);

  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      out.push({
        x0: rand01(9176, i * 4 + 1),
        y0: rand01(9176, i * 4 + 2),
        r: 0.9 + rand01(9176, i * 4 + 3) * 1.7,
        base: 0.14 + rand01(9176, i * 4 + 4) * 0.24,
        vy: 0.000006 + rand01(4471, i) * 0.000016,
        fx: 0.00012 + rand01(4471, i + 99) * 0.0003,
        px: rand01(4471, i + 7) * Math.PI * 2,
        fo: 0.0004 + rand01(4471, i + 31) * 0.0008,
        po: rand01(4471, i + 53) * Math.PI * 2,
      });
    }
    return out;
  }, []);

  /* ── element refs ──────────────────────────────────────────────── */
  const nodeEls = useRef<(SVGGElement | null)[]>([]);
  const labelEls = useRef<(SVGGElement | null)[]>([]);
  const edgeEls = useRef<(SVGPathElement | null)[]>([]);
  const particleEls = useRef<(SVGCircleElement | null)[]>([]);

  /* ── search / highlight ────────────────────────────────────────── */
  const searchLower = searchQuery.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!searchLower) return new Set<string>();
    const set = new Set<string>();
    for (const c of characters) {
      if (
        c.name.toLowerCase().includes(searchLower) ||
        c.role.toLowerCase().includes(searchLower) ||
        c.affiliation.toLowerCase().includes(searchLower) ||
        c.aliases?.some((a) => a.toLowerCase().includes(searchLower))
      ) {
        set.add(c.id);
      }
    }
    return set;
  }, [searchLower, characters]);

  const updateLabelOpacities = useCallback(
    (k: number) => {
      const forced = forcedLabelsRef.current;
      for (let i = 0; i < nodes.length; i++) {
        const el = labelEls.current[i];
        if (!el) continue;
        const o = forced.has(i) ? 1 : labelOpacityFor(k, nodes[i].tier);
        el.style.opacity = o.toFixed(2);
      }
    },
    [nodes]
  );

  // Labels that must stay fully legible regardless of zoom.
  useEffect(() => {
    const forced = new Set<number>();
    const add = (id?: string | null) => {
      if (!id) return;
      const i = indexById.get(id);
      if (i !== undefined) forced.add(i);
    };
    add(hoveredId);
    add(selectedCharacterId ?? null);
    searchMatches.forEach(add);
    forcedLabelsRef.current = forced;
    labelsDirtyRef.current = true;
    updateLabelOpacities(camRef.current.k || 1);
  }, [hoveredId, selectedCharacterId, searchMatches, indexById, updateLabelOpacities]);

  /* ── camera commands ──────────────────────────────────────────── */

  const fitToContent = useCallback(
    (instant = false) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const vp = usableRect(w, h, isMobileRef.current, panelOpenRef.current);
      const minFit = isMobileRef.current ? 0.75 : 0.6;
      const k = clamp(
        Math.min(vp.w / bbox.w, vp.h / bbox.h),
        minFit,
        FIT_MAX_K
      );
      minZoomRef.current = FIT_MIN_K;
      const next = {
        k,
        x: vp.x + (vp.w - bbox.w * k) / 2 - bbox.minX * k,
        y: vp.y + (vp.h - bbox.h * k) / 2 - bbox.minY * k,
      };
      targetRef.current = next;
      if (instant || reduceRef.current) camRef.current = { ...next };
      userAdjustedRef.current = false;
    },
    [bbox]
  );

  const zoomToPoint = useCallback(
    (
      wx: number,
      wy: number,
      k = ZOOM_TO_NODE,
      panelOpen?: boolean,
      instant = false
    ) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const vp = usableRect(
        w,
        h,
        isMobileRef.current,
        panelOpen ?? panelOpenRef.current
      );
      const kk = clamp(k, minZoomRef.current, MAX_ZOOM);
      const next = {
        k: kk,
        x: vp.x + vp.w / 2 - wx * kk,
        y: vp.y + vp.h / 2 - wy * kk,
      };
      targetRef.current = next;
      if (instant || reduceRef.current) camRef.current = { ...next };
      userAdjustedRef.current = !instant;
    },
    []
  );

  const zoomBy = useCallback((factor: number) => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const vp = usableRect(w, h, isMobileRef.current, panelOpenRef.current);
    const t = targetRef.current;
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    const nk = clamp(t.k * factor, minZoomRef.current, MAX_ZOOM);
    if (nk === t.k) return;
    targetRef.current = {
      k: nk,
      x: cx - ((cx - t.x) * nk) / t.k,
      y: cy - ((cy - t.y) * nk) / t.k,
    };
    if (reduceRef.current) camRef.current = { ...targetRef.current };
    userAdjustedRef.current = true;
  }, []);

  const centerOnConan = useCallback(
    (instant = false) => {
      const i = indexById.get("conan-edogawa");
      if (i === undefined) {
        fitToContent(instant);
        return;
      }
      const wx = geom.curX[i] || geom.base[i * 2];
      const wy = geom.curY[i] || geom.base[i * 2 + 1];
      const k = isMobileRef.current ? 1.05 : 1.35;
      zoomToPoint(wx, wy, k, undefined, instant);
      if (instant) {
        userAdjustedRef.current = false;
      }
    },
    [indexById, geom, zoomToPoint, fitToContent]
  );

  /* ── synchronous node / edge / label layout setup ─────────────── */
  useIsoLayoutEffect(() => {
    nodeEls.current.length = nodes.length;
    labelEls.current.length = nodes.length;
    edgeEls.current.length = edges.length;

    const forced = forcedLabelsRef.current;
    const currentK = camRef.current.k || 1;
    for (let i = 0; i < nodes.length; i++) {
      const g = nodeEls.current[i];
      if (g) {
        g.setAttribute(
          "transform",
          `translate(${geom.curX[i].toFixed(2)} ${geom.curY[i].toFixed(2)})`
        );
      }
      const lbl = labelEls.current[i];
      if (lbl) {
        const o = forced.has(i) ? 1 : labelOpacityFor(currentK, nodes[i].tier);
        lbl.style.opacity = o.toFixed(2);
      }
    }
    for (let i = 0; i < edges.length; i++) {
      const el = edgeEls.current[i];
      if (el) {
        const e = edges[i];
        el.setAttribute(
          "d",
          quadPath(geom.curX[e.s], geom.curY[e.s], geom.curX[e.t], geom.curY[e.t], e.off)
        );
      }
    }
  }, [nodes, edges, geom]);

  /* ── size observation + initial fit ───────────────────────────── */
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    /* Size commits are debounced: a window drag fires ResizeObserver on every
       tick, and each setSize re-renders the whole SVG (~250 nodes × ~8 elements).
       sizeRef is updated immediately so the rAF loop and fit math stay live; the
       React state commits at most once per frame PLUS once ~120ms after the last
       tick, so a resize burst costs ~2 renders instead of one per tick. */
    let sizeRaf = 0;
    let sizeTimer = 0;
    const commitSize = () => {
      sizeRaf = 0;
      const { w: curW, h: curH } = sizeRef.current;
      setSize((prev) => (prev.w === curW && prev.h === curH ? prev : { w: curW, h: curH }));
    };

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr || cr.width < 1 || cr.height < 1) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      if (!sizeRaf) sizeRaf = requestAnimationFrame(commitSize);
      if (sizeTimer) window.clearTimeout(sizeTimer);
      sizeTimer = window.setTimeout(commitSize, 120);
      if (!didFitRef.current) {
        didFitRef.current = true;
        centerOnConan(true);
        setReady(true);
      } else if (!userAdjustedRef.current) {
        centerOnConan();
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (sizeRaf) cancelAnimationFrame(sizeRaf);
      if (sizeTimer) window.clearTimeout(sizeTimer);
    };
  }, [centerOnConan]);

  /* ── the single animation loop ────────────────────────────────── */
  useEffect(() => {
    let raf = 0;
    let t0 = performance.now();
    let last = t0;
    let lastLabelK = -1;
    let lastZoomLabel = -1;
    let lastCamX = -99999;
    let lastCamY = -99999;
    let lastCamK = -99999;

    const N = nodes.length;
    const E = edges.length;

    /* Persistent separation offsets + the frame's drifted home positions.
       Recreated whenever the effect re-runs (i.e. when `nodes` changes),
       so they can never outlive the layout they describe. */
    const offX = new Float64Array(N);
    const offY = new Float64Array(N);
    const homeX = new Float64Array(N);
    const homeY = new Float64Array(N);
    const lastNodeRenderX = new Float64Array(N).fill(-99999);
    const lastNodeRenderY = new Float64Array(N).fill(-99999);
    const lastEdgeSX = new Float64Array(E).fill(-99999);
    const lastEdgeSY = new Float64Array(E).fill(-99999);
    const lastEdgeTX = new Float64Array(E).fill(-99999);
    const lastEdgeTY = new Float64Array(E).fill(-99999);

    let hasActiveOffsets = false;
    let frameCount = 0;

    const loop = (now: number) => {
      if (parked) return;
      raf = requestAnimationFrame(loop);
      frameCount++;
      const dt = Math.min(50, now - last);
      last = now;
      const t = now - t0;

      /* 1 — camera */
      const cam = camRef.current;
      const tgt = targetRef.current;
      const a = reduceRef.current ? 1 : 1 - Math.exp(-dt / CAM_TAU);
      cam.x += (tgt.x - cam.x) * a;
      cam.y += (tgt.y - cam.y) * a;
      cam.k += (tgt.k - cam.k) * a;
      if (Math.abs(tgt.x - cam.x) < 0.04) cam.x = tgt.x;
      if (Math.abs(tgt.y - cam.y) < 0.04) cam.y = tgt.y;
      if (Math.abs(tgt.k - cam.k) < 0.0004) cam.k = tgt.k;

      if (
        Math.abs(cam.x - lastCamX) > 0.01 ||
        Math.abs(cam.y - lastCamY) > 0.01 ||
        Math.abs(cam.k - lastCamK) > 0.0002
      ) {
        lastCamX = cam.x;
        lastCamY = cam.y;
        lastCamK = cam.k;
        worldRef.current?.setAttribute(
          "transform",
          `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.k.toFixed(4)})`
        );
      }

      /* 2 — node drift + anti-collision (positions feed BOTH nodes and strings) */
      const amp = reduceRef.current ? 0 : DRIFT_AMP;
      const { base, curX, curY } = geom;
      const dragIdx = dragNodeRef.current?.index ?? -1;

      /* 2a — drifted home positions, plus separation offsets */
      const decay = Math.exp(-dt / COLLIDE_RELAX_TAU);
      let maxOffsetSq = 0;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        let x = base[i * 2];
        let y = base[i * 2 + 1];
        if (amp > 0 && i !== dragIdx) {
          x +=
            Math.sin(t * n.f1 + n.p1) * amp +
            Math.sin(t * n.f2 + n.p2) * amp * 0.45;
          y +=
            Math.cos(t * n.f3 + n.p3) * amp * 0.9 +
            Math.cos(t * n.f4 + n.p4) * amp * 0.4;
        }
        homeX[i] = x;
        homeY[i] = y;

        if (i === dragIdx) {
          offX[i] = 0;
          offY[i] = 0;
        } else if (hasActiveOffsets) {
          offX[i] *= decay;
          offY[i] *= decay;
          const magSq = offX[i] * offX[i] + offY[i] * offY[i];
          if (magSq > maxOffsetSq) maxOffsetSq = magSq;
        }
        curX[i] = x + offX[i];
        curY[i] = y + offY[i];
      }

      if (dragIdx !== -1) {
        hasActiveOffsets = true;
      } else if (hasActiveOffsets && maxOffsetSq < 0.005) {
        hasActiveOffsets = false;
        offX.fill(0);
        offY.fill(0);
      }

      /* 2b — pairwise separation (only run Gauss-Seidel when dragging or settling) */
      if (dragIdx !== -1 || hasActiveOffsets) {
        for (let iter = 0; iter < COLLIDE_ITERS; iter++) {
          for (let i = 0; i < N; i++) {
            const ri = nodes[i].r;
            const iFixed = i === dragIdx;
            let xi = curX[i];
            let yi = curY[i];

            for (let j = i + 1; j < N; j++) {
              const min = ri + nodes[j].r + COLLIDE_PAD;
              let dx = curX[j] - xi;
              let dy = curY[j] - yi;
              const d2 = dx * dx + dy * dy;
              if (d2 >= min * min) continue; // not touching

              let d = Math.sqrt(d2);
              if (d < 1e-4) {
                const ang = i * 2.3999632 + j * 0.7853982;
                dx = Math.cos(ang);
                dy = Math.sin(ang);
                d = 1e-4;
              } else {
                dx /= d;
                dy /= d;
              }

              const push = (min - d) * COLLIDE_STIFF;
              const jFixed = j === dragIdx;
              const si = iFixed ? 0 : jFixed ? 1 : 0.5;
              const sj = jFixed ? 0 : iFixed ? 1 : 0.5;

              if (si > 0) {
                const px = dx * push * si;
                const py = dy * push * si;
                xi -= px;
                yi -= py;
                offX[i] -= px;
                offY[i] -= py;
              }
              if (sj > 0) {
                const px = dx * push * sj;
                const py = dy * push * sj;
                curX[j] += px;
                curY[j] += py;
                offX[j] += px;
                offY[j] += py;
              }
            }

            curX[i] = xi;
            curY[i] = yi;
          }
        }

        /* 2c — cap total displacement */
        for (let i = 0; i < N; i++) {
          if (i === dragIdx) continue;
          const ox = offX[i];
          const oy = offY[i];
          const m2 = ox * ox + oy * oy;
          if (m2 > COLLIDE_MAX_OFFSET * COLLIDE_MAX_OFFSET) {
            const s = COLLIDE_MAX_OFFSET / Math.sqrt(m2);
            offX[i] = ox * s;
            offY[i] = oy * s;
            curX[i] = homeX[i] + offX[i];
            curY[i] = homeY[i] + offY[i];
          }
        }
      }

      /* 2d — commit the corrected positions to the DOM */
      for (let i = 0; i < N; i++) {
        const x = curX[i];
        const y = curY[i];
        if (
          Math.abs(x - lastNodeRenderX[i]) > 0.04 ||
          Math.abs(y - lastNodeRenderY[i]) > 0.04
        ) {
          lastNodeRenderX[i] = x;
          lastNodeRenderY[i] = y;
          const g = nodeEls.current[i];
          if (g) {
            g.setAttribute(
              "transform",
              `translate(${x.toFixed(2)} ${y.toFixed(2)})`
            );
          }
        }
      }

      /* 3 — strings follow the same drifted coordinates.
         Update cadence: edge `d` strings are recomputed at HALF cadence when the
         graph is idle and at FULL cadence only while a node is being dragged.
         Drift is sub-pixel per frame (≤3.5px over 12–30s periods) and pan/zoom
         only rewrites the world <g> transform — world-space endpoints never move
         from the camera — so 30fps path updates are visually identical to 60fps.
         Edges whose endpoints are both off-screen are skipped entirely; their `d`
         is recomputed when the camera brings them back into view. */
      const edgeEveryFrame = dragIdx !== -1;
      if (edgeEveryFrame || frameCount % 2 === 0) {
        const { w: vwPx, h: vhPx } = sizeRef.current;
        const cull = vwPx > 0 && vhPx > 0 && cam.k > 0;
        const cullMargin = COLLIDE_MAX_OFFSET + 64;
        const minWX = cull ? 0 - cam.x / cam.k - cullMargin : -Infinity;
        const minWY = cull ? 0 - cam.y / cam.k - cullMargin : -Infinity;
        const maxWX = cull ? (vwPx - cam.x) / cam.k + cullMargin : Infinity;
        const maxWY = cull ? (vhPx - cam.y) / cam.k + cullMargin : Infinity;

        for (let i = 0; i < E; i++) {
          const el = edgeEls.current[i];
          if (!el || el.style.display === "none") continue;
          const e = edges[i];
          const sx = curX[e.s];
          const sy = curY[e.s];
          const tx = curX[e.t];
          const ty = curY[e.t];
          if (cull) {
            const sIn = sx >= minWX && sx <= maxWX && sy >= minWY && sy <= maxWY;
            const tIn = tx >= minWX && tx <= maxWX && ty >= minWY && ty <= maxWY;
            if (!sIn && !tIn) continue;
          }
          if (
            Math.abs(sx - lastEdgeSX[i]) > 0.04 ||
            Math.abs(sy - lastEdgeSY[i]) > 0.04 ||
            Math.abs(tx - lastEdgeTX[i]) > 0.04 ||
            Math.abs(ty - lastEdgeTY[i]) > 0.04
          ) {
            lastEdgeSX[i] = sx;
            lastEdgeSY[i] = sy;
            lastEdgeTX[i] = tx;
            lastEdgeTY[i] = ty;
            el.setAttribute("d", quadPath(sx, sy, tx, ty, e.off));
          }
        }
      }

      /* 4 — zoom-dependent label opacity */
      if (labelsDirtyRef.current || Math.abs(cam.k - lastLabelK) > 0.003) {
        labelsDirtyRef.current = false;
        lastLabelK = cam.k;
        const forced = forcedLabelsRef.current;
        for (let i = 0; i < N; i++) {
          const el = labelEls.current[i];
          if (!el) continue;
          const o = forced.has(i) ? 1 : labelOpacityFor(cam.k, nodes[i].tier);
          el.style.opacity = o.toFixed(2);
        }
      }

      /* 5 — ambient particles (screen space, behind the world — throttled to every 2nd frame) */
      if (!reduceRef.current && frameCount % 2 === 0) {
        const { w, h } = sizeRef.current;
        if (w && h) {
          for (let i = 0; i < particles.length; i++) {
            const el = particleEls.current[i];
            if (!el) continue;
            const p = particles[i];
            const nx = p.x0 + Math.sin(t * p.fx + p.px) * 0.035;
            let ny = (p.y0 - t * p.vy) % 1;
            if (ny < 0) ny += 1;
            el.setAttribute(
              "transform",
              `translate(${(nx * w).toFixed(1)} ${(ny * h).toFixed(1)})`
            );
            el.setAttribute(
              "opacity",
              (p.base * (0.55 + 0.45 * Math.sin(t * p.fo + p.po))).toFixed(3)
            );
          }
        }
      }

      /* 6 — zoom readout */
      const pct = Math.round(cam.k * 100);
      if (pct !== lastZoomLabel && zoomLabelRef.current) {
        lastZoomLabel = pct;
        zoomLabelRef.current.textContent = `${pct}%`;
      }
    };

    /* ── idle / hidden-tab park ────────────────────────────────────
       The loop animates drift forever at 60fps even while the user is just
       reading the graph. After IDLE_PARK_MS with no interaction — and while
       the tab is hidden — the loop is cancelled and the CSS keyframes are
       paused via a `dcph-parked` class on the container, so the canvas goes
       fully still and CPU drops to ~0. Any pointer/wheel/touch/key activity
       (or returning to the tab) unparks instantly; nothing re-renders. */
    let parked = false;
    let idleTimer = 0;

    const container = containerRef.current;

    const tryPark = () => {
      if (parked) return;
      // Never park mid-gesture (node drag / pan inertia / pinch)…
      if (dragNodeRef.current || pinchRef.current || panRef.current) return;
      // …or while the camera is still gliding to its target.
      const cam = camRef.current;
      const tgt = targetRef.current;
      if (
        Math.abs(tgt.x - cam.x) > 0.05 ||
        Math.abs(tgt.y - cam.y) > 0.05 ||
        Math.abs(tgt.k - cam.k) > 0.0005
      )
        return;
      parked = true;
      container?.classList.add("dcph-parked");
      cancelAnimationFrame(raf);
    };

    const unpark = () => {
      if (!parked) return;
      parked = false;
      container?.classList.remove("dcph-parked");
      // Re-baseline the clock so drift resumes from where it parked (a
      // ≤DRIFT_AMP px phase step — invisible in practice).
      t0 = performance.now();
      last = t0;
      raf = requestAnimationFrame(loop);
    };

    const poke = () => {
      unpark();
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(tryPark, IDLE_PARK_MS);
    };

    const onVisibility = () => {
      if (document.hidden) {
        tryPark();
      } else {
        poke();
      }
    };

    window.addEventListener("pointerdown", poke);
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerup", poke);
    window.addEventListener("pointercancel", poke);
    window.addEventListener("wheel", poke, { passive: true });
    window.addEventListener("touchstart", poke, { passive: true });
    window.addEventListener("keydown", poke);
    document.addEventListener("visibilitychange", onVisibility);

    idleTimer = window.setTimeout(tryPark, IDLE_PARK_MS);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerup", poke);
      window.removeEventListener("pointercancel", poke);
      window.removeEventListener("wheel", poke);
      window.removeEventListener("touchstart", poke);
      window.removeEventListener("keydown", poke);
      document.removeEventListener("visibilitychange", onVisibility);
      container?.classList.remove("dcph-parked");
    };
  }, [nodes, edges, geom, particles]);

  /* ── pointer gestures: pan, node drag, pinch ─────────────────── */

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const rectRef = useRef<DOMRect | null>(null);
  const didDragRef = useRef(false);
  const panRef = useRef<{
    cx: number;
    cy: number;
    vx: number;
    vy: number;
    lastT: number;
  } | null>(null);
  const dragNodeRef = useRef<{
    index: number;
    cx: number;
    cy: number;
    offX: number;
    offY: number;
  } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    k: number;
    wx: number;
    wy: number;
  } | null>(null);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const r = rectRef.current ?? svgRef.current?.getBoundingClientRect();
    if (!r) return { sx: 0, sy: 0 };
    return { sx: clientX - r.left, sy: clientY - r.top };
  }, []);

  const beginPinch = useCallback(() => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return;
    panRef.current = null;
    dragNodeRef.current = null;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const { sx, sy } = localPoint(midX, midY);
    const cam = camRef.current;
    pinchRef.current = {
      dist,
      k: cam.k,
      wx: (sx - cam.x) / (cam.k || 1),
      wy: (sy - cam.y) / (cam.k || 1),
    };
  }, [localPoint]);

  /** Capture phase: every pointer that touches the canvas is registered here,
   *  including ones that land on a node, so pinch works anywhere. */
  const handleCapturePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) beginPinch();
  };

  const handleCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointersRef.current.size > 1) return;
    didDragRef.current = false;
    pinchRef.current = null;
    panRef.current = {
      cx: e.clientX,
      cy: e.clientY,
      vx: 0,
      vy: 0,
      lastT: performance.now(),
    };
    isGrabbingRef.current = true;
    if (svgRef.current) svgRef.current.style.cursor = "grabbing";
    userAdjustedRef.current = true;
  };

  const handleNodePointerDown = useCallback(
    (index: number, e: ReactPointerEvent) => {
      if (pointersRef.current.size > 1) return;
      e.stopPropagation();
      didDragRef.current = false;
      panRef.current = null;
      const cam = camRef.current;
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      const k = cam.k || 1;
      const wx = (sx - cam.x) / k;
      const wy = (sy - cam.y) / k;
      dragNodeRef.current = {
        index,
        cx: e.clientX,
        cy: e.clientY,
        offX: wx - geom.base[index * 2],
        offY: wy - geom.base[index * 2 + 1],
      };
      isGrabbingRef.current = true;
      if (svgRef.current) svgRef.current.style.cursor = "grabbing";
    },
    [localPoint, geom]
  );

  useEffect(() => {
    /* Coalesce window pointermove: browsers can fire several events per frame
       (240Hz mice, touch). Each one used to rewrite camRef/targetRef — wasted
       work, since the rAF loop can only apply one camera state per frame. Events
       now only record the latest pointer position; the pinch / drag / pan math
       runs at most once per animation frame. */
    let moveRaf = 0;
    let latestMove: PointerEvent | null = null;

    const applyPointerMove = (e: PointerEvent) => {
      const pts = pointersRef.current;

      // Pinch zoom — anchored on the pinch midpoint, applied directly for 1:1 feel.
      const pinch = pinchRef.current;
      if (pinch && pts.size >= 2) {
        const p = Array.from(pts.values());
        const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
        const { sx, sy } = localPoint((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
        const nk = clamp(
          (pinch.k * dist) / pinch.dist,
          minZoomRef.current,
          MAX_ZOOM
        );
        const next = { k: nk, x: sx - pinch.wx * nk, y: sy - pinch.wy * nk };
        camRef.current = { ...next };
        targetRef.current = { ...next };
        didDragRef.current = true;
        userAdjustedRef.current = true;
        return;
      }

      // Node drag — live world coordinate tracking without anchor slip during zoom/pan.
      const drag = dragNodeRef.current;
      if (drag) {
        if (
          Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) >
          (e.pointerType === "touch" ? 12 : 4)
        ) {
          didDragRef.current = true;
        }
        const { sx, sy } = localPoint(e.clientX, e.clientY);
        const cam = camRef.current;
        const k = cam.k || 1;
        const wx = (sx - cam.x) / k;
        const wy = (sy - cam.y) / k;
        geom.base[drag.index * 2] = clamp(
          wx - drag.offX,
          bbox.minX - 400,
          bbox.minX + bbox.w + 400
        );
        geom.base[drag.index * 2 + 1] = clamp(
          wy - drag.offY,
          bbox.minY - 400,
          bbox.minY + bbox.h + 400
        );
        return;
      }

      // Canvas pan — direct, with velocity captured for release inertia.
      const pan = panRef.current;
      if (pan) {
        const dx = e.clientX - pan.cx;
        const dy = e.clientY - pan.cy;
        const now = performance.now();
        const dt = Math.max(1, now - pan.lastT);
        pan.vx = dx / dt;
        pan.vy = dy / dt;
        pan.lastT = now;
        pan.cx = e.clientX;
        pan.cy = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) didDragRef.current = true;
        const cam = camRef.current;
        const next = { k: cam.k, x: cam.x + dx, y: cam.y + dy };
        camRef.current = { ...next };
        targetRef.current = { ...next };
      }
    };

    const onMove = (e: PointerEvent) => {
      const pts = pointersRef.current;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      latestMove = e;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        const evt = latestMove;
        latestMove = null;
        if (evt) applyPointerMove(evt);
      });
    };

    const onUp = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size === 0) {
        rectRef.current = null;
        if (moveRaf) {
          cancelAnimationFrame(moveRaf);
          moveRaf = 0;
          latestMove = null;
        }
      }
      if (pointersRef.current.size >= 2) {
        beginPinch();
      } else {
        pinchRef.current = null;
      }

      const pan = panRef.current;
      if (pan && !reduceRef.current) {
        const speed = Math.hypot(pan.vx, pan.vy);
        if (speed > 0.25) {
          const t = targetRef.current;
          targetRef.current = {
            k: t.k,
            x: t.x + clamp(pan.vx, -4, 4) * PAN_INERTIA_MS,
            y: t.y + clamp(pan.vy, -4, 4) * PAN_INERTIA_MS,
          };
        }
      }
      panRef.current = null;
      dragNodeRef.current = null;
      isGrabbingRef.current = false;
      if (svgRef.current) svgRef.current.style.cursor = "";
    };

    const onBlur = () => {
      pointersRef.current.clear();
      rectRef.current = null;
      pinchRef.current = null;
      panRef.current = null;
      dragNodeRef.current = null;
      isGrabbingRef.current = false;
      if (svgRef.current) svgRef.current.style.cursor = "";
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
        latestMove = null;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
        latestMove = null;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [geom, bbox, beginPinch, localPoint]);

  /* ── wheel zoom: accumulates into the target, loop glides there ── */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const t = targetRef.current;
      // Anchor against the target screen-to-world position under cursor
      const targetWx = (sx - t.x) / (t.k || 1);
      const targetWy = (sy - t.y) / (t.k || 1);
      const nk = clamp(
        t.k * Math.exp(-clamp(step, -180, 180) * 0.0016),
        minZoomRef.current,
        MAX_ZOOM
      );
      if (nk === t.k) return;
      targetRef.current = { k: nk, x: sx - targetWx * nk, y: sy - targetWy * nk };
      if (reduceRef.current) camRef.current = { ...targetRef.current };
      userAdjustedRef.current = true;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [localPoint]);

  /* ── keyboard shortcuts ───────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable
      )
        return;
      if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0" || e.key.toLowerCase() === "c") centerOnConan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, centerOnConan]);

  /* ── selection ────────────────────────────────────────────────── */
  // Stable identities so memoized NodeViews never see a fresh function on
  // unrelated parent re-renders (hover, search typing, resize commits).
  const handleSelectNode = useCallback(
    (index: number) => {
      const n = nodes[index];
      const wx = geom.curX[index] || geom.base[index * 2];
      const wy = geom.curY[index] || geom.base[index * 2 + 1];
      zoomToPoint(wx, wy, ZOOM_TO_NODE, true);
      onSelectCharacter(n.c);
    },
    [nodes, geom, zoomToPoint, onSelectCharacter]
  );

  // Click variant: swallows the click that terminates a node drag. Drag
  // detection lives in pointer-move handling (didDragRef), so a plain click
  // that never moved still selects.
  const selectNode = useCallback(
    (index: number) => {
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      handleSelectNode(index);
    },
    [handleSelectNode]
  );

  /* ── theme-derived palette ────────────────────────────────────── */
  const pal = isDark ? CANVAS.dark : CANVAS.light;

  const dimmed = hoveredId !== null || Boolean(selectedCharacterId);
  const vw = Math.max(1, size.w);
  const vh = Math.max(1, size.h);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full select-none overflow-hidden rounded-2xl border transition-colors duration-300",
        // One token recipe for both themes — the hairline does the separation
        // work that the old theme-specific drop shadows did.
        "border-line bg-page text-ink shadow-card",
        className
      )}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "h-full w-full touch-none select-none cursor-grab active:cursor-grabbing transition-opacity duration-500",
          ready ? "opacity-100" : "opacity-0"
        )}
        aria-label="Detective Conan character relationship graph"
        onPointerDownCapture={handleCapturePointerDown}
        onPointerDown={handleCanvasPointerDown}
        onClick={(e) => {
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          if (
            selectedCharacterId &&
            (e.target === svgRef.current ||
              (e.target as Element)?.tagName === "rect" ||
              (e.target as Element)?.tagName === "ellipse")
          ) {
            onSelectCharacter(null);
          }
        }}
      >
        <defs>
          <radialGradient id="dcph-bg" cx="50%" cy="42%" r="78%">
            <stop offset="0%" stopColor={pal.bg0} />
            <stop offset="100%" stopColor={pal.bg1} />
          </radialGradient>

          <pattern id="dcph-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="13" cy="13" r={pal.dotRadius} fill={pal.dot} />
          </pattern>
        </defs>

        {/* Background stack: crisp clean dark vignette → dot matrix */}
        <rect width={vw} height={vh} fill="url(#dcph-bg)" />
        <rect width={vw} height={vh} fill="url(#dcph-dots)" />

        <g aria-hidden pointerEvents="none" className="pointer-events-none">
          {particles.map((p, i) => (
            <circle
              key={i}
              ref={(el) => {
                particleEls.current[i] = el;
              }}
              r={p.r}
              fill={pal.particle}
            />
          ))}
        </g>

        {/* World layer — transform written by the rAF loop, never by CSS */}
        <g ref={worldRef} style={{ transformOrigin: "0px 0px" }}>
          <g>
            {/* Strings — `d` is owned by the rAF loop; React owns paint + state.
                Memoized EdgeViews bail unless THIS edge's live state changed,
                so hover/search/size churn reconciles only the affected paths. */}
            {edges.map((e, i) => {
              const hidden = Boolean(activeFilter && e.rel.type !== activeFilter);
              const isTarget =
                hoveredId === e.rel.source ||
                hoveredId === e.rel.target ||
                selectedCharacterId === e.rel.source ||
                selectedCharacterId === e.rel.target;
              const matchesSearch =
                searchMatches.size === 0 ||
                searchMatches.has(e.rel.source) ||
                searchMatches.has(e.rel.target);
              const opacity = dimmed
                ? isTarget
                  ? 1
                  : DIM_OPACITY
                : matchesSearch
                  ? pal.stringActive
                  : pal.stringIdle;
              return (
                <EdgeView
                  key={e.rel.id}
                  e={e}
                  i={i}
                  edgeEls={edgeEls}
                  hidden={hidden}
                  isTarget={isTarget}
                  opacity={opacity}
                />
              );
            })}

            {/* Nodes — one <g> per node: the rAF loop repositions it via the
                nodeEls ref; React paints structure + state. Memoized NodeViews
                bail unless THIS node's visual state changed, so a hover or a
                search match re-renders ~2 subtrees, not the whole graph. */}
            {nodes.map((n, i) => (
              <NodeView
                key={n.c.id}
                n={n}
                i={i}
                isDark={isDark}
                pal={pal}
                isSelected={selectedCharacterId === n.c.id}
                isHovered={hoveredId === n.c.id}
                isSearchMatch={searchMatches.has(n.c.id)}
                nodeEls={nodeEls}
                labelEls={labelEls}
                grabbingRef={isGrabbingRef}
                didDragRef={didDragRef}
                onSelectNode={selectNode}
                onNodePointerDown={handleNodePointerDown}
                onHoverChange={setHoveredId}
              />
            ))}
          </g>
        </g>
      </svg>

      {/* ── top-left control column: search → host slot → results ──
           One flex column of flow siblings, so nothing can overlap. */}
      <div className="pointer-events-none absolute left-3 top-4 z-40 flex w-[16rem] flex-col gap-2 sm:left-4 sm:w-[18rem] md:top-5">
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 shadow-lift transition-all duration-300",
            "border-line bg-surface text-ink",
            searchFocused && "border-accent/70 ring-2 ring-accent/40"
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search characters"
            aria-label="Search characters"
            className="w-full min-w-0 select-text bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {topLeftSlot && <div className="pointer-events-auto">{topLeftSlot}</div>}

        {searchQuery && searchMatches.size > 0 && (
          <div className="pointer-events-auto max-h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface p-2 text-ink shadow-lift">
            {Array.from(searchMatches).map((id) => {
              const idx = indexById.get(id);
              if (idx === undefined) return null;
              const n = nodes[idx];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    handleSelectNode(idx);
                    setSearchQuery("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: n.theme.primary }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{n.c.name}</span>
                    <span className="block truncate text-[10px] text-ink-dim">
                      {n.c.role}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── bottom-left dock ─────────────────────────────────────── */}
      <div
        className={cn(
          "absolute z-30 flex items-center gap-1 rounded-full border p-1.5 shadow-lift transition-all duration-300",
          "border-line bg-surface",
          selectedCharacterId && isMobile
            ? "bottom-[calc(48vh+12px)] left-3"
            : "bottom-6 left-4 sm:left-6"
        )}
      >
        {/* The one accent-tinted control in the dock: it is the primary action,
            not a decorative highlight. accent-bright for the label because
            plain --accent is too dark to read as small text on near-black. */}
        <button
          type="button"
          onClick={() => centerOnConan()}
          aria-label="Center on Conan Edogawa"
          title="Center on Conan Edogawa (C)"
          className="flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1.5 font-display text-xs font-medium text-accent-bright transition-colors hover:bg-accent/20"
        >
          <Target className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Center Conan</span>
        </button>

        <div className="my-auto h-4 w-px bg-line" />

        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        <span
          ref={zoomLabelRef}
          className="w-10 text-center font-mono text-[10px] tabular-nums text-ink-faint"
          aria-hidden
        />

        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out (-)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => centerOnConan()}
          aria-label="Reset view to Conan"
          title="Reset view (0 / C)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* ── ambient stat badge ───────────────────────────────────── */}
      <div
        className={cn(
          "pointer-events-none absolute right-4 z-20 hidden items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider shadow-card sm:flex",
          "border-line bg-surface text-ink-faint",
          selectedCharacterId && !isMobile ? "bottom-[calc(1.5rem+2px)] right-[26rem]" : "bottom-6"
        )}
      >
        <Sparkles className="h-3 w-3 text-accent-bright" />
        {nodes.length} characters · {edges.length} threads
      </div>
    </div>
  );
}