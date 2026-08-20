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
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { motion, MotionConfig, useReducedMotion, type Variants } from "framer-motion";
import {
  CHARACTERS,
  RELATIONSHIPS,
  type Character,
  type Relationship,
  type RelationshipType,
} from "@/lib/characters-guide";
import {
  FACTION_KEYS,
  FACTION_THEMES,
  clamp,
  factionSlug,
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

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
const FIT_MIN_K = 0.25;
const FIT_MAX_K = 1.6;

/** Camera smoothing time constant (ms). Lower = snappier. */
const CAM_TAU = 85;
/** Inertia applied to the pan target on release (ms of projected travel). */
const PAN_INERTIA_MS = 140;

const DRIFT_AMP = 5.5;
/* ── anti-collision ───────────────────────────────────────────────
 * Circles push each other apart when their radii overlap. The push is
 * stored as a persistent per-node offset that decays back toward the
 * node's home position, so a collision reads as an impact-and-settle
 * rather than a snap. Offsets never touch `base` — drag / fit /
 * zoomToConan keep reading the untouched seeded layout.
 * ---------------------------------------------------------------- */
const COLLIDE_PAD = 6;          // world px of breathing room beyond r_i + r_j
const COLLIDE_ITERS = 4;        // Gauss-Seidel relaxation passes per frame
const COLLIDE_STIFF = 0.6;      // fraction of each overlap resolved per pass
const COLLIDE_MAX_OFFSET = 28;  // hard cap on displacement from home (world px)
const COLLIDE_RELAX_TAU = 260;  // ms; how fast a pushed circle drifts back home
const BASE_BOW = 6;
const PARALLEL_GAP = 22;
const STRING_WIDTH = 2;
const DIM_OPACITY = 0.1;
const PARTICLE_COUNT = 30;

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
    auraNeutral: "#EDEDED",
    auraNeutralOpacity: 0.06,
    auraAccent: "#C8102E",                // --accent
    auraAccentOpacity: 0.16,
    dotRadius: 1.1,
    glowInner: 0.5,
    glowMid: 0.2,
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
    auraNeutral: "#94A3B8",
    auraNeutralOpacity: 0.13,
    auraAccent: "#B30C25",
    auraAccentOpacity: 0.1,
    dotRadius: 1.3,
    glowInner: 0.34,
    glowMid: 0.13,
    stringActive: 0.62,
    stringIdle: 0.18,
  },
} as const;

const nodeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.3 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
};

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.012 } },
};

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
  const start = tier === 0 ? 0.3 : tier === 1 ? 0.46 : 0.62;
  return clamp((k - start) / 0.22, 0, 1);
}

/* ── per-node / per-edge specs ────────────────────────────────────── */

type NodeSpec = {
  c: Character;
  r: number;
  tier: 0 | 1 | 2;
  factionKey: string;
  theme: FactionTheme;
  degree: number;
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

type EdgeSpec = { rel: Relationship; s: number; t: number; off: number };

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
  onSelectCharacter: (character: Character | null) => void;
  selectedCharacterId?: string | null;
  activeFilter?: RelationshipType | null;
  /** Rendered inside the top-left control column, below the search field. */
  topLeftSlot?: React.ReactNode;
  theme?: "light" | "dark";
  className?: string;
}

