"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { animate, motion, MotionConfig, useMotionValue, type Variants } from "framer-motion";
import { X } from "lucide-react";
import { RELATIONSHIP_META, getCharacterById, getRelationshipById, getCharacterImage } from "@/lib/characters-guide";
import type { Character, Relationship, RelationshipType } from "@/lib/characters-guide";
import { getRelationshipColor } from "@/components/characters/graph-theme";
import { useTheme } from "@/components/theme-provider";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const RELATIONSHIP_TYPES: RelationshipType[] = [
  "romance",
  "family",
  "friendship",
  "rivalry",
  "mentor",
  "colleague",
  "secret_identity",
  "adversary",
];

const threadList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.08 } },
};

const threadItem: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE } },
};

/*
 * Mobile sheet snap model
 * -----------------------
 * The sheet is a fixed-height slab (SHEET_VH of the small viewport, svh so the
 * mobile URL bar doesn't shift it) whose vertical position is a TRANSFORM
 * (motion value y). Snapping moves the transform only — never layout — so
 * dragging animates on the compositor and costs ~nothing on cheap phones.
 *
 *   snap    visible height    y (% of slab height)
 *   full    SHEET_VH          0%
 *   half    48svh             (SHEET_VH − 48) / SHEET_VH
 *   peek    30svh             (SHEET_VH − 30) / SHEET_VH
 *   closed  0                 100% (+ fade)
 *
 * The grabber bar and the header are the drag surface; the body scrolls and
 * never fights the drag (touch-action:none on the chrome, default on body).
 * Desktop (sm+) is the untouched absolutely-positioned card: y is pinned to 0
 * and all drag logic is inert.
 */
const SHEET_VH = 85;
const SNAP_VH = { peek: 30, half: 48, full: SHEET_VH } as const;
type Snap = keyof typeof SNAP_VH;
export type SheetSnap = Snap;

const SPRING = { type: "spring", stiffness: 320, damping: 30 } as const;

/** Release velocity (px/s) above which a release counts as a fling. */
const FLING_PX_PER_S = 500;
/** Overdrag below the peek position (px) that dismisses the sheet. */
const DISMISS_OVERDRAG_PX = 56;
/** A "tap" on the handle only counts if the finger barely moved. */
const TAP_MAX_DRAG_PX = 6;

/**
 * CharacterDetailPanel — the character dossier beside the graph. Thread dot
 * colors come from the shared resolver, so a thread's color always matches
 * the string drawn in the graph, in both themes.
 *
 * Crimson text and icons use accent-bright rather than accent: the plain
 * accent (#C8102E) is only ~3.3:1 against the near-black surface, while
 * accent-bright clears 4.5:1.
 */
