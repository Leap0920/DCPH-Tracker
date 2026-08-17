"use client";

/*
  CharactersWeb — Obsidian-inspired interactive red-strings SVG graph.

  Features:
  - Full mobile responsiveness (touch pan, pinch, drag nodes, tap to center)
  - Draggable nodes: move character circles freely, with real-time dynamic edge curving
  - Precise zoom-to-node math: clicking any node centers it exactly in the viewport
  - Search bar with live highlighting and focus navigation
  - Obsidian-style dot matrix canvas with sleek glows & node feedback
  - Floating controls: Zoom (+/-), Reset, Search, and Fullscreen toggle
*/

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  motion,
  MotionConfig,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  CHARACTERS,
  RELATIONSHIPS,
  RELATIONSHIP_META,
  type Character,
  type Relationship,
  type RelationshipType,
} from "@/lib/characters-guide";
import { RelationshipLegend } from "@/components/characters/CharacterDetailPanel";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  Search,
  Move,
  X,
  Filter,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hydration-safe matchMedia hook.
 */
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

const EASE = [0.16, 1, 0.3, 1] as const;

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};

const stringVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5, ease: EASE } },
};

const nodeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.3 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
};

/** Canvas geometry */
const NODE_RADIUS = 13;
const STRING_WIDTH = 2;
const DIM_OPACITY = 0.12;
const BASE_BOW = 6;
const PARALLEL_GAP = 22;

/** World geometry — 2000x1400 coordinate canvas */
const VIEW_W = 2000;
const VIEW_H = 1400;

/** Pan/zoom limits */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.5;
const ZOOM_STEP = 1.25;
const ZOOM_TO_NODE = 1.8;
const DRAG_THRESHOLD = 4;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function pairKey(r: Relationship): string {
  return [r.source, r.target].sort().join("|");
}

function buildStringDFromPos(
  source: { x: number; y: number },
  target: { x: number; y: number },
  offsetIndex: number
): string {
  const mx = (source.x + target.x) / 2;
  const my = (source.y + target.y) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const arc = BASE_BOW + offsetIndex * PARALLEL_GAP;
  const cx = mx + px * arc;
  const cy = my + py * arc;
  return `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`;
}

export interface CharactersWebProps {
  onSelectCharacter: (character: Character | null) => void;
  selectedCharacterId?: string | null;
  activeFilter?: RelationshipType | null;
  onFilterType?: (type: RelationshipType | null) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  className?: string;
}