export default function CharactersWeb({
  characters = CHARACTERS,
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
  const [grabbing, setGrabbing] = useState(false);

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
    for (const r of RELATIONSHIPS) {
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
    for (const r of RELATIONSHIPS) {
      const key = pairKey(r);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const used = new Map<string, number>();
    const edges: EdgeSpec[] = [];
    for (const r of RELATIONSHIPS) {
      const s = indexById.get(r.source);
      const t = indexById.get(r.target);
      if (s === undefined || t === undefined) continue;
      const key = pairKey(r);
      const total = counts.get(key) ?? 1;
      const idx = used.get(key) ?? 0;
      used.set(key, idx + 1);
      edges.push({ rel: r, s, t, off: idx - (total - 1) / 2 });
    }

    return { nodes, edges, indexById };
  }, [characters]);

  /** Base (authored, drag-mutated) positions + per-frame drifted positions. */
  const geom = useMemo(() => {
    const n = nodes.length;
    const base = new Float64Array(n * 2);
    nodes.forEach((node, i) => {
      base[i * 2] = node.c.x;
      base[i * 2 + 1] = node.c.y;
    });
    return { base, curX: new Float64Array(n), curY: new Float64Array(n) };
  }, [nodes]);

  /** Content bounding box, inflated for label boxes and drift headroom. */
  const bbox = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const halfLabel = Math.max(n.r + 8, 48);
      minX = Math.min(minX, n.c.x - halfLabel);
      maxX = Math.max(maxX, n.c.x + halfLabel);
      minY = Math.min(minY, n.c.y - n.r - 12);
      maxY = Math.max(maxY, n.c.y + n.r + 30);
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
  }, [hoveredId, selectedCharacterId, searchMatches, indexById]);

  /* ── camera commands ──────────────────────────────────────────── */

  const fitToContent = useCallback(
    (instant = false) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const vp = usableRect(w, h, isMobileRef.current, panelOpenRef.current);
      const k = clamp(
        Math.min(vp.w / bbox.w, vp.h / bbox.h),
        FIT_MIN_K,
        FIT_MAX_K
      );
      minZoomRef.current = Math.min(0.2, k * 0.6);
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
    (wx: number, wy: number, k = ZOOM_TO_NODE, panelOpen?: boolean) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const vp = usableRect(
        w,
        h,
        isMobileRef.current,
        panelOpen ?? panelOpenRef.current
      );
      const kk = clamp(k, minZoomRef.current, MAX_ZOOM);
      targetRef.current = {
        k: kk,
        x: vp.x + vp.w / 2 - wx * kk,
        y: vp.y + vp.h / 2 - wy * kk,
      };
      if (reduceRef.current) camRef.current = { ...targetRef.current };
      userAdjustedRef.current = true;
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
    targetRef.current = {
      k: nk,
      x: cx - ((cx - t.x) * nk) / t.k,
      y: cy - ((cy - t.y) * nk) / t.k,
    };
    if (reduceRef.current) camRef.current = { ...targetRef.current };
    userAdjustedRef.current = true;
  }, []);

  const centerOnConan = useCallback(() => {
    const i = indexById.get("conan-edogawa");
    if (i === undefined) {
      fitToContent();
      return;
    }
    zoomToPoint(geom.base[i * 2], geom.base[i * 2 + 1], 1.35);
  }, [indexById, geom, zoomToPoint, fitToContent]);

  /* ── size observation + initial fit ───────────────────────────── */
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr || cr.width < 1 || cr.height < 1) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      setSize({ w, h });
      if (!didFitRef.current) {
        didFitRef.current = true;
        fitToContent(true);
        setReady(true);
      } else if (!userAdjustedRef.current) {
        fitToContent();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContent]);

  /* ── the single animation loop ────────────────────────────────── */
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    let lastLabelK = -1;
    let lastZoomLabel = -1;

    /* Persistent separation offsets + the frame's drifted home positions.
       Recreated whenever the effect re-runs (i.e. when `nodes` changes),
       so they can never outlive the layout they describe. */
    const offX = new Float64Array(nodes.length);
    const offY = new Float64Array(nodes.length);
    const homeX = new Float64Array(nodes.length);
    const homeY = new Float64Array(nodes.length);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
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

      worldRef.current?.setAttribute(
        "transform",
        `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.k.toFixed(4)})`
      );

      /* 2 — node drift + anti-collision (positions feed BOTH nodes and strings) */
      const amp = reduceRef.current ? 0 : DRIFT_AMP;
      const { base, curX, curY } = geom;
      const dragIdx = dragNodeRef.current?.index ?? -1;
      const N = nodes.length;

      /* 2a — drifted home positions, plus last frame's separation offsets
              decayed toward zero so circles ease back once they are clear */
      const decay = Math.exp(-dt / COLLIDE_RELAX_TAU);
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
          // The dragged circle is pinned to the pointer: it displaces others
          // but is never displaced itself.
          offX[i] = 0;
          offY[i] = 0;
        } else {
          offX[i] *= decay;
          offY[i] *= decay;
        }
        curX[i] = x + offX[i];
        curY[i] = y + offY[i];
      }

      /* 2b — pairwise separation. Gauss-Seidel: each pass reads the positions
              the previous pair already corrected, so a few passes untangle
              clusters instead of fighting over one axis. ~60 nodes = 1770
              pairs per pass; trivial next to the SVG attribute writes. */
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
              // Exactly coincident: pick a deterministic axis from the index
              // pair (golden-angle) so the split is stable frame to frame.
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
            // A pinned neighbour transfers its whole share to the other node.
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

      /* 2c — cap total displacement so a dense cluster can never shred the
              seeded composition; the offset is clamped, then the position is
              rebuilt from the drifted home to stay exact. */
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

      /* 2d — commit the corrected positions to the DOM */
      for (let i = 0; i < N; i++) {
        const g = nodeEls.current[i];
        if (g) {
          g.setAttribute(
            "transform",
            `translate(${curX[i].toFixed(2)} ${curY[i].toFixed(2)})`
          );
        }
      }

      /* 3 — strings follow the same drifted coordinates */
      for (let i = 0; i < edges.length; i++) {
        const el = edgeEls.current[i];
        if (!el || el.style.display === "none") continue;
        const e = edges[i];
        el.setAttribute("d", quadPath(curX[e.s], curY[e.s], curX[e.t], curY[e.t], e.off));
      }

      /* 4 — zoom-dependent label opacity (only when zoom actually moved) */
      if (Math.abs(cam.k - lastLabelK) > 0.004) {
        lastLabelK = cam.k;
        const forced = forcedLabelsRef.current;
        for (let i = 0; i < nodes.length; i++) {
          const el = labelEls.current[i];
          if (!el) continue;
          const o = forced.has(i) ? 1 : labelOpacityFor(cam.k, nodes[i].tier);
          el.style.opacity = o.toFixed(2);
        }
      }

      /* 5 — ambient particles (screen space, behind the world) */
      if (!reduceRef.current) {
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

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
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
    bx: number;
    by: number;
  } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    k: number;
    wx: number;
    wy: number;
  } | null>(null);

  const localPoint = (clientX: number, clientY: number) => {
    const r = rectRef.current ?? svgRef.current?.getBoundingClientRect();
    if (!r) return { sx: 0, sy: 0 };
    return { sx: clientX - r.left, sy: clientY - r.top };
  };

  const beginPinch = () => {
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
      wx: (sx - cam.x) / cam.k,
      wy: (sy - cam.y) / cam.k,
    };
  };

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
    setGrabbing(true);
    userAdjustedRef.current = true;
  };

  const handleNodePointerDown = (index: number, e: ReactPointerEvent) => {
    if (pointersRef.current.size > 1) return;
    e.stopPropagation();
    didDragRef.current = false;
    panRef.current = null;
    dragNodeRef.current = {
      index,
      cx: e.clientX,
      cy: e.clientY,
      bx: geom.base[index * 2],
      by: geom.base[index * 2 + 1],
    };
    setGrabbing(true);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pts = pointersRef.current;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

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

      // Node drag — world delta is a plain pixel delta over k.
      const drag = dragNodeRef.current;
      if (drag) {
        const k = camRef.current.k || 1;
        const dx = (e.clientX - drag.cx) / k;
        const dy = (e.clientY - drag.cy) / k;
        if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) >
          (e.pointerType === "touch" ? 12 : 4)) {
          didDragRef.current = true;
        }
        geom.base[drag.index * 2] = clamp(drag.bx + dx, bbox.minX - 400, bbox.minX + bbox.w + 400);
        geom.base[drag.index * 2 + 1] = clamp(drag.by + dy, bbox.minY - 400, bbox.minY + bbox.h + 400);
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

    const onUp = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;

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
      setGrabbing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [geom, bbox]);

  /* ── wheel zoom: accumulates into the target, loop glides there ── */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      const t = targetRef.current;
      // Anchor against the TARGET so rapid wheel bursts compound coherently
      // instead of fighting the in-flight animation.
      const wx = (sx - t.x) / t.k;
      const wy = (sy - t.y) / t.k;
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const nk = clamp(
        t.k * Math.exp(-clamp(step, -180, 180) * 0.0016),
        minZoomRef.current,
        MAX_ZOOM
      );
      if (nk === t.k) return;
      targetRef.current = { k: nk, x: sx - wx * nk, y: sy - wy * nk };
      if (reduceRef.current) camRef.current = { ...targetRef.current };
      userAdjustedRef.current = true;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ── keyboard shortcuts ───────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") fitToContent();
      else if (e.key.toLowerCase() === "c") centerOnConan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, fitToContent, centerOnConan]);

  /* ── selection ────────────────────────────────────────────────── */
  const handleSelectNode = (index: number) => {
    const n = nodes[index];
    zoomToPoint(geom.base[index * 2], geom.base[index * 2 + 1], ZOOM_TO_NODE, true);
    onSelectCharacter(n.c);
  };

  const handleNodeKeyDown =
    (index: number) => (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSelectNode(index);
      }
    };

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
      <MotionConfig reducedMotion="user">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn(
            "h-full w-full touch-none select-none transition-opacity duration-700",
            ready ? "opacity-100" : "opacity-0",
            grabbing ? "cursor-grabbing" : "cursor-grab"
          )}
          aria-label="Detective Conan character relationship graph"
          onPointerDownCapture={handleCapturePointerDown}
          onPointerDown={handleCanvasPointerDown}
        >
          <defs>
            <radialGradient id="dcph-bg" cx="50%" cy="42%" r="78%">
              <stop offset="0%" stopColor={pal.bg0} />
              <stop offset="100%" stopColor={pal.bg1} />
            </radialGradient>

            {/* Aura A: a neutral light bloom (was cyan — the only cyan in the
                app, and it read as a leftover next to the crimson accent). */}
            <radialGradient id="dcph-aura-a" cx="50%" cy="50%" r="50%">
              <stop
                offset="0%"
                stopColor={pal.auraNeutral}
                stopOpacity={pal.auraNeutralOpacity}
              />
              <stop offset="100%" stopColor={pal.auraNeutral} stopOpacity="0" />
            </radialGradient>
            {/* Aura B: the single accent bloom. */}
            <radialGradient id="dcph-aura-b" cx="50%" cy="50%" r="50%">
              <stop
                offset="0%"
                stopColor={pal.auraAccent}
                stopOpacity={pal.auraAccentOpacity}
              />
              <stop offset="100%" stopColor={pal.auraAccent} stopOpacity="0" />
            </radialGradient>

            <pattern id="dcph-dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="13" cy="13" r={pal.dotRadius} fill={pal.dot} />
            </pattern>

            {/* One soft-glow gradient per faction — gives every node a real
                neon halo with zero SVG filters (filters at 62x kill the frame). */}
            {FACTION_KEYS.map((key) => {
              const t = FACTION_THEMES[key];
              return (
                <radialGradient
                  key={key}
                  id={`dcph-glow-${factionSlug(key)}`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={t.primary} stopOpacity={pal.glowInner} />
                  <stop offset="55%" stopColor={t.primary} stopOpacity={pal.glowMid} />
                  <stop offset="100%" stopColor={t.primary} stopOpacity="0" />
                </radialGradient>
              );
            })}
          </defs>

          {/* Background stack: vignette → drifting auras → dot matrix → motes */}
          <rect width={vw} height={vh} fill="url(#dcph-bg)" />
          <g>
            <ellipse
              className="dcph-aura-a"
              cx={vw * 0.32}
              cy={vh * 0.3}
              rx={vw * 0.42}
              ry={vh * 0.4}
              fill="url(#dcph-aura-a)"
            />
            <ellipse
              className="dcph-aura-b"
              cx={vw * 0.74}
              cy={vh * 0.68}
              rx={vw * 0.38}
              ry={vh * 0.36}
              fill="url(#dcph-aura-b)"
            />
          </g>
          <rect width={vw} height={vh} fill="url(#dcph-dots)" />

          <g aria-hidden>
            {particles.map((p, i) => (
              <circle
                key={i}
                ref={(el) => {
                  particleEls.current[i] = el;
                }}
                r={p.r}
                fill={pal.particle}
                opacity={0}
              />
            ))}
          </g>

          {/* World layer — transform written by the rAF loop, never by CSS */}
          <g ref={worldRef} style={{ transformOrigin: "0px 0px" }}>
            <motion.g
              variants={containerVariants}
              initial={reduce ? "show" : "hidden"}
              animate="show"
            >
              {/* Strings — `d` is owned by the loop; React owns only paint props */}
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
                const color = getRelationshipColor(e.rel.type, isDark);
                return (
                  <path
                    key={e.rel.id}
                    ref={(el) => {
                      edgeEls.current[i] = el;
                    }}
                    fill="none"
                    stroke={color}
                    strokeWidth={isTarget ? STRING_WIDTH + 1.8 : STRING_WIDTH}
                    strokeLinecap="round"
                    opacity={opacity}
                    style={{
                      display: hidden ? "none" : undefined,
                      transition: "opacity 220ms ease, stroke-width 220ms ease",
                      filter: isTarget
                        ? `drop-shadow(0 0 6px ${color})`
                        : undefined,
                    }}
                  />
                );
              })}

              {/* Nodes — outer <g> transform is owned by the loop */}
              {nodes.map((n, i) => {
                const isSelected = selectedCharacterId === n.c.id;
                const isHovered = hoveredId === n.c.id;
                const isSearchMatch = searchMatches.has(n.c.id);
                const isConan = n.c.id === "conan-edogawa";
                const glowUrl = `url(#dcph-glow-${factionSlug(n.factionKey)})`;
                const emphasised = isSelected || isHovered;

                return (
                  <g
                    key={n.c.id}
                    ref={(el) => {
                      nodeEls.current[i] = el;
                    }}
                  >
                    <motion.g variants={nodeVariants} style={{ transformOrigin: "0px 0px" }}>
                      <g
                        role="button"
                        tabIndex={0}
                        aria-label={`${n.c.name}, ${n.c.role}, ${n.degree} relationships`}
                        className="group cursor-pointer outline-none"
                        onPointerDown={(e) => handleNodePointerDown(i, e)}
                        onClick={() => {
                          if (didDragRef.current) {
                            didDragRef.current = false;
                            return;
                          }
                          handleSelectNode(i);
                        }}
                        onKeyDown={handleNodeKeyDown(i)}
                        onMouseEnter={grabbing ? undefined : () => setHoveredId(n.c.id)}
                        onMouseLeave={grabbing ? undefined : () => setHoveredId(null)}
                        onFocus={() => setHoveredId(n.c.id)}
                        onBlur={() => setHoveredId(null)}
                      >
                        {/* Ambient faction halo — always on, stronger when active */}
                        <circle
                          r={n.r * 2.6}
                          fill={glowUrl}
                          opacity={
                            emphasised || isConan ? 1 : isSearchMatch ? 0.85 : 0.42
                          }
                          style={{ transition: "opacity 220ms ease" }}
                          pointerEvents="none"
                        />

                        {isConan && (
                          <circle
                            className="dcph-ripple"
                            r={n.r + 12}
                            fill="none"
                            stroke={n.theme.primary}
                            strokeWidth={2}
                            pointerEvents="none"
                          />
                        )}

                        {/* Breathing ring — CSS keyframes, not 62 JS animations */}
                        <circle
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

                        {(isSelected || isSearchMatch) && (
                          <circle
                            r={n.r + 7}
                            fill="none"
                            stroke={isSelected ? pal.strokeStrong : n.theme.border}
                            strokeWidth={2}
                            pointerEvents="none"
                          />
                        )}

                        <circle
                          r={n.r + 5}
                          fill="none"
                          stroke={n.theme.border}
                          strokeWidth={1.5}
                          className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                          pointerEvents="none"
                        />

                        <circle
                          r={n.r}
                          fill={isSelected ? n.theme.primary : isDark ? n.theme.darkFill : n.theme.lightFill}
                          stroke={emphasised ? pal.strokeStrong : n.theme.border}
                          strokeWidth={isConan ? 3.5 : isSelected ? 3 : 2}
                          className="transition-[fill,stroke] duration-200"
                        />

                        <circle
                          r={isConan ? 6 : n.r > 16 ? 4.5 : 3.5}
                          fill={emphasised ? pal.strokeStrong : n.theme.primary}
                          pointerEvents="none"
                        />

                        {/* Label — halo never matches the fill, in either theme */}
                        <g
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
                    </motion.g>
                  </g>
                );
              })}
            </motion.g>
          </g>
        </svg>
      </MotionConfig>

      {/* ── top-left control column: search → host slot → results ──
           One flex column of flow siblings, so nothing can overlap. */}
      <div className="pointer-events-none absolute left-3 top-4 z-40 flex w-[16rem] flex-col gap-2 sm:left-4 sm:w-[18rem] md:top-5">
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 shadow-lift backdrop-blur-md transition-all duration-300",
            "border-line bg-surface/90 text-ink",
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
          <div className="pointer-events-auto max-h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface/95 p-2 text-ink shadow-lift backdrop-blur-md">
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
          "absolute z-30 flex items-center gap-1 rounded-full border p-1.5 shadow-lift backdrop-blur-md transition-all duration-300",
          "border-line bg-surface/90",
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
          onClick={centerOnConan}
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
        >
          100%
        </span>

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
          onClick={() => fitToContent()}
          aria-label="Fit graph to view"
          title="Fit graph to view (0)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* ── ambient stat badge ───────────────────────────────────── */}
      <div
        className={cn(
          "pointer-events-none absolute right-4 z-20 hidden items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider shadow-card backdrop-blur-md sm:flex",
          "border-line bg-surface/80 text-ink-faint",
          selectedCharacterId && !isMobile ? "bottom-[calc(1.5rem+2px)] right-[26rem]" : "bottom-6"
        )}
      >
        <Sparkles className="h-3 w-3 text-accent-bright" />
        {nodes.length} characters · {edges.length} threads
      </div>
    </div>
  );
}