"use client";

/**
 * CanvasGraph — the Obsidian-style renderer for the character web.
 *
 * WHY THIS EXISTS
 * The SVG renderer mounted ~2,350 live elements (319 nodes x a <g>, three
 * <circle>s and a label group, plus 217 <path> strings). The browser retains,
 * lays out, style-recalcs and hit-tests every one of them, which is why a
 * mid-range Android phone stuttered no matter which quality tier it picked.
 * Measured on the target device: ~66% of screen-recording frames were
 * pixel-identical, with runs of 1.5s of a frozen screen.
 *
 * This component draws the same graph as pixels. One <canvas> replaces the whole
 * tree, so the per-frame cost is proportional to what is visible, not to what is
 * mounted.
 *
 * THE RULE THAT MAKES IT FAST
 * There is no ambient animation loop. `requestPaint()` schedules a repaint, and
 * it is called only when something actually changed: a pointer event, a camera
 * command, a hover, a selection, a resize. An idle graph costs nothing. This is
 * the structural difference from the SVG version, which kept a rAF loop alive
 * to write drift, particles and breathing rings even when nothing moved.
 *
 * Ambient motion is a deliberate opt-in below (drift / particles), matching the
 * quality tiers: off on `low`, available on `high` for a desktop that can afford
 * a continuous loop.
 *
 * ACCESSIBILITY
 * Canvas has no semantics. Node pickable buttons are mirrored into a visually
 * hidden live layer so the graph is still reachable by keyboard and screen
 * reader, exactly as the SVG version was.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layers, RotateCcw, Search, Target, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Character, Relationship } from "@/lib/characters-guide";
import type { QualityTier } from "@/lib/device-tier";
import { GRAPH_QUALITY, labelTierLimit, type GraphQuality } from "./graph-quality";
import {
  clamp,
  getNodeRadius,
  getRelationshipColor,
  FACTION_THEMES,
  hash32,
  resolveFaction,
} from "@/components/characters/graph-theme";
import { galaxyLayout } from "./galaxy-layout";
import {
  Camera,
  clamp as clampValue,
  edgeOpacityFor,
  OUT_OF_WEB_COLOR,
  fitCamera,
  hitNode,
  homeCamera,
  toWorld,
  type HitCircle,
} from "./canvas-geometry";
import {
  MIN_NODE_R_PX,
  paint,
  sizeCanvas,
  type PaintPalette,
  type PaintedEdge,
  type PaintedNode,
} from "./canvas-painter";
import {
  DEFAULT_PROPAGATION,
  buildAdjacency,
  breatheScale,
  composeRenderPositions,
  driftParams,
  fillDrift,
  propagate,
  type DriftParams,
} from "./canvas-motion";

const MAX_ZOOM = 4;
const MIN_ZOOM = 0.12;
const ZOOM_STEP = 1.35;
/** Zoom used when flying to a searched node. */
const ZOOM_TO_NODE = 1.9;
/** Matches the SVG renderer's phone breakpoint. */
const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Hydration-safe matchMedia hook.
 *
 * Deliberately local rather than imported from CharactersWeb: importing the SVG
 * renderer — even for one hook — would drag its whole 2,200-line module into
 * this chunk and defeat the point of having two renderers.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
/** Share of the viewport the mobile dossier sheet may take. */
const SHEET_VH = 0.56;

/**
 * The part of the viewport actually free of floating chrome.
 *
 * Fitting into the raw container is what pushed the graph under the dock and the
 * top control row, so "centred" looked off-centre and the outermost nodes sat
 * behind the chrome. This mirrors CharactersWeb's usableRect so both renderers
 * centre on the same rectangle.
 */
function usableRect(
  w: number,
  h: number,
  isMobile: boolean,
  panelOpen: boolean
): { x: number; y: number; w: number; h: number } {
  const top = 100; // control row (search + graphics chip)
  const left = isMobile ? 16 : 28;
  const right = panelOpen && !isMobile ? 416 : isMobile ? 16 : 28;
  const bottom = panelOpen && isMobile ? Math.round(h * SHEET_VH) + 20 : 92;
  return {
    x: left,
    y: top,
    w: Math.max(140, w - left - right),
    h: Math.max(140, h - top - bottom),
  };
}

/** Slop added to node hit radius so a small node is finger-tappable. */
const TOUCH_SLACK_PX = 14;
/**
 * Screen px a finger must travel before a pan begins.
 *
 * Without it, the few pixels of movement in an ordinary touch-and-lift panned
 * the camera — so merely reaching for a node shifted the whole view.
 */
const PAN_DEAD_ZONE_PX = 8;

/**
 * Ambient drift amplitude in world px, for the canvas renderer.
 *
 * Deliberately NOT read from GRAPH_QUALITY.driftAmp: that field is 0 on the
 * `low` tier because the SVG renderer paid a full DOM write per node per frame
 * to move anything. Canvas pays one repaint, so a phone can afford gentle
 * motion that the SVG path had to cut — which is exactly what was asked for.
 * Reduced-motion still wins over all of it.
 */
const DRIFT_AMP = 2.4;
/** Halo breathing amount, as a share of the halo radius. */
const BREATHE_AMOUNT = 0.16;

const STRING_WIDTH = 2;
const DIM_OPACITY = 0.1;
const STRING_IDLE = 0.42;