export default function CharactersWeb({
  onSelectCharacter,
  selectedCharacterId,
  activeFilter,
  onFilterType,
  isFullscreen = false,
  onToggleFullscreen,
  theme = "light",
  onToggleTheme,
  className = "",
}: CharactersWebProps) {
  const reduce = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isDark = theme === "dark";
  const [legendOpen, setLegendOpen] = useState(false);

  // Mutable node positions so user can drag circles freely
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const c of CHARACTERS) {
      map[c.id] = { x: c.x, y: c.y };
    }
    return map;
  });

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  /** Pan/zoom view state: translate (x, y) + scale k */
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [draggingCanvas, setDraggingCanvas] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [instant, setInstant] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const viewRef = useRef(view);
  const capturedRef = useRef(false);

  // Drag state refs for global window listeners
  const isDraggingCanvasRef = useRef(false);
  const canvasDragStartRef = useRef<{ clientX: number; clientY: number; startViewX: number; startViewY: number } | null>(null);

  const isDraggingNodeRef = useRef(false);
  const activeNodeIdRef = useRef<string | null>(null);
  const nodeDragStartRef = useRef<{ clientX: number; clientY: number; startNodeX: number; startNodeY: number } | null>(null);

  /** Window pointer listeners for 100% robust PC & Mobile movement */
  useEffect(() => {
    const handleWindowPointerMove = (e: globalThis.PointerEvent) => {
      // 1. Node dragging
      if (isDraggingNodeRef.current && activeNodeIdRef.current && nodeDragStartRef.current && svgRef.current) {
        const start = nodeDragStartRef.current;
        const rect = svgRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dx = e.clientX - start.clientX;
          const dy = e.clientY - start.clientY;

          const threshold = e.pointerType === "touch" ? 12 : 4;
          if (Math.hypot(dx, dy) > threshold) {
            didDragRef.current = true;
          }

          const currentK = viewRef.current.k;
          const svgDx = (dx / rect.width) * VIEW_W / currentK;
          const svgDy = (dy / rect.height) * VIEW_H / currentK;

          const newX = clamp(start.startNodeX + svgDx, 30, VIEW_W - 30);
          const newY = clamp(start.startNodeY + svgDy, 30, VIEW_H - 30);

          setPositions((prev) => ({
            ...prev,
            [activeNodeIdRef.current!]: { x: newX, y: newY },
          }));
        }
        return;
      }

      // 2. Canvas panning
      if (isDraggingCanvasRef.current && canvasDragStartRef.current && svgRef.current) {
        const start = canvasDragStartRef.current;
        const rect = svgRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dx = e.clientX - start.clientX;
          const dy = e.clientY - start.clientY;

          const threshold = e.pointerType === "touch" ? 12 : 4;
          if (Math.hypot(dx, dy) > threshold) {
            didDragRef.current = true;
          }

          const svgDx = (dx / rect.width) * VIEW_W;
          const svgDy = (dy / rect.height) * VIEW_H;

          setView({
            x: start.startViewX + svgDx,
            y: start.startViewY + svgDy,
            k: viewRef.current.k,
          });
        }
      }
    };

    const handleWindowPointerUp = () => {
      isDraggingCanvasRef.current = false;
      canvasDragStartRef.current = null;
      isDraggingNodeRef.current = false;
      activeNodeIdRef.current = null;
      nodeDragStartRef.current = null;
      setDraggingCanvas(false);
      setDraggingNodeId(null);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
  }, []);

  /** Wheel / Trackpad Zoom */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y, k } = viewRef.current;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const cx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      const cy = ((e.clientY - rect.top) / rect.height) * VIEW_H;

      const zoomFactor = Math.exp(-e.deltaY * 0.002);
      const nextK = clamp(k * zoomFactor, MIN_ZOOM, MAX_ZOOM);
      if (nextK === k) return;

      setInstant(true);
      setView({
        x: cx - ((cx - x) * nextK) / k,
        y: cy - ((cy - y) * nextK) / k,
        k: nextK,
      });
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  /** Native Touch listener for 100% reliable mobile 2-finger pinch zooming */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let touchPinchDist = 0;
    let touchStartK = 1;
    let touchCenter = { x: 500, y: 300 };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isDraggingCanvasRef.current = false;
        isDraggingNodeRef.current = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        touchStartK = viewRef.current.k;

        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const midX = (t1.clientX + t2.clientX) / 2;
          const midY = (t1.clientY + t2.clientY) / 2;
          touchCenter = {
            x: ((midX - rect.left) / rect.width) * VIEW_W,
            y: ((midY - rect.top) / rect.height) * VIEW_H,
          };
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchPinchDist > 0) {
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const curDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

        if (curDist > 0) {
          const factor = curDist / touchPinchDist;
          const nextK = clamp(touchStartK * factor, MIN_ZOOM, MAX_ZOOM);
          const { x, y, k } = viewRef.current;

          setInstant(true);
          setView({
            x: touchCenter.x - ((touchCenter.x - x) * nextK) / k,
            y: touchCenter.y - ((touchCenter.y - y) * nextK) / k,
            k: nextK,
          });
        }
      }
    };

    const handleTouchEnd = () => {
      touchPinchDist = 0;
    };

    svg.addEventListener("touchstart", handleTouchStart, { passive: true });
    svg.addEventListener("touchmove", handleTouchMove, { passive: false });
    svg.addEventListener("touchend", handleTouchEnd, { passive: true });
    svg.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      svg.removeEventListener("touchstart", handleTouchStart);
      svg.removeEventListener("touchmove", handleTouchMove);
      svg.removeEventListener("touchend", handleTouchEnd);
      svg.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  /** Derived relationships and node degrees */
  const { byId, strings, degreeByCharacter } = useMemo(() => {
    const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

    const counts = new Map<string, number>();
    for (const r of RELATIONSHIPS) {
      const key = pairKey(r);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const used = new Map<string, number>();
    const strings: { rel: Relationship; d: string }[] = [];
    for (const r of RELATIONSHIPS) {
      const source = byId.get(r.source);
      const target = byId.get(r.target);
      if (!source || !target) continue;

      const sourcePos = positions[r.source] ?? { x: source.x, y: source.y };
      const targetPos = positions[r.target] ?? { x: target.x, y: target.y };

      const key = pairKey(r);
      const total = counts.get(key) ?? 1;
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);

      strings.push({
        rel: r,
        d: buildStringDFromPos(sourcePos, targetPos, index - (total - 1) / 2),
      });
    }

    const degreeByCharacter = new Map<string, number>();
    for (const c of CHARACTERS) degreeByCharacter.set(c.id, 0);
    for (const r of RELATIONSHIPS) {
      degreeByCharacter.set(r.source, (degreeByCharacter.get(r.source) ?? 0) + 1);
      degreeByCharacter.set(r.target, (degreeByCharacter.get(r.target) ?? 0) + 1);
    }

    return { byId, strings, degreeByCharacter };
  }, [positions]);

  /** Zoom into exact coordinate (targetX, targetY) so it centers in the 2000x1400 viewBox */
  const zoomToPoint = (wx: number, wy: number, targetK: number = ZOOM_TO_NODE) => {
    setInstant(false);
    // On mobile, position node near upper center (32% of view height) so bottom sheet never obscures it
    const targetYCenter = isMobile ? VIEW_H * 0.32 : VIEW_H / 2;
    setView({
      x: VIEW_W / 2 - wx * targetK,
      y: targetYCenter - wy * targetK,
      k: targetK,
    });
  };

  /** Center and select a character node */
  const handleSelectNode = (c: Character) => {
    const pos = positions[c.id] ?? { x: c.x, y: c.y };
    zoomToPoint(pos.x, pos.y, ZOOM_TO_NODE);
    onSelectCharacter(c);
  };

  const handleNodeKeyDown = (character: Character) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelectNode(character);
    }
  };

  const hoverNode = (id: string | null) => () => setHoveredId(id);

  /** Canvas pointer down */
  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && e.isPrimary === false) return;
    didDragRef.current = false;
    isDraggingCanvasRef.current = true;
    canvasDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startViewX: viewRef.current.x,
      startViewY: viewRef.current.y,
    };
    setDraggingCanvas(true);
  };

  /** Node pointer down */
  const handleNodePointerDown = (c: Character, e: React.PointerEvent) => {
    e.stopPropagation();
    didDragRef.current = false;
    isDraggingNodeRef.current = true;
    activeNodeIdRef.current = c.id;

    const pos = positions[c.id] ?? { x: c.x, y: c.y };
    nodeDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startNodeX: pos.x,
      startNodeY: pos.y,
    };
    setDraggingNodeId(c.id);
  };

  const zoomBy = (factor: number) => {
    setInstant(false);
    setView((v) => {
      const nextK = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      const cx = VIEW_W / 2;
      const cy = VIEW_H / 2;
      return {
        x: cx - ((cx - v.x) * nextK) / v.k,
        y: cy - ((cy - v.y) * nextK) / v.k,
        k: nextK,
      };
    });
  };

  const resetView = () => {
    setInstant(false);
    setView({ x: 0, y: 0, k: 1 });
  };

  // Filter & search matches
  const activeChar = selectedCharacterId ? byId.get(selectedCharacterId) : null;
  const dimmed = hoveredId !== null || activeChar !== null;

  const searchLower = searchQuery.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!searchLower) return new Set<string>();
    const set = new Set<string>();
    for (const c of CHARACTERS) {
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
  }, [searchLower]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none transition-colors duration-300 ${
        isDark
          ? "bg-slate-950 text-white rounded-2xl border border-slate-800 shadow-2xl"
          : "bg-surface text-ink rounded-2xl border border-slate-200/80 shadow-card"
      } ${className}`}
    >
      {/* Floating Canvas Action Dock (Bottom Left - Obsidian / Figma style) */}
      <div
        className={cn(
          "absolute z-30 pointer-events-auto flex items-center gap-1 rounded-full border p-1.5 shadow-xl backdrop-blur-md transition-all duration-300",
          selectedCharacterId && isMobile
            ? "bottom-[calc(48vh+12px)] left-3"
            : "bottom-6 left-4 sm:left-6",
          isDark ? "border-slate-700/80 bg-slate-900/95" : "border-slate-200/90 bg-white/95"
        )}
      >
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            isDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-ink-dim hover:bg-surface-muted hover:text-accent"
          }`}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out (-)"
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            isDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-ink-dim hover:bg-surface-muted hover:text-accent"
          }`}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label="Reset view"
          title="Reset View"
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            isDark ? "text-slate-300 hover:bg-slate-800 hover:text-white" : "text-ink-dim hover:bg-surface-muted hover:text-accent"
          }`}
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <div className={`h-4 w-px my-auto ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

        {/* Theme Toggle (Light / Dark Mode) */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              isDark ? "text-amber-400 hover:bg-slate-800" : "text-slate-600 hover:bg-surface-muted hover:text-accent"
            }`}
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          </button>
        )}
      </div>

      {/* Search results dropdown suggestions */}
      {searchQuery && searchMatches.size > 0 && (
        <div className={`absolute top-14 left-3 z-40 max-h-60 w-56 sm:w-64 overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur-md ${
          isDark ? "border-slate-800 bg-slate-900/95 text-white" : "border-slate-200 bg-white/98 text-ink"
        }`}>
          {Array.from(searchMatches).map((id) => {
            const char = byId.get(id);
            if (!char) return null;
            return (
              <button
                key={char.id}
                type="button"
                onClick={() => {
                  handleSelectNode(char);
                  setSearchQuery("");
                }}
                className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  isDark ? "hover:bg-slate-800" : "hover:bg-surface-muted"
                }`}
              >
                <span className="text-xs font-semibold">{char.name}</span>
                <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-ink-dim"}`}>{char.role}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Interactive Canvas */}
      <MotionConfig reducedMotion="user">
        <svg
          ref={svgRef}
          viewBox="0 0 2000 1400"
          className={`h-full w-full touch-none select-none ${
            draggingCanvas ? "cursor-grabbing" : draggingNodeId ? "cursor-grabbing" : "cursor-grab"
          }`}
          aria-label="Detective Conan character relationship web"
          onPointerDown={handleCanvasPointerDown}
        >
          {/* Dot matrix pattern */}
          <defs>
            <pattern id="dotGrid" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="15" cy="15" r="1.2" fill={isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.08)"} />
            </pattern>
          </defs>

          <rect width="2000" height="1400" fill="url(#dotGrid)" />

          {/* World Pan/Zoom Wrapper. Pins scale origin to (0,0) so target Math centers nodes exactly */}
          <g
            transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}
            style={{
              transformOrigin: "0px 0px",
              transition: draggingCanvas || draggingNodeId || instant ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Transparent hit area */}
            <rect width="2000" height="1400" fill="transparent" />

            <motion.g variants={containerVariants} initial={reduce ? "show" : "hidden"} animate="show">
              {/* Relationship Strings */}
              {strings.map(({ rel, d }) => {
                const meta = RELATIONSHIP_META[rel.type];
                if (activeFilter && rel.type !== activeFilter) return null;

                const isTarget = hoveredId === rel.source || hoveredId === rel.target || selectedCharacterId === rel.source || selectedCharacterId === rel.target;
                const matchesSearch = searchMatches.size === 0 || searchMatches.has(rel.source) || searchMatches.has(rel.target);

                const currentOpacity = dimmed ? (isTarget ? 1 : DIM_OPACITY) : matchesSearch ? 0.85 : (isDark ? 0.25 : 0.2);

                return (
                  <motion.g key={rel.id} variants={stringVariants}>
                    <path
                      d={d}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={isTarget ? STRING_WIDTH + 1.2 : STRING_WIDTH}
                      strokeLinecap="round"
                      opacity={currentOpacity}
                      style={{ transition: "opacity 200ms ease, stroke-width 200ms ease" }}
                    >
                      <title>{`${meta.label}: ${rel.detail}`}</title>
                    </path>
                  </motion.g>
                );
              })}

              {/* Character Nodes */}
              {CHARACTERS.map((c) => {
                const pos = positions[c.id] ?? { x: c.x, y: c.y };
                const degree = degreeByCharacter.get(c.id) ?? 0;
                const isSelected = selectedCharacterId === c.id;
                const isHovered = hoveredId === c.id;
                const isSearchMatch = searchMatches.has(c.id);

                return (
                  <motion.g
                    key={c.id}
                    variants={nodeVariants}
                    style={{ transformOrigin: "0px 0px" }}
                  >
                    <g
                      transform={`translate(${pos.x}, ${pos.y})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Node: ${c.name}, ${degree} relationships`}
                      className="group cursor-pointer outline-none"
                      onPointerDown={(e) => handleNodePointerDown(c, e)}
                      onClick={(e) => {
                        if (didDragRef.current) {
                          didDragRef.current = false;
                          return;
                        }
                        handleSelectNode(c);
                      }}
                      onKeyDown={handleNodeKeyDown(c)}
                      onMouseEnter={draggingCanvas || draggingNodeId ? undefined : hoverNode(c.id)}
                      onMouseLeave={draggingCanvas || draggingNodeId ? undefined : hoverNode(null)}
                      onFocus={hoverNode(c.id)}
                      onBlur={hoverNode(null)}
                    >
                      {/* Outer pulse / glow ring when selected or search match */}
                      {(isSelected || isSearchMatch) && (
                        <circle
                          r={NODE_RADIUS + 9}
                          fill="none"
                          stroke={isSelected ? (isDark ? "#EF4444" : "#DC2626") : (isDark ? "#3B82F6" : "#2563EB")}
                          strokeWidth={2}
                          className="animate-pulse"
                        />
                      )}

                      {/* Hover ring */}
                      <circle
                        r={NODE_RADIUS + 5}
                        fill="none"
                        stroke={isDark ? "#64748B" : "#94A3B8"}
                        strokeWidth={1.5}
                        className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      />

                      {/* Main Node Circle */}
                      <circle
                        r={NODE_RADIUS}
                        fill={isSelected ? (isDark ? "#EF4444" : "#DC2626") : (isDark ? "#0F172A" : "#FFFFFF")}
                        stroke={isSelected ? (isDark ? "#FFFFFF" : "#DC2626") : isHovered ? (isDark ? "#38BDF8" : "#DC2626") : (isDark ? "#E2E8F0" : "#0F172A")}
                        strokeWidth={isSelected ? 3 : 2}
                        className="transition-colors duration-200 shadow-md"
                      />

                      {/* Inner dot */}
                      <circle
                        r={3.5}
                        fill={isSelected ? "#FFFFFF" : isHovered ? (isDark ? "#38BDF8" : "#DC2626") : (isDark ? "#94A3B8" : "#64748B")}
                      />

                      {/* Character Label */}
                      <g transform="translate(0, 28)">
                        <text
                          textAnchor="middle"
                          className="select-none text-[13px] font-semibold font-display tracking-tight"
                          style={{
                            fill: isSelected ? (isDark ? "#EF4444" : "#DC2626") : isSearchMatch ? (isDark ? "#38BDF8" : "#2563EB") : (isDark ? "#F8FAFC" : "#0F172A"),
                            paintOrder: "stroke",
                            stroke: isDark ? "#020617" : "#FFFFFF",
                            strokeWidth: "4px",
                            strokeLinejoin: "round",
                          }}
                        >
                          {c.name.split("/")[0].trim()}
                        </text>
                      </g>
                    </g>
                  </motion.g>
                );
              })}
            </motion.g>
          </g>
        </svg>
      </MotionConfig>
    </div>
  );
}
