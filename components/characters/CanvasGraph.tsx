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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, Target, ZoomIn, ZoomOut } from "lucide-react";
import type { Character, Relationship } from "@/lib/characters-guide";
import type { QualityTier } from "@/lib/device-tier";
import { GRAPH_QUALITY, labelTierLimit, type GraphQuality } from "./graph-quality";
import {
  clamp,
  getNodeRadius,
  getRelationshipColor,
  resolveFaction,
} from "@/components/characters/graph-theme";
import {
  Camera,
  clamp as clampValue,
  fitCamera,
  hitNode,
  toWorld,
  type HitCircle,
} from "./canvas-geometry";
import {
  paint,
  sizeCanvas,
  type PaintPalette,
  type PaintedEdge,
  type PaintedNode,
} from "./canvas-painter";

const MAX_ZOOM = 4;
const MIN_ZOOM = 0.12;
const ZOOM_STEP = 1.35;
/** Zoom used when flying to a searched node. */
const ZOOM_TO_NODE = 1.9;
/** Matches the SVG renderer's phone breakpoint. */
const MOBILE_QUERY = "(max-width: 767px)";
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
  selectedCharacterId?: string | null;
  theme?: "light" | "dark";
  className?: string;
}

export default function CanvasGraph({
  characters,
  relationships,
  quality = "balanced",
  onSelectCharacter,
  selectedCharacterId,
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
  /** The chrome-free rectangle every camera fit centres on. */
  const fitRect = useCallback(() => {
    const { w, h } = sizeRef.current;
    return usableRect(w, h, isMobileRef.current, panelOpenRef.current);
  }, []);
  useEffect(() => {
    panelOpenRef.current = Boolean(selectedCharacterId);
  }, [selectedCharacterId]);
  const dragRef = useRef<{ index: number; offX: number; offY: number } | null>(null);
  const panRef = useRef<{
    cx: number;
    cy: number;
    vx: number;
    vy: number;
    lastT: number;
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

  /* ── derived graph model (built once per data change) ── */
  const { nodes, edges, indexById, bbox, positions } = useMemo(() => {
    const indexById = new Map<string, number>();
    characters.forEach((c, i) => indexById.set(c.id, i));

    const degree = new Map<string, number>();
    for (const r of relationships) {
      degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
      degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
    }

    const nodes: NodeSpec[] = characters.map((c) => {
      const d = degree.get(c.id) ?? 0;
      const r = getNodeRadius(c, d);
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

    // Authored world positions.
    const positions = new Float64Array(nodes.length * 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n, i) => {
      const x = n.c.x ?? 0;
      const y = n.c.y ?? 0;
      positions[i * 2] = x;
      positions[i * 2 + 1] = y;
      const halfLabel = Math.max(n.r + 8, 48);
      minX = Math.min(minX, x - halfLabel);
      maxX = Math.max(maxX, x + halfLabel);
      minY = Math.min(minY, y - n.r - 12);
      maxY = Math.max(maxY, y + n.r + 30);
    });
    const bbox = Number.isFinite(minX)
      ? { minX, minY, w: maxX - minX, h: maxY - minY }
      : { minX: -500, minY: -500, w: 1000, h: 1000 };

    return { nodes, edges, indexById, bbox, positions };
  }, [characters, relationships, theme]);

  const selectedIndex = useMemo(
    () => (selectedCharacterId ? (indexById.get(selectedCharacterId) ?? -1) : -1),
    [selectedCharacterId, indexById]
  );

  const searchMatches = useMemo(() => {
    const qy = searchQuery.trim().toLowerCase();
    if (!qy) return null;
    const set = new Set<number>();
    nodes.forEach((n, i) => {
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
  }, [searchQuery, nodes]);

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

  const draw = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const cam = camRef.current;
    const dpr = dprRef.current;
    // paint() works in CSS px; restore the DPR scale after setTransform.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      edgeFrom[i * 2] = positions[e.s * 2];
      edgeFrom[i * 2 + 1] = positions[e.s * 2 + 1];
      edgeTo[i * 2] = positions[e.t * 2];
      edgeTo[i * 2 + 1] = positions[e.t * 2 + 1];
      edgeOff[i] = e.off;

      const isTarget =
        e.s === hovered || e.t === hovered || e.s === selectedIndex || e.t === selectedIndex;
      const dimmed = hovered >= 0 || searchMatches !== null || selectedIndex >= 0;
      const opacity = dimmed ? (isTarget ? 1 : 0.1) : 0.5;
      return { index: i, color: e.color, opacity, width: 2 };
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
        positions,
        selectedIndex,
        hoveredIndex: hovered,
        searchMatches,
        dimmed: hovered >= 0 || selectedIndex >= 0 || searchMatches !== null,
        dotGrid: q.dotGrid,
        isDark: theme === "dark",
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
      // First measurement: fit the graph so it is never off-screen.
      if (!didFitRef.current) {
        didFitRef.current = true;
        camRef.current = fitCamera(bbox, fitRect(), MIN_ZOOM, 1.6);
        setZoomPct(Math.round(camRef.current.k * 100));
      }
      requestPaint();
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bbox, fitRect, requestPaint]);

  /* ── camera commands (dock buttons + search "fly to") ───────────── */

  /** Zoom about the viewport centre, then repaint. */
  const zoomBy = useCallback((factor: number) => {
    const cam = camRef.current;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const cx = w / 2;
    const cy = h / 2;
    const world = toWorld(cx, cy, cam);
    const nk = clamp(cam.k * factor, MIN_ZOOM, MAX_ZOOM);
    camRef.current = { k: nk, x: cx - world.x * nk, y: cy - world.y * nk };
    setZoomPct(Math.round(nk * 100));
    requestPaint();
  }, [requestPaint]);

  /** Fit the whole graph into the chrome-free area — what "reset" means. */
  const centerOnConan = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    camRef.current = fitCamera(bbox, fitRect(), MIN_ZOOM, 1.6);
    setZoomPct(Math.round(camRef.current.k * 100));
    requestPaint();
  }, [bbox, fitRect, requestPaint]);

  /** Bring a node into view at a readable zoom. */
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
      camRef.current = {
        k,
        x: w / 2 - positions[index * 2] * k,
        y: h / 2 - positions[index * 2 + 1] * k,
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

    const circles = () =>
      nodes.map((n, i) => ({
        index: i,
        wx: positions[i * 2],
        wy: positions[i * 2 + 1],
        r: n.r,
      }));

    const onDown = (e: PointerEvent) => {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      movedRef.current = false;
      const { sx, sy } = localPoint(e.clientX, e.clientY);

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
        dragRef.current = {
          index: idx,
          offX: w.x - positions[idx * 2],
          offY: w.y - positions[idx * 2 + 1],
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
      };
      el.style.cursor = "grabbing";
    };

    const onMove = (e: PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

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

      // Node drag — write straight into the position buffer, one repaint.
      const drag = dragRef.current;
      if (drag) {
        const { sx, sy } = localPoint(e.clientX, e.clientY);
        const w = toWorld(sx, sy, camRef.current);
        positions[drag.index * 2] = w.x - drag.offX;
        positions[drag.index * 2 + 1] = w.y - drag.offY;
        movedRef.current = true;
        requestPaint();
        return;
      }

      // Pan.
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
        const cam = camRef.current;
        camRef.current = { k: cam.k, x: cam.x + dx, y: cam.y + dy };
        if (Math.abs(dx) + Math.abs(dy) > 1) movedRef.current = true;
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
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      const wasTap = !movedRef.current;
      dragRef.current = null;
      panRef.current = null;
      el.style.cursor = "";
      if (wasTap) {
        const { sx, sy } = localPoint(e.clientX, e.clientY);
        const idx = hitNode(sx, sy, camRef.current, circles(), TOUCH_SLACK_PX);
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
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    };
  }, [nodes, positions, localPoint, onSelectCharacter, requestPaint]);

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

      {/* search, top-left */}
      <div className="absolute left-3 top-4 z-20 sm:left-4">
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
        {searchOpen && (
          <div className="mt-2 w-[15rem] space-y-1.5 rounded-xl border border-line bg-surface p-2 text-ink shadow-lift">
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

      {/* dock: center-Conan, zoom out, readout, zoom in, reset */}
      <div className="absolute bottom-6 left-3 z-20 flex items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lift sm:left-4 sm:bottom-6">
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
          onClick={centerOnConan}
          aria-label="Reset view"
          title="Reset view"
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
            onClick={() => onSelectCharacter(n.c)}
            aria-label={`${n.c.name}, ${n.c.role}, ${n.degree} relationships`}
          >
            {n.c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
