"use client";

/*
  CharactersWeb — Obsidian-inspired interactive red-strings SVG graph view.

  Features:
  - Obsidian Graph View Aesthetic: Neon glowing edges, faction color coding, ambient particles
  - Characteristic Node Sizing: Conan Edogawa central hub (r=26), Major Leads (r=20), Supporting (r=16), Standard (r=11-15)
  - Centered Conan Edogawa: Conan placed at center (1000, 700) with 1-click Center Conan action
  - Faction Legend Filter Bar: Interactive color chips to highlight factions
  - Draggable nodes: move character circles freely with real-time curved strings
  - Touch pan, pinch zoom, search dropdown & mobile drawer integration
*/

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
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
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  X,
  Sun,
  Moon,
  Target,
  Sparkles,
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

export interface FactionTheme {
  primary: string;
  glow: string;
  darkFill: string;
  lightFill: string;
  border: string;
  badge: string;
}

export const FACTION_THEMES: Record<string, FactionTheme> = {
  "Junior Detective League": {
    primary: "#0EA5E9",
    glow: "rgba(14, 165, 233, 0.5)",
    darkFill: "#0369A1",
    lightFill: "#E0F2FE",
    border: "#38BDF8",
    badge: "Protagonists",
  },
  "Kudo Family": {
    primary: "#0284C7",
    glow: "rgba(2, 132, 199, 0.5)",
    darkFill: "#075985",
    lightFill: "#E0F2FE",
    border: "#38BDF8",
    badge: "Kudo Family",
  },
  "Black Organization": {
    primary: "#EF4444",
    glow: "rgba(239, 68, 68, 0.6)",
    darkFill: "#7F1D1D",
    lightFill: "#FEE2E2",
    border: "#F87171",
    badge: "Black Organization",
  },
  "Tokyo Metropolitan Police": {
    primary: "#F59E0B",
    glow: "rgba(245, 158, 11, 0.5)",
    darkFill: "#78350F",
    lightFill: "#FEF3C7",
    border: "#FBBF24",
    badge: "Police Department",
  },
  "Osaka Police": {
    primary: "#F97316",
    glow: "rgba(249, 115, 22, 0.5)",
    darkFill: "#7C2D12",
    lightFill: "#FFEDD5",
    border: "#FB923C",
    badge: "Osaka Police",
  },
  "FBI": {
    primary: "#8B5CF6",
    glow: "rgba(139, 92, 246, 0.5)",
    darkFill: "#581C87",
    lightFill: "#F3E8FF",
    border: "#C084FC",
    badge: "FBI / Security",
  },
  "Public Security Bureau": {
    primary: "#A855F7",
    glow: "rgba(168, 85, 247, 0.5)",
    darkFill: "#6D28D9",
    lightFill: "#F3E8FF",
    border: "#D8B4FE",
    badge: "Public Security",
  },
  "Osaka / Hattori Household": {
    primary: "#F97316",
    glow: "rgba(249, 115, 22, 0.5)",
    darkFill: "#9A3412",
    lightFill: "#FFEDD5",
    border: "#FB923C",
    badge: "Osaka Sleuths",
  },
  "Phantom Thief Kid": {
    primary: "#6366F1",
    glow: "rgba(99, 102, 241, 0.5)",
    darkFill: "#312E81",
    lightFill: "#E0E7FF",
    border: "#818CF8",
    badge: "Kaitou Kid",
  },
  "Phantom Thief Cast": {
    primary: "#6366F1",
    glow: "rgba(99, 102, 241, 0.5)",
    darkFill: "#312E81",
    lightFill: "#E0E7FF",
    border: "#818CF8",
    badge: "Magic Kaito",
  },
  "Suzuki Family": {
    primary: "#EC4899",
    glow: "rgba(236, 72, 153, 0.4)",
    darkFill: "#831843",
    lightFill: "#FCE7F3",
    border: "#F472B6",
    badge: "Suzuki Family",
  },
  "Mouri Family": {
    primary: "#14B8A6",
    glow: "rgba(20, 184, 166, 0.4)",
    darkFill: "#115E59",
    lightFill: "#CCFBF1",
    border: "#2DD4BF",
    badge: "Mouri Family",
  },
  "Mouri Detective Agency": {
    primary: "#14B8A6",
    glow: "rgba(20, 184, 166, 0.4)",
    darkFill: "#115E59",
    lightFill: "#CCFBF1",
    border: "#2DD4BF",
    badge: "Mouri Agency",
  },
  DEFAULT: {
    primary: "#38BDF8",
    glow: "rgba(56, 189, 248, 0.4)",
    darkFill: "#0369A1",
    lightFill: "#E0F2FE",
    border: "#7DD3FC",
    badge: "Civilians & Allies",
  },
};