export function CharacterDetailPanel({
  character,
  relationships,
  onClose,
  onSnapChange,
}: {
  character: Character | null;
  relationships: Relationship[];
  onClose: () => void;
  /** Mobile only — fires with the settled snap ("peek" | "half" | "full"). */
  onSnapChange?: (snap: SheetSnap) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const isOpen = character !== null;

  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startClientY: number;
    lastClientY: number;
    lastT: number;
    vy: number;
    moved: boolean;
    toggleOnTap: boolean;
  } | null>(null);

  /* ── mobile sheet: snap state + the y motion value ──────────── */
  const [snap, setSnap] = useState<Snap>("peek");
  // Sync matchMedia: correct on the very first client render, so the initial
  // y is right with no flash (desktop 0, mobile fully below the viewport).
  const isMobile = useMediaQuery("(max-width: 639px)");
  // y is a px motion value driven directly (drag math, springs, entrance);
  // snap offsets are measured from the live slab height via snapPointsPx.
  const y = useMotionValue(0);

  /** Snap positions in px, measured from the live slab height. */
  const snapPointsPx = useCallback(() => {
    const h = panelRef.current?.offsetHeight || 1;
    return {
      full: 0,
      half: ((SHEET_VH - SNAP_VH.half) / SHEET_VH) * h,
      peek: ((SHEET_VH - SNAP_VH.peek) / SHEET_VH) * h,
      closed: h,
    };
  }, []);

  /** Commit a snap: state + parent inset + animated transform. */
  const animateSnap = useCallback(
    (next: Snap) => {
      setSnap(next);
      onSnapChange?.(next);
      const b = snapPointsPx();
      animate(y, b[next], SPRING);
    },
    [onSnapChange, snapPointsPx, y]
  );

  // Entrance: on mobile the slab slides up from below the viewport; on
  // desktop y is pinned at 0 and the old opacity/scale entrance plays.
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (!isMobile) {
      y.set(0);
      return;
    }
    const b = snapPointsPx();
    y.set(window.innerHeight);
    const controls = animate(y, b.peek, SPRING);
    return () => controls.stop();
    // Mount-only intent: the panel remounts per selection (keyed upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Crossing the mobile breakpoint mid-open repositions without animation.
  useEffect(() => {
    if (!isOpen) return;
    y.set(isMobile ? snapPointsPx().peek : 0);
    if (!isMobile) setSnap("peek");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Keep the settled snap proportional to the viewport (rotation, URL bar).
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      if (dragRef.current) return;
      y.set(isMobile ? snapPointsPx()[snap] : 0);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, isMobile, snap, snapPointsPx, y]);

  /* focus management (unchanged behavior) */
  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && target.isConnected) target.focus();
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const active = document.activeElement;
      const canFocus =
        active instanceof Element &&
        active !== panelRef.current &&
        typeof (active as { focus?: () => void }).focus === "function";
      returnFocusRef.current = canFocus ? (active as HTMLElement) : null;
      panelRef.current?.focus();
    } else if (!isOpen && wasOpen.current) {
      const active = document.activeElement;
      const focusInsidePanel =
        panelRef.current !== null && panelRef.current.contains(active);
      if (active === document.body || focusInsidePanel) restoreFocus();
    }
    wasOpen.current = isOpen;
  }, [isOpen, restoreFocus]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        restoreFocus();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, restoreFocus]);

  /* ── drag-by-handle/header (mobile sheet) ───────── */

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, toggleOnTap: boolean) => {
      if (!isMobile) return;
      // Let the close button (and any future control) keep its own gesture.
      if ((e.target as HTMLElement).closest("button")) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startY: y.get(),
        startClientY: e.clientY,
        lastClientY: e.clientY,
        lastT: e.timeStamp,
        vy: 0,
        moved: false,
        toggleOnTap,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isMobile, y]
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const dy = e.clientY - d.startClientY;
      if (Math.abs(dy) > TAP_MAX_DRAG_PX) d.moved = true;

      // Velocity estimate from the last event (px/s, downward positive).
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) {
        d.vy = ((e.clientY - d.lastClientY) / dt) * 1000;
        d.lastClientY = e.clientY;
        d.lastT = e.timeStamp;
      }

      // Follow the finger with a rubber band past the hard bounds.
      const b = snapPointsPx();
      let next = d.startY + dy;
      if (next < b.full) next = b.full + (next - b.full) * 0.2;
      if (next > b.closed) next = b.closed + (next - b.closed) * 0.2;
      y.set(next);
    },
    [snapPointsPx, y]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;

      // Tap on the grabber toggles peek ↔ half (header taps do nothing).
      if (!d.moved) {
        if (d.toggleOnTap) {
          animateSnap(snap === "peek" ? "half" : "peek");
        } else {
          animateSnap(snap);
        }
        return;
      }

      const b = snapPointsPx();
      const current = y.get();
      const order: [Snap, number][] = [
        ["full", b.full],
        ["half", b.half],
        ["peek", b.peek],
      ];

      // Overdrag well past peek always dismisses.
      if (current > b.peek + DISMISS_OVERDRAG_PX) {
        onClose();
        return;
      }

      // Fling wins over proximity.
      if (Math.abs(d.vy) > FLING_PX_PER_S) {
        if (d.vy > 0) {
          // Downward: settle to the nearest snap BELOW the release point.
          const below = order
            .filter(([, py]) => py >= current + 8)
            .sort((a, b2) => a[1] - b2[1]);
          if (below.length) animateSnap(below[0][0]);
          else onClose(); // flung from the bottom-most snap → dismiss
        } else {
          // Upward: nearest snap ABOVE the release point.
          const above = order
            .filter(([, py]) => py <= current - 8)
            .sort((a, b2) => b2[1] - a[1]);
          animateSnap(above.length ? above[0][0] : "full");
        }
        return;
      }

      // No fling — nearest snap.
      let best: Snap = "peek";
      let bestDist = Infinity;
      for (const [s, py] of order) {
        const dist = Math.abs(current - py);
        if (dist < bestDist) {
          best = s;
          bestDist = dist;
        }
      }
      animateSnap(best);
    },
    [animateSnap, onClose, snap, snapPointsPx, y]
  );

  const onGrabberKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const order: Snap[] = ["peek", "half", "full"];
      const idx = order.indexOf(snap);
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        animateSnap(order[Math.min(order.length - 1, idx + 1)]);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        animateSnap(order[Math.max(0, idx - 1)]);
      } else if (e.key === "Home") {
        e.preventDefault();
        animateSnap("full");
      } else if (e.key === "End") {
        e.preventDefault();
        animateSnap("peek");
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        animateSnap(snap === "peek" ? "half" : "peek");
      }
    },
    [animateSnap, snap]
  );

  const grabberDragProps = (toggleOnTap: boolean) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, toggleOnTap),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  if (!character) return null;

  // Resolve full character info (including bio) on demand
  const fullCharacter = getCharacterById(character.id) ?? character;

  const threads = relationships.map((relationship) => {
    const otherId =
      relationship.source === character.id ? relationship.target : relationship.source;
    const other = getCharacterById(otherId);
    const fullRel = getRelationshipById(relationship.id) ?? relationship;
    return {
      relationship: fullRel,
      meta: RELATIONSHIP_META[relationship.type],
      color: getRelationshipColor(relationship.type, isDark),
      otherName: other?.name ?? otherId,
    };
  });

  /* drag handlers were built above the early return (stable hook order). */

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label={character.name}
        tabIndex={-1}
        style={{ y }}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={
          isMobile
            ? {
                opacity: 0,
                y: typeof window !== "undefined" ? window.innerHeight : 800,
                scale: 0.985,
              }
            : { opacity: 0, y: 40, scale: 0.985 }
        }
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="dossier-card pointer-events-auto relative flex h-[85svh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface p-0 shadow-card outline-none sm:h-auto sm:max-h-[85vh] sm:rounded-2xl sm:border"
      >
        {/* Accent hairline that sweeps in on open */}
        <span
          aria-hidden
          className="dcph-underline-sweep absolute left-0 right-0 top-0 z-30 h-[2px] bg-gradient-to-r from-accent via-accent-bright to-transparent"
        />

        {/* Grabber — the drag surface on mobile. The full-width strip is the
            hit area; the visual pill keeps the original size. touch-none lets
            pointermove stream instead of the browser claiming the gesture. */}
        <div
          {...grabberDragProps(true)}
          role="slider"
          tabIndex={isMobile ? 0 : -1}
          aria-label="Dossier sheet size"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={snap === "peek" ? 1 : snap === "half" ? 2 : 3}
          aria-valuetext={snap === "peek" ? "peek" : snap === "half" ? "half" : "full"}
          onKeyDown={onGrabberKeyDown}
          className="flex w-full shrink-0 touch-none cursor-grab select-none justify-center bg-surface/95 pb-1 pt-2.5 active:cursor-grabbing sm:hidden"
        >
          <div className="h-1.5 w-12 rounded-full bg-line" />
        </div>

        {/* Header — draggable too, but a plain tap does nothing (except on
            the close button, which startDrag skips via closest("button")). */}
        <div
          {...grabberDragProps(false)}
          className="sticky top-0 z-20 flex shrink-0 touch-none select-none cursor-grab items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3 active:cursor-grabbing sm:pointer-events-auto sm:cursor-default sm:touch-auto sm:select-auto sm:p-5"
        >
          <div className="min-w-0 pr-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent-bright">
                {character.role}
              </span>
              <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                {character.affiliation}
              </span>
            </div>

            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
              className="mt-1 font-display text-lg font-bold tracking-tight text-ink sm:mt-2 sm:text-2xl"
            >
              {character.name}
            </motion.h2>

            {character.aliases && character.aliases.length > 0 && (
              <p className="mt-0.5 font-mono text-[11px] text-ink-faint sm:text-xs">
                aka {character.aliases.join(" · ")}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              restoreFocus();
              onClose();
            }}
            aria-label="Close dossier"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-dim shadow-sm transition-all hover:rotate-90 hover:border-accent/40 hover:bg-accent-soft hover:text-accent-bright"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 text-left sm:p-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          {/* Character portrait */}
          {getCharacterImage(character.id) && (
            <div className="flex justify-center">
              <Image
                src={getCharacterImage(character.id)!}
                alt={character.name}
                width={160}
                height={160}
                loading="lazy"
                className="h-32 w-32 rounded-xl border border-line object-cover shadow-card sm:h-40 sm:w-40"
              />
            </div>
          )}

          <p className="text-xs leading-relaxed text-ink-dim sm:text-sm">
            {fullCharacter.bio || character.bio}
          </p>

          <div className="border-t border-line pt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint">
              Threads ({threads.length})
            </h3>
            {threads.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">No threads on record.</p>
            ) : (
              <motion.ul
                variants={threadList}
                initial="hidden"
                animate="show"
                className="mt-3 space-y-3"
              >
                {threads.map(({ relationship, meta, color, otherName }) => (
                  <motion.li
                    key={relationship.id}
                    variants={threadItem}
                    className="group flex gap-3"
                  >
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface transition-transform duration-200 group-hover:scale-125"
                      style={{ backgroundColor: color }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-ink">
                        {meta.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-ink-dim sm:text-sm">
                        <span className="font-medium text-accent-bright">{otherName}</span>
                        <span className="mx-1.5 text-ink-faint">—</span>
                        {relationship.detail}
                      </p>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </div>
        </div>
      </motion.div>
    </MotionConfig>
  );
}

/**
 * Legend + type filter. Swatches use the same theme-aware resolver as the
 * graph edges, so chip color and string color can never drift apart.
 */
export function RelationshipLegend({
  activeFilter,
  onFilterType,
  compact = false,
}: {
  activeFilter: RelationshipType | null;
  onFilterType: (type: RelationshipType | null) => void;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={cn("grid gap-1.5", !compact && "sm:grid-cols-2")}>
      {RELATIONSHIP_TYPES.map((type) => {
        const meta = RELATIONSHIP_META[type];
        const active = activeFilter === type;
        const color = getRelationshipColor(type, isDark);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onFilterType(active ? null : type)}
            aria-pressed={active}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-200",
              active
                ? "border-accent bg-accent-soft text-accent-bright"
                : "border-line bg-surface text-ink-dim hover:-translate-y-0.5 hover:border-ink-faint/40 hover:bg-surface-muted"
            )}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: color,
                boxShadow: active ? `0 0 0 3px ${color}33` : undefined,
              }}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-xs font-semibold",
                  active ? "text-accent-bright" : "text-ink"
                )}
              >
                {meta.label}
              </span>
              {!compact && (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                  {meta.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