const PALETTES: Record<"dark" | "light", PaintPalette> = {
  dark: {
    bg0: "#0A0A0A",
    bg1: "#000000",
    dot: "rgba(161,161,161,0.12)",
    dotRadius: 1.1,
    label: "#EDEDED",
    labelStrong: "#FFFFFF",
    labelHalo: "#000000",
    strokeStrong: "#FFFFFF",
    fontSize: 11,
  },
  light: {
    bg0: "#FFFFFF",
    bg1: "#E7ECF3",
    dot: "rgba(100,116,139,0.34)",
    dotRadius: 1.3,
    label: "#171717",
    labelStrong: "#0A0A0A",
    labelHalo: "#FFFFFF",
    strokeStrong: "#171717",
    fontSize: 11,
  },
};

type NodeSpec = {
  c: Character;
  r: number;
  tier: 0 | 1 | 2;
  primary: string;
  darkFill: string;
  lightFill: string;
  border: string;
  glow: string;
  name: string;
  sub?: string;
  /** Relationship count — drives the radius and the accessibility label. */
  degree: number;
};

type EdgeSpec = {
  rel: Relationship;
  s: number;
  t: number;
  off: number;
  color: string;
};

function pairKey(r: Relationship): string {
  return [r.source, r.target].sort().join("|");
}

export interface CanvasGraphProps {
  characters: Character[];
  relationships: Relationship[];
  quality?: QualityTier;
  onSelectCharacter: (character: Character | null) => void;
  /**
   * "galaxy" (default) is the flat radial layout, hub at the centre;
   * "authored" restores the hand-placed x/y from the data.
   */
  layout?: "galaxy" | "authored";
  selectedCharacterId?: string | null;
  theme?: "light" | "dark";
  /**
   * Chrome handed in by the page — the graphics-quality chip — rendered beside
   * the search button. The chip is the ONLY way to reach the quality chooser,
   * so the renderer must never be the one holding it back: whichever renderer
   * is on screen, the chooser stays reachable.
   */
  topLeftSlot?: ReactNode;
  className?: string;
}