export function getFactionTheme(affiliation: string): FactionTheme {
  for (const [key, theme] of Object.entries(FACTION_THEMES)) {
    if (key !== "DEFAULT" && affiliation.toLowerCase().includes(key.toLowerCase())) {
      return theme;
    }
  }
  return FACTION_THEMES.DEFAULT;
}

/** Node Sizing based on character characteristics & importance */
function getNodeRadius(c: Character, degree: number): number {
  if (c.id === "conan-edogawa") return 26; // Main Hero / Central Hub
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
    return 20; // Major Core Leads
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
    return 16; // Important Supporting Cast
  }
  return Math.min(11 + Math.min(degree * 0.6, 5), 15); // Standard Characters
}

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
  theme = "dark",
  onToggleTheme,
  className = "",
}: CharactersWebProps) {
  const reduce = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [pad, setPad] = useState(0);
  const viewBoxW = VIEW_W + 2 * pad;
  const padRef = useRef(pad);

  useEffect(() => {
    padRef.current = pad;
  }, [pad]);

  useEffect(() => {
    const recomputePad = () => {
      const aspect = window.innerWidth / window.innerHeight;
      setPad(aspect > VIEW_W / VIEW_H ? ((aspect - VIEW_W / VIEW_H) * VIEW_H) / 2 : 0);
    };
    recomputePad();
    window.addEventListener("resize", recomputePad);
    return () => window.removeEventListener("resize", recomputePad);
  }, []);

  const isDark = theme === "dark";

  // Mutable node positions
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

  /** Pan/zoom view state */
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [draggingCanvas, setDraggingCanvas] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [instant, setInstant] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const isDraggingCanvasRef = useRef(false);
  const canvasDragStartRef = useRef<{ clientX: number; clientY: number; startViewX: number; startViewY: number } | null>(null);

  const isDraggingNodeRef = useRef(false);
  const activeNodeIdRef = useRef<string | null>(null);
  const nodeDragStartRef = useRef<{ clientX: number; clientY: number; startNodeX: number; startNodeY: number } | null>(null);

  /** Window pointer listeners */
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
          const svgDx = (dx / rect.width) * (VIEW_W + 2 * padRef.current) / currentK;
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

          const svgDx = (dx / rect.width) * (VIEW_W + 2 * padRef.current);
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

      const cx = ((e.clientX - rect.left) / rect.width) * (VIEW_W + 2 * padRef.current) - padRef.current;
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

  /** Zoom into exact coordinate (wx, wy) */
  const zoomToPoint = (wx: number, wy: number, targetK: number = ZOOM_TO_NODE) => {
    setInstant(false);
    const targetYCenter = isMobile ? VIEW_H * 0.32 : VIEW_H / 2;
    setView({
      x: VIEW_W / 2 - wx * targetK,
      y: targetYCenter - wy * targetK,
      k: targetK,
    });
  };

  /** Center view on Conan Edogawa (the main character circle at 1000, 700) */
  const centerOnConan = () => {
    setInstant(false);
    const conanPos = positions["conan-edogawa"] ?? { x: 1000, y: 700 };
    zoomToPoint(conanPos.x, conanPos.y, 1.0);
  };

  /** Explicitly center on Conan Edogawa on initial mount */
  useEffect(() => {
    centerOnConan();
  }, []);

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
    centerOnConan();
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
          ? "bg-[#0B0F19] text-white rounded-2xl border border-slate-800/80 shadow-2xl"
          : "bg-[#F8FAFC] text-ink rounded-2xl border border-slate-200/90 shadow-card"
      } ${className}`}
    >

      {/* Floating Canvas Action Dock (Bottom Left - Obsidian style) */}
      <div
        className={cn(
          "absolute z-30 pointer-events-auto flex items-center gap-1 rounded-full border p-1.5 shadow-xl backdrop-blur-md transition-all duration-300",
          selectedCharacterId && isMobile
            ? "bottom-[calc(48vh+12px)] left-3"
            : "bottom-6 left-4 sm:left-6",
          isDark ? "border-slate-800/80 bg-slate-950/90" : "border-slate-200/90 bg-white/95"
        )}
      >
        <button
          type="button"
          onClick={centerOnConan}
          aria-label="Center on Conan Edogawa"
          title="Center on Conan Edogawa"
          className={cn(
            "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-display font-medium transition-colors",
            isDark ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25" : "bg-cyan-50 text-cyan-600 hover:bg-cyan-100"
          )}
        >
          <Target className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Center Conan</span>
        </button>

        <div className={`h-4 w-px my-auto ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

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

        {onToggleTheme && (
          <>
            <div className={`h-4 w-px my-auto ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />
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
          </>
        )}
      </div>

      {/* Search input (top-left) */}
      <div className="absolute top-4 left-4 z-40 pointer-events-auto">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 shadow-xl backdrop-blur-md transition-all duration-300",
            searchFocused
              ? isDark
                ? "ring-2 ring-cyan-500/60 border-cyan-500/80"
                : "ring-2 ring-cyan-400/70 border-cyan-400/90"
              : "",
            isDark ? "border-slate-800/90 bg-slate-950/90" : "border-slate-200/90 bg-white/95"
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                setSearchFocused(false);
                e.currentTarget.blur();
              }
            }}
            placeholder="Search characters"
            aria-label="Search characters"
            className={`w-40 sm:w-48 select-text bg-transparent text-sm outline-none placeholder:text-slate-500 ${
              isDark ? "text-white" : "text-ink"
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              title="Clear search"
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                isDark ? "text-slate-400 hover:bg-slate-800 hover:text-white" : "text-ink-dim hover:bg-surface-muted hover:text-accent"
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search results dropdown suggestions */}
      {searchQuery && searchMatches.size > 0 && (
        <div className={`absolute top-14 left-4 z-40 max-h-60 w-56 sm:w-64 overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur-md ${
          isDark ? "border-slate-800 bg-slate-950/95 text-white" : "border-slate-200 bg-white/98 text-ink"
        }`}>
          {Array.from(searchMatches).map((id) => {
            const char = byId.get(id);
            if (!char) return null;
            const theme = getFactionTheme(char.affiliation);
            return (
              <button
                key={char.id}
                type="button"
                onClick={() => {
                  handleSelectNode(char);
                  setSearchQuery("");
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  isDark ? "hover:bg-slate-900" : "hover:bg-surface-muted"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: theme.primary }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{char.name}</div>
                  <div className={`text-[10px] truncate ${isDark ? "text-slate-400" : "text-ink-dim"}`}>{char.role}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Interactive SVG Canvas */}
      <MotionConfig reducedMotion="user">
        <svg
          ref={svgRef}
          viewBox={`${-pad} 0 ${viewBoxW} 1400`}
          preserveAspectRatio="xMidYMid meet"
          className={`h-full w-full touch-none select-none ${
            draggingCanvas ? "cursor-grabbing" : draggingNodeId ? "cursor-grabbing" : "cursor-grab"
          }`}
          aria-label="Detective Conan character relationship graph"
          onPointerDown={handleCanvasPointerDown}
        >
          <defs>
            {/* Obsidian Dot matrix pattern */}
            <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle
                cx="12"
                cy="12"
                r={isDark ? 1.3 : 1.6}
                fill={isDark ? "rgba(255, 255, 255, 0.12)" : "#94A3B8"}
                opacity={isDark ? 1 : 0.55}
              />
            </pattern>
          </defs>

          {/* Background pattern */}
          <rect x={-pad} width={viewBoxW} height="1400" fill={isDark ? "transparent" : "#F8FAFC"} />
          <rect x={-pad} width={viewBoxW} height="1400" fill="url(#dotGrid)" />

          {/* World Pan/Zoom Wrapper */}
          <g
            transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}
            style={{
              transformOrigin: "0px 0px",
              transition: draggingCanvas || draggingNodeId || instant ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Transparent hit area */}
            <rect width="2000" height="1400" fill="transparent" />

            <motion.g variants={containerVariants} initial={reduce ? "show" : "hidden"} animate="show">
              {/* Relationship Strings */}
              {strings.map(({ rel, d }) => {
                const meta = RELATIONSHIP_META[rel.type];
                if (activeFilter && rel.type !== activeFilter) return null;

                const isTarget =
                  hoveredId === rel.source ||
                  hoveredId === rel.target ||
                  selectedCharacterId === rel.source ||
                  selectedCharacterId === rel.target;

                const matchesSearch = searchMatches.size === 0 || searchMatches.has(rel.source) || searchMatches.has(rel.target);

                const currentOpacity = dimmed
                  ? (isTarget ? 1 : DIM_OPACITY)
                  : matchesSearch ? 0.85 : (isDark ? 0.35 : 0.25);

                return (
                  <motion.g key={rel.id} variants={stringVariants}>
                    <path
                      d={d}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={isTarget ? STRING_WIDTH + 1.8 : STRING_WIDTH}
                      strokeLinecap="round"
                      opacity={currentOpacity}
                      style={{ transition: "opacity 200ms ease, stroke-width 200ms ease" }}
                    />
                  </motion.g>
                );
              })}

              {/* Character Nodes */}
              {CHARACTERS.map((c, idx) => {
                const pos = positions[c.id] ?? { x: c.x, y: c.y };
                const degree = degreeByCharacter.get(c.id) ?? 0;
                const radius = getNodeRadius(c, degree);
                const factionTheme = getFactionTheme(c.affiliation);

                const isSelected = selectedCharacterId === c.id;
                const isHovered = hoveredId === c.id;
                const isSearchMatch = searchMatches.has(c.id);
                const isConan = c.id === "conan-edogawa";

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
                      onClick={() => {
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
                      {/* Animated pulsing wave ripple ring for Conan Edogawa */}
                      {isConan && (
                        <motion.circle
                          r={radius + 12}
                          fill="none"
                          stroke={factionTheme.primary}
                          strokeWidth={2}
                          animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.1, 0.6] }}
                          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}

                      {/* Gentle organic breathing motion ring for all nodes */}
                      <motion.circle
                        r={radius + 3}
                        fill="none"
                        stroke={factionTheme.border}
                        strokeWidth={1}
                        animate={{ scale: [1, 1.12, 1], opacity: [0.25, 0.65, 0.25] }}
                        transition={{
                          duration: 3 + (idx % 3) * 0.8,
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: (idx * 0.2) % 2,
                        }}
                      />
                      {/* Outer Glow Halo ring for Conan or Selected / Hovered */}
                      {(isConan || isSelected || isHovered || isSearchMatch) && (
                        <circle
                          r={radius + 12}
                          fill={factionTheme.glow}
                          className={isConan || isSelected ? "animate-pulse opacity-80" : "opacity-50"}
                        />
                      )}

                      {/* Selection / Search match ring */}
                      {(isSelected || isSearchMatch) && (
                        <circle
                          r={radius + 7}
                          fill="none"
                          stroke={isSelected ? "#FFFFFF" : factionTheme.border}
                          strokeWidth={2}
                        />
                      )}

                      {/* Hover ring */}
                      <circle
                        r={radius + 5}
                        fill="none"
                        stroke={factionTheme.border}
                        strokeWidth={1.5}
                        className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      />

                      {/* Main Node Circle (Dynamic Radius based on Characteristics) */}
                      <circle
                        r={radius}
                        fill={
                          isSelected
                            ? factionTheme.primary
                            : isDark
                              ? factionTheme.darkFill
                              : factionTheme.lightFill
                        }
                        stroke={
                          isSelected
                            ? "#FFFFFF"
                            : isHovered
                              ? "#FFFFFF"
                              : factionTheme.border
                        }
                        strokeWidth={isConan ? 3.5 : isSelected ? 3 : 2}
                        className="transition-colors duration-200 shadow-lg"
                      />

                      {/* Core Inner Indicator Dot */}
                      <circle
                        r={isConan ? 6 : radius > 16 ? 4.5 : 3.5}
                        fill={
                          isSelected
                            ? "#FFFFFF"
                            : isHovered
                              ? "#FFFFFF"
                              : factionTheme.primary
                        }
                      />

                      {/* Character Label */}
                      <g transform={`translate(0, ${radius + 15})`}>
                        <text
                          textAnchor="middle"
                          className={cn(
                            "select-none font-display tracking-tight transition-all",
                            isConan ? "text-[14px] font-extrabold" : radius > 16 ? "text-[13px] font-bold" : "text-[12px] font-semibold"
                          )}
                          style={{
                            fill: isSelected
                              ? "#FFFFFF"
                              : isHovered
                                ? (isDark ? "#FFFFFF" : "#0F172A")
                                : (isDark ? "#F8FAFC" : "#0F172A"),
                            paintOrder: "stroke",
                            stroke: isDark ? "#090D16" : "#FFFFFF",
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
