"use client";

/*
  CharactersWeb — the interactive red-strings SVG graph.

  Renders Detective Conan characters as nodes on a fixed 1000×600 canvas and
  their relationships as curved colored strings. Relationship type → color is
  taken from RELATIONSHIP_META; multi-type pairs between the same two nodes are
  separated with a small perpendicular arc offset so parallel strings don't
  overlap. Node styling follows the dossier tokens in tailwind.config.ts
  (surface #FFFFFF fill, ink #0F172A stroke); string colors come from the data
  module.

  The graph is fully declarative (no window/document at module scope) and
  hydration-safe: useMediaQuery returns a desktop default on first render and
  only resolves the real viewport inside useEffect, so SSR + first client
  render agree. On ≤767px this component renders null and the page's card-grid
  fallback takes over.
*/

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
} from "@/lib/characters-guide";

/**
 * Hydration-safe matchMedia hook.
 *
 * Returns the default (`true`) on the first render — including SSR and the
 * first client render — so server and client HTML always agree. The real
 * value is resolved in useEffect after mount and kept in sync via a change
 * listener. Never initializes state from `matchMedia` at first render.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(true);

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
  show: { transition: { staggerChildren: 0.04 } },
};

const stringVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.7, ease: EASE } },
};

const nodeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
};

/** Canvas + dossier geometry */
const NODE_RADIUS = 12;
const STRING_WIDTH = 2;
/** Opacity applied to strings that don't touch the hovered node */
const DIM_OPACITY = 0.12;
/** Base perpendicular bow (px) so single strings read as a gentle curve */
const BASE_BOW = 6;
/** Extra perpendicular gap (px) between parallel strings of one pair */
const PARALLEL_GAP = 24;

/** Canonical key for a pair of nodes, so multi-type edges group together */
function pairKey(r: Relationship): string {
  return [r.source, r.target].sort().join("|");
}

/**
 * Quadratic bezier between two nodes with a small perpendicular arc offset.
 * offsetIndex is centered around 0 for the group of relationships sharing the
 * same node pair, so parallel strings separate instead of overlapping.
 */
function buildStringD(
  source: Character,
  target: Character,
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
  onSelectCharacter: (character: Character) => void;
}

export default function CharactersWeb({
  onSelectCharacter,
}: CharactersWebProps) {
  const reduce = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /** Lookup map + per-pair parallel offsets, derived once per data payload */
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
      const key = pairKey(r);
      const total = counts.get(key) ?? 1;
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      strings.push({
        rel: r,
        d: buildStringD(source, target, index - (total - 1) / 2),
      });
    }

    const degreeByCharacter = new Map<string, number>();
    for (const c of CHARACTERS) degreeByCharacter.set(c.id, 0);
    for (const r of RELATIONSHIPS) {
      degreeByCharacter.set(r.source, (degreeByCharacter.get(r.source) ?? 0) + 1);
      degreeByCharacter.set(r.target, (degreeByCharacter.get(r.target) ?? 0) + 1);
    }

    return { byId, strings, degreeByCharacter };
  }, []);

  /** Mobile: the page's card-grid fallback takes over */
  if (isMobile) return null;

  const dimmed = hoveredId !== null;

  const handleNodeKeyDown = (character: Character) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectCharacter(character);
    }
  };

  const hoverNode = (id: string | null) => () => setHoveredId(id);

  return (
    <div className="w-full">
      <MotionConfig reducedMotion="user">
        <svg
          viewBox="0 0 1000 600"
          className="h-auto w-full"
          aria-label="Detective Conan character relationship web"
        >
          <motion.g
            variants={containerVariants}
            initial={reduce ? "show" : "hidden"}
            animate="show"
          >
            {/* Strings — one curved path per relationship */}
            {strings.map(({ rel, d }) => {
              const meta = RELATIONSHIP_META[rel.type];
              const touchesHovered =
                dimmed &&
                (rel.source === hoveredId || rel.target === hoveredId);
              return (
                <motion.g key={rel.id} variants={stringVariants}>
                  <path
                    d={d}
                    fill="none"
                    stroke={meta.color}
                    strokeWidth={STRING_WIDTH}
                    strokeLinecap="round"
                    opacity={dimmed ? (touchesHovered ? 1 : DIM_OPACITY) : 1}
                    style={{ transition: "opacity 200ms ease" }}
                  >
                    <title>{`${meta.label}: ${rel.detail}`}</title>
                  </path>
                </motion.g>
              );
            })}

            {/* Nodes — one group per character */}
            {CHARACTERS.map((c) => {
              const degree = degreeByCharacter.get(c.id) ?? 0;
              const relWord = degree === 1 ? "relationship" : "relationships";
              return (
                <motion.g
                  key={c.id}
                  variants={nodeVariants}
                  style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
                >
                  <g
                    transform={`translate(${c.x}, ${c.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Node: ${c.name}, ${degree} ${relWord}`}
                    className="group cursor-pointer outline-none"
                    onClick={() => onSelectCharacter(c)}
                    onKeyDown={handleNodeKeyDown(c)}
                    onMouseEnter={hoverNode(c.id)}
                    onMouseLeave={hoverNode(null)}
                    onFocus={hoverNode(c.id)}
                    onBlur={hoverNode(null)}
                  >
                    {/* Keyboard focus ring (dashed accent, focus-visible only) */}
                    <circle
                      r={NODE_RADIUS + 6}
                      fill="none"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      className="stroke-accent opacity-0 transition-opacity duration-200 group-focus-visible:opacity-100"
                    />
                    {/* Node body — dossier surface fill, ink stroke */}
                    <circle
                      r={NODE_RADIUS}
                      fill="#FFFFFF"
                      stroke="#0F172A"
                      strokeWidth={2}
                      className="transition-colors duration-200 hover:stroke-accent"
                    />
                    {/* Label below the node, haloed with the surface color for
                        legibility over crossing strings */}
                    <g transform="translate(0, 30)">
                      <text
                        textAnchor="middle"
                        transform="scale(1.15)"
                        className="select-none"
                        style={{
                          fontFamily: "var(--font-body), sans-serif",
                          fontSize: "16px",
                          fontWeight: 600,
                          fill: "#0F172A",
                          paintOrder: "stroke",
                          stroke: "#FFFFFF",
                          strokeWidth: "4px",
                          strokeLinejoin: "round",
                        }}
                      >
                        {c.name}
                      </text>
                    </g>
                  </g>
                </motion.g>
              );
            })}
          </motion.g>
        </svg>
      </MotionConfig>
    </div>
  );
}