export default function CanvasGraph({
  characters,
  relationships,
  quality = "balanced",
  layout = "galaxy",
  onSelectCharacter,
  selectedCharacterId,
  topLeftSlot,
  theme = "dark",
  className = "",
}: CanvasGraphProps) {
  const pal = PALETTES[theme];
  const q: GraphQuality = GRAPH_QUALITY[quality];
  const labelLimit = labelTierLimit(q.labels);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Drives the dock readout; updated from the camera on each paint. */
  const [zoomPct, setZoomPct] = useState(100);

  /* ── camera + interaction state (refs: read by paint, never by React) ── */
  const camRef = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const didFitRef = useRef(false);
  /** A dossier is open: it covers the lower half on a phone, so the fit has to
   *  reserve that space or the graph centres behind the sheet. */
  const panelOpenRef = useRef(Boolean(selectedCharacterId));
  /** Read straight from matchMedia so the FIRST fit is already phone-shaped;
   *  a React media-query hook settles one effect too late. */
  const isMobileRef = useRef(
    typeof window === "undefined"
      ? false
      : window.matchMedia(MOBILE_QUERY).matches
  );
  /** React-level phone flag, for LAYOUT. The ref above stays the source of
   *  truth for the fit, which has to be right on the very first measurement. */
  const isMobile = useMediaQuery(MOBILE_QUERY);
  /** The chrome-free rectangle every camera fit centres on. */
  const fitRect = useCallback(() => {
    const { w, h } = sizeRef.current;
    return usableRect(w, h, isMobileRef.current, panelOpenRef.current);
  }, []);
  useEffect(() => {
    panelOpenRef.current = Boolean(selectedCharacterId);
  }, [selectedCharacterId]);
  const dragRef = useRef<{
    index: number;
    offX: number;
    offY: number;
    /** The pointer that started the grab — only it may release the node. */
    pointerId: number;
  } | null>(null);
  const panRef = useRef<{
    cx: number;
    cy: number;
    vx: number;
    vy: number;
    lastT: number;
    /** Where the finger first landed — the dead-zone is measured from here. */
    ox: number;
    oy: number;
    /** False until the dead-zone is cleared, so a tap never pans. */
    active: boolean;
  } | null>(null);
  const movedRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    dist: number;
    k: number;
    wx: number;
    wy: number;
  } | null>(null);
  const rafRef = useRef(0);
  const dprRef = useRef(1);
  /** Latest draw closure, so requestPaint can stay referentially stable. */
  const drawRef = useRef<(() => void) | null>(null);

  /* ── motion buffers (allocated once, never per frame) ─────────────
   * home   = the settled layout (dragged nodes rewrite their own entry)
   * prop   = offsets a drag pushed onto neighbours, decaying back to zero
   * drift  = ambient wander, rewritten every animated frame
   * render = what the painter actually draws: home + prop + drift
   */
  const propBufRef = useRef<Float64Array | null>(null);
  const driftBufRef = useRef<Float64Array | null>(null);
  const renderBufRef = useRef<Float64Array | null>(null);
  const scratchBufRef = useRef<Float64Array | null>(null);
  const driftParamsRef = useRef<DriftParams[]>([]);
  /** rAF id of the ambient loop; non-zero while it is running. */
  const ambientRafRef = useRef(0);
  /** True while a finger/mouse is down, so ambient motion stays paused. */
  const interactingRef = useRef(false);
  const reduceMotionRef = useRef(false);
  /** Paint clock: ms since the ambient loop began its current run. */
  const clockRef = useRef(0);
  /** Set once the ambient loop exists, so an effect can start it. */
  const runAmbientRef = useRef<(() => void) | null>(null);

  /* ── derived graph model (built once per data change) ── */
  const { nodes, edges, indexById, bbox, positions, hubIndex } = useMemo(() => {
    const indexById = new Map<string, number>();
    characters.forEach((c, i) => indexById.set(c.id, i));
    /*
     * The hub is the highest-degree node — Conan, by a wide margin (34 links
     * against 16 for the next). Deriving it from the data rather than hardcoding
     * the id keeps the centre correct if the cast is ever edited, and it is the
     * only node that belongs at the middle of a radial layout.
     */
    let hubIndex = 0;
    {
      let best = -1;
      const deg = new Map<number, number>();
      for (const r of relationships) {
        const s = indexById.get(r.source);
        const t = indexById.get(r.target);
        if (s !== undefined) deg.set(s, (deg.get(s) ?? 0) + 1);
        if (t !== undefined) deg.set(t, (deg.get(t) ?? 0) + 1);
      }
      for (const [i, d] of deg) {
        if (d > best) {
          best = d;
          hubIndex = i;
        }
      }
    }

    const degree = new Map<string, number>();
    for (const r of relationships) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
    }

    const nodes: NodeSpec[] = characters.map((c) => {
      const d = degree.get(c.id) ?? 0;
      const r = getNodeRadius(d);
      const { theme: ft } = resolveFaction(c.affiliation);
      return {
        c,
        r,
        // Radius and tier both come straight from graph-theme, identical to the
        // SVG renderer, so the size hierarchy cannot drift between the two.
        tier: r >= 20 ? 0 : r >= 16 ? 1 : 2,
        primary: ft.primary,
        darkFill: ft.darkFill,
        lightFill: ft.lightFill,
        border: ft.border,
        glow: ft.glow,
        name: c.name,
        sub: theme === "dark" ? undefined : c.aliases?.[0],
        degree: d,
      };
    });

    const counts = new Map<string, number>();
    for (const r of relationships) {
      const k = pairKey(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const used = new Map<string, number>();
    const edges: EdgeSpec[] = [];
    for (const r of relationships) {
      const s = indexById.get(r.source);
      const t = indexById.get(r.target);
      if (s === undefined || t === undefined) continue;
      const k = pairKey(r);
      const total = counts.get(k) ?? 1;
      const idx = used.get(k) ?? 0;
      used.set(k, idx + 1);
      // Resolve the theme-aware colour HERE, at graph-build time. Leaving it
      // empty and defaulting at paint time flattened every red string to the
      // same grey and threw away the relationship-type palette.
      edges.push({
        rel: r,
        s,
        t,
        off: idx - (total - 1) / 2,
        color: getRelationshipColor(r.type, theme === "dark"),
      });
    }

    /*
     * GALAXY LAYOUT.
     *
     * Positions are DERIVED from the graph, not read from the authored x/y.
     * On a phone the hand-placed coordinates read as a tangle with no centre;
     * a radial layout gives you a hub to orient by and rings that mean
     * something (ring = hops from Conan). `layout` can be flipped back to
     * "authored" to compare, and the choice is a URL param.
     */
    const edgeS = new Int32Array(edges.map((e) => e.s));
    const edgeT = new Int32Array(edges.map((e) => e.t));
    const factionKeys = nodes.map((n) => resolveFaction(n.c.affiliation).key);
    const seeds = nodes.map((n) => hash32(n.c.id));

    /*
     * Two flat layouts, one source of truth. "galaxy" is the radial
     * arrangement — hub at the centre, factions as rings; "authored" restores
     * the hand-placed x/y from the data file.
     */
    let positions: Float64Array;

    if (layout === "authored") {
      positions = new Float64Array(nodes.length * 2);
      nodes.forEach((n, i) => {
        positions[i * 2] = n.c.x ?? 0;
        positions[i * 2 + 1] = n.c.y ?? 0;
      });
    } else {
      positions = galaxyLayout(
        nodes.length,
        edgeS,
        edgeT,
        factionKeys,
        seeds,
        hubIndex
      );
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n, i) => {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const halfLabel = Math.max(n.r + 8, 48);
      minX = Math.min(minX, x - halfLabel);
      maxX = Math.max(maxX, x + halfLabel);
      minY = Math.min(minY, y - n.r - 12);
      maxY = Math.max(maxY, y + n.r + 30);
    });
    const bbox = Number.isFinite(minX)
      ? { minX, minY, w: maxX - minX, h: maxY - minY }
      : { minX: -500, minY: -500, w: 1000, h: 1000 };

    return { nodes, edges, indexById, bbox, positions, hubIndex };
  }, [characters, relationships, theme, layout]);

  /**
   * Adjacency, built once per graph. This is what lets a dragged node pull its
   * neighbours with it (Obsidian's behaviour) at a cost of O(edges) per pointer
   * move rather than a pairwise pass.
   */
  /**
   * The authored layout, captured once and never mutated.
   *
   * Drag baking rewrites `positions`, so without this the only way back to the
   * intended arrangement would be a page reload. `home` stays the working copy;
   * this is the restore point.
   */
  const authoredRef = useRef<Float64Array | null>(null);


  const adjacency = useMemo(() => {
    const edgeS = new Int32Array(edges.length);
    const edgeT = new Int32Array(edges.length);
    edges.forEach((e, i) => {
      edgeS[i] = e.s;
      edgeT[i] = e.t;
    });
    return buildAdjacency(edgeS, edgeT, edges.length, nodes.length);
  }, [edges, nodes.length]);

  /* Motion buffers + per-node drift seeds. Sized to the node count, so this
     reallocates only when the cast actually changes. */
  useEffect(() => {
    const n = nodes.length;
    propBufRef.current = new Float64Array(n * 2);
    driftBufRef.current = new Float64Array(n * 2);
    renderBufRef.current = new Float64Array(n * 2);
    scratchBufRef.current = new Float64Array(n * 2);
    driftParamsRef.current = nodes.map((node) => driftParams(hash32(node.c.id)));
    if (!authoredRef.current || authoredRef.current.length !== positions.length) {
      authoredRef.current = Float64Array.from(positions);
    }
  }, [nodes, positions]);

  /* Kick off the ambient loop once buffered, and whenever it would otherwise be
     idle. The loop parks itself when there is nothing to animate. */
  useEffect(() => {
    if (nodes.length === 0) return;
    runAmbientRef.current?.();
  }, [nodes.length]);

  /* Reduced motion is a hard override: no ambient drift at all. */
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const onChange = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const selectedIndex = useMemo(
    () => (selectedCharacterId ? (indexById.get(selectedCharacterId) ?? -1) : -1),
    [selectedCharacterId, indexById]
  );

  /** Which faction is spotlighted, or null for the whole cast. */
  const [factionFocus, setFactionFocus] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  /**
   * The factions actually present, largest first.
   *
   * Derived from the data rather than from the theme table: the table lists 14
   * factions and the cast uses a subset, so listing the table would offer filters
   * that highlight nothing.
   */
  const factions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const { key } = resolveFaction(n.c.affiliation);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        count,
        theme: FACTION_THEMES[key] ?? FACTION_THEMES.DEFAULT,
        label: FACTION_THEMES[key]?.badge ?? key,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [nodes]);

  const searchMatches = useMemo(() => {
    const qy = searchQuery.trim().toLowerCase();
    const focus = factionFocus;
    if (!qy && !focus) return null;
    const set = new Set<number>();
    nodes.forEach((n, i) => {
      /*
       * The faction spotlight and the text search narrow the SAME set, so they
       * compose: pick a faction, then type to narrow within it. Two independent
       * filters would need two dim rules and would fight over the paint.
       */
      if (focus && resolveFaction(n.c.affiliation).key !== focus) return;
      if (!qy) {
        set.add(i);
        return;
      }
      if (
        n.c.name.toLowerCase().includes(qy) ||
        n.c.role.toLowerCase().includes(qy) ||
        n.c.affiliation.toLowerCase().includes(qy) ||
        n.c.aliases?.some((a) => a.toLowerCase().includes(qy))
      ) {
        set.add(i);
      }
    });
    return set;
  }, [searchQuery, factionFocus, nodes]);

  /* ── painting ─────────────────────────────────────────────────── */

  /**
   * Schedule a repaint. This is the ONLY thing that triggers drawing, and it
   * coalesces to one paint per animation frame, so a burst of pointermove
   * events costs exactly one repaint.
   */
  const requestPaint = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current?.();
    });
    // `draw` is read through a ref on purpose: it closes over the current hover /
    // selection / camera, and re-creating requestPaint whenever those change
    // would tear down and re-add every pointer listener on each hover.
  }, []);

  /**
   * Closing the dossier re-centres the graph.
   *
   * While a character is open the sheet reserves the bottom of the viewport,
   * so everything framed for it (tap focus, zoom about centre) targets a
   * shrunken area. On close, shift the camera by exactly the reserved delta:
   * what the viewer was reading stays the centre of the FULL frame instead of
   * the web hanging in the top half.
   */
  const hadSelectionRef = useRef(false);
  useEffect(() => {
    if (hadSelectionRef.current && !selectedCharacterId) {
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) {
        const open = usableRect(w, h, isMobileRef.current, true);
        const closed = usableRect(w, h, isMobileRef.current, false);
        const dx = closed.x + closed.w / 2 - (open.x + open.w / 2);
        const dy = closed.y + closed.h / 2 - (open.y + open.h / 2);
        const cam = camRef.current;
        camRef.current = { k: cam.k, x: cam.x + dx, y: cam.y + dy };
        requestPaint();
      }
    }
    hadSelectionRef.current = Boolean(selectedCharacterId);
  }, [selectedCharacterId, requestPaint]);

  /**
   * Ambient motion loop.
   *
   * Drives drift and the settle after a released drag. Runs ONLY while idle:
   * any pointer contact stops it immediately, so a finger on the graph never
   * competes with an animation for the main thread, and the repaint budget is
   * spent on the interaction instead. When there is nothing left to move —
   * no drift allowed and no propagation settling — it parks.
   */
  const runAmbient = useCallback(() => {
    if (ambientRafRef.current) return;
    let last = performance.now();

    const tick = (now: number) => {
      ambientRafRef.current = 0;
      if (interactingRef.current) return;

      const dt = Math.min(48, now - last);
      last = now;
      clockRef.current += dt;

      const n = nodes.length;
      const drift = driftBufRef.current;
      const prop = propBufRef.current;
      const params = driftParamsRef.current;
      const canDrift = !reduceMotionRef.current && DRIFT_AMP > 0;

      if (canDrift && drift && params.length === n) {
        fillDrift(params, drift, clockRef.current, DRIFT_AMP);
      } else if (drift) {
        drift.fill(0);
      }

      drawRef.current?.();

      if (canDrift) {
        ambientRafRef.current = requestAnimationFrame(tick);
      }
    };

    ambientRafRef.current = requestAnimationFrame(tick);
  }, [nodes.length]);

  runAmbientRef.current = runAmbient;

  const stopAmbient = useCallback(() => {
    if (ambientRafRef.current) {
      cancelAnimationFrame(ambientRafRef.current);
      ambientRafRef.current = 0;
    }
  }, []);

  useEffect(() => () => stopAmbient(), [stopAmbient]);

  const draw = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const cam = camRef.current;
    const dpr = dprRef.current;
    // paint() works in CSS px; restore the DPR scale after setTransform.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /*
     * Compose what actually gets drawn: home + propagated + drift.
     *
     * `positions` stays the settled layout so a released drag always returns to
     * the authored arrangement; the transient offsets live in their own buffers
     * and are summed here, once per frame, into a reused buffer.
     */
    const render = renderBufRef.current;
    const prop = propBufRef.current;
    const drift = driftBufRef.current;
    const drawPositions =
      render && prop && drift ? render : positions;
    if (render && prop && drift) {
      composeRenderPositions(
        positions,
        render,
        prop,
        reduceMotionRef.current ? null : drift,
        nodes.length
      );
    }

    const paintedNodes: PaintedNode[] = nodes.map((n, i) => ({
      index: i,
      primary: n.primary,
      darkFill: n.darkFill,
      lightFill: n.lightFill,
      border: n.border,
      glow: n.glow,
      r: n.r,
      tier: n.tier,
      name: n.name,
      sub: n.sub,
      isConan: n.c.id === "conan-edogawa",
    }));

    const edgeFrom = new Float64Array(edges.length * 2);
    const edgeTo = new Float64Array(edges.length * 2);
    const edgeOff = new Float64Array(edges.length);
    const paintedEdges: PaintedEdge[] = edges.map((e, i) => {
      edgeFrom[i * 2] = drawPositions[e.s * 2];
      edgeFrom[i * 2 + 1] = drawPositions[e.s * 2 + 1];
      edgeTo[i * 2] = drawPositions[e.t * 2];
      edgeTo[i * 2 + 1] = drawPositions[e.t * 2 + 1];
      edgeOff[i] = e.off;

      const isTarget =
        e.s === hovered || e.t === hovered || e.s === selectedIndex || e.t === selectedIndex;
      /*
       * The rule lives in `edgeOpacityFor` so it can be tested without a DOM.
       * The short version: a selected character's web stays at full strength
       * while every other string drops into the background as a gray ghost
       * (OUT_OF_WEB_OPACITY, colour burned out — the leftover ~200 threads
       * would still cross the web being read if they kept their colours),
       * a search or faction spotlight still DIMS what it excludes, and a
       * hover only brightens.
       */
      const opacity = edgeOpacityFor(e.s, e.t, {
        selectedIndex,
        hoveredIndex: hovered,
        searchMatches,
      });
      const inWeb =
        selectedIndex >= 0 && (e.s === selectedIndex || e.t === selectedIndex);
      return {
        index: i,
        color: selectedIndex >= 0 && !inWeb ? OUT_OF_WEB_COLOR : e.color,
        opacity,
        width: (selectedIndex >= 0 ? inWeb : isTarget) ? 2.6 : 2,
      };
    });

    paint(
      ctx,
      {
        cam,
        nodes: paintedNodes,
        edges: paintedEdges,
        edgeFrom,
        edgeTo,
        edgeOff,
        positions: drawPositions,
        selectedIndex,
        hoveredIndex: hovered,
        searchMatches,
        dotGrid: q.dotGrid,
        isDark: theme === "dark",
        dpr,
        ambientMs: reduceMotionRef.current ? 0 : clockRef.current,
        viewport: { w, h },
      },
      pal
    );
  }, [nodes, edges, positions, hovered, selectedIndex, searchMatches, q.dotGrid, pal, theme]);

  // Publish the current draw so requestPaint() always repaints with fresh state.
  drawRef.current = draw;

  /* ── sizing / DPR ─────────────────────────────────────────────── */

  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      setSize({ w, h });
      const ctx = canvas.getContext("2d", { alpha: false });
      if (ctx) {
        ctxRef.current = ctx;
        dprRef.current = sizeCanvas(canvas, ctx, w, h, window.devicePixelRatio || 1);
      }
      /*
       * First measurement: open on the renderer-shared home framing (phones
       * fill the width; desktops centre the hub at the SVG renderer's opening
       * zoom), so switching quality never re-frames the graph — the layout a
       * visitor saw at one tier is the layout at every tier.
       */
      if (!didFitRef.current) {
        didFitRef.current = true;
        camRef.current = homeCamera(
          bbox,
          { x: positions[hubIndex * 2], y: positions[hubIndex * 2 + 1] },
          fitRect(),
          isMobileRef.current,
          MIN_ZOOM,
          1.6
        );
        setZoomPct(Math.round(camRef.current.k * 100));
      }
      requestPaint();
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bbox, fitRect, requestPaint, positions, hubIndex]);

  /* ── camera commands (dock buttons + search "fly to") ───────────── */

  /** Zoom about the centre of the usable rect, then repaint.
   *
   * The usable rect, not the raw middle: while the sheet/panel is open the
   * raw middle sits inside the reserved strip, so zooming about it dragged
   * the graph out of the visible frame. Mirrors the SVG renderer.
   */
  const zoomBy = useCallback((factor: number) => {
    const cam = camRef.current;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const vp = usableRect(w, h, isMobileRef.current, panelOpenRef.current);
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    const world = toWorld(cx, cy, cam);
    const nk = clamp(cam.k * factor, MIN_ZOOM, MAX_ZOOM);
    camRef.current = { k: nk, x: cx - world.x * nk, y: cy - world.y * nk };
    setZoomPct(Math.round(nk * 100));
    requestPaint();
  }, [requestPaint]);

  /** Fit the whole graph into the chrome-free area. */
  const centerOnConan = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    camRef.current = fitCamera(bbox, fitRect(), MIN_ZOOM, 1.6);
    setZoomPct(Math.round(camRef.current.k * 100));
    requestPaint();
  }, [bbox, fitRect, requestPaint]);

  /**
   * True reset: restore the authored layout AND refit.
   *
   * A drag bakes its propagated offsets into `positions`, so without this the
   * arrangement a visitor dragged the graph into would be permanent for the
   * session — and there would be no way back to the layout the data intends.
   */
  const resetLayout = useCallback(() => {
    const authored = authoredRef.current;
    if (authored && authored.length === positions.length) {
      positions.set(authored);
    }
    propBufRef.current?.fill(0);
    centerOnConan();
  }, [positions, centerOnConan]);

  /** Bring a node into view at a readable zoom.
   *
   * Centres it in the USABLE rect with the panel reserved — selecting opens the
   * dossier, and centring in the raw viewport parked the node behind the mobile
   * sheet (or under the desktop side panel) the moment it opened.
   */
  const focusNode = useCallback(
    (index: number) => {
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;
      const cam = camRef.current;
      const k = clampValue(
        Math.max(cam.k, ZOOM_TO_NODE),
        MIN_ZOOM,
        MAX_ZOOM
      );
      const vp = usableRect(w, h, isMobileRef.current, true);
      camRef.current = {
        k,
        x: vp.x + vp.w / 2 - positions[index * 2] * k,
        y: vp.y + vp.h / 2 - positions[index * 2 + 1] * k,
      };
      setZoomPct(Math.round(k * 100));
      requestPaint();
    },
    [positions, requestPaint]
  );

  /* ── pointer interaction ──────────────────────────────────────── */

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { sx: 0, sy: 0 };
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  }, []);

  const hitCircles = useCallback((): HitCircle[] => {
    const out: HitCircle[] = [];
    for (let i = 0; i < nodes.length; i++) {
      out.push({
        index: i,
        wx: positions[i * 2],
        wy: positions[i * 2 + 1],
        r: nodes[i].r,
      });
    }
    return out;
  }, [nodes, positions]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const hoveredRef = { current: -1 };

    /*
     * Hit-test against WHAT IS ON SCREEN.
     *
     * The painter draws home + propagation + drift (the render buffer). Reading
     * `positions` here instead meant the grab tested a point the visitor cannot
     * see: with any drift active the node is visibly elsewhere, the hit misses,
     * and the gesture falls through to the pan branch — so grabbing a node slid
     * the whole camera. Same buffer for both sides.
     */
    const circles = () => {
      const painted = renderBufRef.current;
      const src =
        painted && painted.length === positions.length ? painted : positions;
      return nodes.map((n, i) => ({
        index: i,
        wx: src[i * 2],
        wy: src[i * 2 + 1],
        /*
         * Match the radius the painter actually draws, including its
         * drawn-size floor. Testing against the raw `n.r` would put the target
         * somewhere other than where the node looks.
         */
        r: Math.max(n.r, MIN_NODE_R_PX / (camRef.current.k || 1)),
      }));
    };

    const onDown = (e: PointerEvent) => {
      // Ambient motion yields to the finger: stop it before any gesture work.
      interactingRef.current = true;
      ambientRafRef.current && cancelAnimationFrame(ambientRafRef.current);
      ambientRafRef.current = 0;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      movedRef.current = false;
      const { sx, sy } = localPoint(e.clientX, e.clientY);

      /*
       * A LIVE NODE DRAG OWNS THE GESTURE.
       *
       * On a phone it is easy for a second finger, a thumb, or the edge of a
       * palm to land while you are moving a node. That used to satisfy the
       * two-pointer branch below and silently convert the drag into a pinch:
       * the grab was thrown away and the CAMERA took over, panning along the
       * midpoint of the two contacts — i.e. the view slid in the same direction
       * you were moving the node. Extra contacts are now ignored entirely while
       * a node is held; the pinch can only begin from a clean two-finger touch.
       */
      if (dragRef.current) return;

      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = localPoint(
          (pts[0].x + pts[1].x) / 2,
          (pts[0].y + pts[1].y) / 2
        );
        const cam = camRef.current;
        const w = toWorld(mid.sx, mid.sy, cam);
        pinchRef.current = { dist, k: cam.k, wx: w.x, wy: w.y };
        dragRef.current = null;
        panRef.current = null;
        return;
      }

      // Node pick — the canvas replaces the browser's hit-test.
      const idx = hitNode(sx, sy, camRef.current, circles(), TOUCH_SLACK_PX);
      if (idx >= 0) {
        const cam = camRef.current;
        const w = toWorld(sx, sy, cam);
        /*
         * The offset is measured against the node's PAINTED position, not its
         * settled one. Ambient drift means those differ by a few px, and using
         * the settled position made the node visibly hop under the finger at
         * the instant of the grab.
         */
        const painted = renderBufRef.current;
        const base =
          painted && painted.length === positions.length ? painted : positions;
        dragRef.current = {
          index: idx,
          offX: w.x - base[idx * 2],
          offY: w.y - base[idx * 2 + 1],
          pointerId: e.pointerId,
        };
        el.style.cursor = "grabbing";
        return;
      }

      panRef.current = {
        cx: e.clientX,
        cy: e.clientY,
        vx: 0,
        vy: 0,
        lastT: performance.now(),
        ox: e.clientX,
        oy: e.clientY,
        active: false,
      };
      el.style.cursor = "grabbing";
    };

    /*
     * Coalesce pointermove to one pass per frame.
     *
     * A drag handler that runs per EVENT does a full propagate (O(nodes+edges))
     * plus a full repaint several times per frame — browsers fire far more move
     * events than the display can show. That is what made the node feel like it
     * lagged behind the finger. Recording the latest position and applying it
     * once per animation frame makes the node track the finger closely instead.
     */
    let moveRaf = 0;
    let latestMove: PointerEvent | null = null;

    const onMove = (e: PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      latestMove = e;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        const evt = latestMove;
        latestMove = null;
        if (evt) applyMove(evt);
      });
    };

    const applyMove = (e: PointerEvent) => {

      // Pinch zoom.
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = localPoint(
          (pts[0].x + pts[1].x) / 2,
          (pts[0].y + pts[1].y) / 2
        );
        const nk = clamp((pinch.k * dist) / pinch.dist, MIN_ZOOM, MAX_ZOOM);
        camRef.current = { k: nk, x: mid.sx - pinch.wx * nk, y: mid.sy - pinch.wy * nk };
        movedRef.current = true;
        setZoomPct(Math.round(nk * 100));
        requestPaint();
        return;
      }

      // Node drag — move the node and pull its web along, then repaint once.
      const drag = dragRef.current;
      if (drag) {
        const { sx, sy } = localPoint(e.clientX, e.clientY);
        const w = toWorld(sx, sy, camRef.current);
        const nx = w.x - drag.offX;
        const ny = w.y - drag.offY;
        const dx = nx - positions[drag.index * 2];
        const dy = ny - positions[drag.index * 2 + 1];

        positions[drag.index * 2] = nx;
        positions[drag.index * 2 + 1] = ny;

        /*
         * Obsidian's feel: the neighbours are dragged along by the moved node,
         * each hop attenuated, so you tug the web rather than pluck one dot out
         * of it. Offsets accumulate into the propagation buffer, which the
         * ambient loop then eases back to zero on release.
         */
        const scratch = scratchBufRef.current;
        const prop = propBufRef.current;
        if (scratch && prop) {
          propagate(
            drag.index,
            dx,
            dy,
            nx,
            ny,
            adjacency,
            nodes.length,
            positions,
            scratch,
            DEFAULT_PROPAGATION
          );
          // Accumulate at full strength: the shares already carry the
          // hierarchy attenuation, and damping a second time here would leave
          // direct children at half the drag again.
          for (let i = 0; i < prop.length; i++) prop[i] += scratch[i];
        }
        movedRef.current = true;
        requestPaint();
        return;
      }

      // Pan. A small dead-zone first, so a finger that meant to tap does not
      // nudge the camera — that nudge is what makes the view feel like it drifts
      // under you while you are only trying to touch a node.
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
        if (!pan.active) {
          const travelled = Math.hypot(
            e.clientX - pan.ox,
            e.clientY - pan.oy
          );
          if (travelled < PAN_DEAD_ZONE_PX) return;
          pan.active = true;
        }
        const cam = camRef.current;
        camRef.current = { k: cam.k, x: cam.x + dx, y: cam.y + dy };
        movedRef.current = true;
        requestPaint();
        return;
      }

      // Idle hover — the canvas equivalent of CSS :hover on a node <g>.
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      const idx = hitNode(sx, sy, camRef.current, circles(), TOUCH_SLACK_PX);
      if (idx !== hoveredRef.current) {
        hoveredRef.current = idx;
        setHovered(idx);
      }
    };

    const onUp = (e: PointerEvent) => {
      /*
       * Only the finger that grabbed the node may let it go. A stray contact
       * landing and lifting mid-drag used to run this whole settle path —
       * baking the offsets and dropping the node — so the graph would twitch
       * away from the finger that was still holding it.
       */
      const held = dragRef.current;
      if (held && held.pointerId !== e.pointerId) {
        pointersRef.current.delete(e.pointerId);
        return;
      }
      // Apply the last pending move before settling, so a fast flick does not
      // lose its final position to a cancelled frame.
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
        if (latestMove) {
          const evt = latestMove;
          latestMove = null;
          applyMove(evt);
        }
      }
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      const wasTap = !movedRef.current;
      dragRef.current = null;
      panRef.current = null;
      el.style.cursor = "";
      /*
       * Bake the propagated offsets into the settled layout.
       *
       * Letting them decay instead would tear the group apart: the dragged node
       * STAYS where it was dropped (its position was written during the drag)
       * while its children spring back home, so a hub would sit detached from
       * the web it just pulled. Baking keeps the whole structure in its new
       * relative arrangement, which is what "move the head and the children
       * follow" has to mean.
       *
       * The authored layout is preserved separately, so reset can undo this.
       */
      const prop = propBufRef.current;
      if (prop) {
        for (let i = 0; i < positions.length; i++) positions[i] += prop[i];
        prop.fill(0);
      }
      interactingRef.current = false;
      runAmbientRef.current?.();
      if (wasTap) {
        const { sx, sy } = localPoint(e.clientX, e.clientY);
        const idx = hitNode(sx, sy, camRef.current, circles(), TOUCH_SLACK_PX);
        /* Tapping a character flies the camera to it — same readable zoom the
           search results use — so the picked node is front and centre instead
           of wherever the overview left it. Empty space only deselects. */
        if (idx >= 0) focusNode(idx);
        onSelectCharacter(idx >= 0 ? nodes[idx].c : null);
      }
    };

    const onLeave = () => {
      if (hoveredRef.current !== -1) {
        hoveredRef.current = -1;
        setHovered(-1);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = localPoint(e.clientX, e.clientY);
      const cam = camRef.current;
      const w = toWorld(sx, sy, cam);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nk = clamp(cam.k * factor, MIN_ZOOM, MAX_ZOOM);
      camRef.current = { k: nk, x: sx - w.x * nk, y: sy - w.y * nk };
      setZoomPct(Math.round(nk * 100));
      requestPaint();
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
        latestMove = null;
      }
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    };
  }, [nodes, positions, adjacency, localPoint, focusNode, onSelectCharacter, requestPaint]);

  /* Repaint whenever the painted inputs change. */
  useEffect(() => {
    requestPaint();
  }, [requestPaint, draw]);

  const searchResults = useMemo(() => {
    const qy = searchQuery.trim().toLowerCase();
    if (!qy) return [];
    return nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) =>
        n.c.name.toLowerCase().includes(qy) ||
        n.c.role.toLowerCase().includes(qy) ||
        n.c.affiliation.toLowerCase().includes(qy)
      )
      .slice(0, 8);
  }, [searchQuery, nodes]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden touch-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        aria-hidden
      />

      {/* ── control chrome ──────────────────────────────────────────
          The canvas paints the graph; these are ordinary DOM buttons layered
          over it. They were an omission in the first port — the graph was
          unreachable without pinch, which is exactly the "no functions"
          symptom. Kept as real buttons so they are focusable and announced. */}

      {/* search + the page's quality chip, top-left */}
      <div className="absolute left-3 top-4 z-20 sm:left-4">
        <div className="flex items-start gap-2">
          {topLeftSlot}
          <button
            type="button"
            onClick={() => {
              if (searchOpen) setSearchQuery("");
              setSearchOpen(!searchOpen);
            }}
            aria-label="Search characters"
            aria-expanded={searchOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-lift"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        {searchOpen && (
          <div className="mt-2 w-[min(15rem,calc(100vw-2rem))] space-y-1.5 rounded-xl border border-line bg-surface p-2 text-ink shadow-lift">
            <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setSearchOpen(false);
                    e.stopPropagation();
                  }
                }}
                placeholder="Search characters"
                aria-label="Search characters"
                className="w-full min-w-0 select-text bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            {searchQuery && (
              <div className="max-h-[40vh] overflow-y-auto">
                {searchResults.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-ink-faint">
                    No characters match that.
                  </p>
                ) : (
                  searchResults.map(({ n, i }) => (
                    <button
                      key={n.c.id}
                      type="button"
                      onClick={() => {
                        // Fly to the node instead of just selecting it, so the
                        // result is visible in the viewport.
                        focusNode(i);
                        onSelectCharacter(n.c);
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: n.primary }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">
                          {n.c.name}
                        </span>
                        <span className="block truncate text-[10px] text-ink-dim">
                          {n.c.role}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* legend, top-right: what the colours mean, and a faction spotlight */}
      <div className="absolute right-3 top-4 z-20 flex flex-col items-end sm:right-4">
        <button
          type="button"
          onClick={() => setLegendOpen(!legendOpen)}
          aria-label="Legend and factions"
          aria-expanded={legendOpen}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink shadow-lift",
            factionFocus && "border-accent-bright/60 text-accent-bright"
          )}
        >
          <Layers className="h-4 w-4" />
          <span className="font-mono text-[10px] uppercase tracking-wider">
            {factionFocus ? factions.find((f) => f.key === factionFocus)?.label ?? "Faction" : "Legend"}
          </span>
        </button>
        {legendOpen && (
          <div className="mt-2 max-h-[min(22rem,50vh)] w-[min(16rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift">
            <button
              type="button"
              onClick={() => setFactionFocus(null)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                factionFocus === null ? "bg-accent/10 text-accent-bright" : "text-ink hover:bg-surface-muted"
              )}
            >
              <span className="font-medium">All factions</span>
              <span className="font-mono text-[10px] tabular-nums text-ink-faint">
                {nodes.length}
              </span>
            </button>
            {factions.map((f) => {
              const active = factionFocus === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  // Tapping the active faction clears it, so the row is its own
                  // toggle and the spotlight never becomes a dead end.
                  onClick={() => setFactionFocus(active ? null : f.key)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    active ? "bg-accent/10 text-accent-bright" : "text-ink hover:bg-surface-muted"
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: f.theme.primary, boxShadow: `0 0 6px ${f.theme.glow}` }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-ink-faint">
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* dock: center-Conan, zoom out, readout, zoom in, reset */}
      <div
        className={
          // The sheet covers the lower ~56% of a phone, so the dock has to sit
          // above it or it is unreachable exactly when a dossier is open.
          selectedCharacterId && isMobile
            ? "absolute bottom-[calc(56vh+12px)] left-3 z-20 flex items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lift"
            : "absolute bottom-6 left-3 z-20 flex items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lift sm:left-4"
        }
      >
        <button
          type="button"
          onClick={centerOnConan}
          aria-label="Center on Conan Edogawa"
          title="Center on Conan Edogawa"
          className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1.5 font-display text-xs font-medium text-accent-bright"
        >
          <Target className="h-3.5 w-3.5" />
        </button>
        <div className="my-auto h-4 w-px bg-line" />
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-10 text-center font-mono text-[10px] tabular-nums text-ink-faint" aria-hidden>
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetLayout}
          aria-label="Reset layout"
          title="Reset layout"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* character count, mirrors the SVG renderer's badge */}
      <div className="pointer-events-none absolute bottom-6 right-4 z-10 hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint shadow-card sm:flex">
        {nodes.length} characters · {edges.length} threads
      </div>

      {/* Accessibility mirror: the canvas cannot expose semantics, so every
          node gets a real focusable button in a visually hidden layer. This is
          the same trade Obsidian makes for its canvas graph. */}
      <div className="sr-only">
        {nodes.map((n, i) => (
          <button
            key={n.c.id}
            type="button"
            onClick={() => {
              focusNode(i);
              onSelectCharacter(n.c);
            }}
            aria-label={`${n.c.name}, ${n.c.role}, ${n.degree} relationships`}
          >
            {n.c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
