"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { X } from "lucide-react";
import { RELATIONSHIP_META, getCharacterById, getCharacterImage } from "@/lib/characters-guide";
import type { Character, Relationship, RelationshipType } from "@/lib/characters-guide";
import { getRelationshipColor } from "@/components/characters/graph-theme";
import { useTheme } from "@/components/theme-provider";
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
}: {
  character: Character | null;
  relationships: Relationship[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const isOpen = character !== null;

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

  if (!character) return null;

  const threads = relationships.map((relationship) => {
    const otherId =
      relationship.source === character.id ? relationship.target : relationship.source;
    const other = getCharacterById(otherId);
    return {
      relationship,
      meta: RELATIONSHIP_META[relationship.type],
      color: getRelationshipColor(relationship.type, isDark),
      otherName: other?.name ?? otherId,
    };
  });

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label={character.name}
        tabIndex={-1}
        initial={{ opacity: 0, y: 48, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="dossier-card relative flex max-h-[48vh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface/95 p-0 shadow-card outline-none backdrop-blur-xl sm:max-h-[85vh] sm:rounded-2xl sm:border"
      >
        {/* Accent hairline that sweeps in on open */}
        <span
          aria-hidden
          className="dcph-underline-sweep absolute left-0 right-0 top-0 z-30 h-[2px] bg-gradient-to-r from-accent via-accent-bright to-transparent"
        />

        <div className="flex w-full shrink-0 justify-center bg-surface/95 pb-1 pt-2.5 sm:hidden">
          <div className="h-1.5 w-12 rounded-full bg-line" />
        </div>

        <div className="sticky top-0 z-20 flex shrink-0 items-start justify-between gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-md sm:p-5">
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

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-left sm:p-5">
          {/* Character portrait */}
          {getCharacterImage(character.id) && (
            <div className="flex justify-center">
              <img
                src={getCharacterImage(character.id)!}
                alt={character.name}
                className="h-32 w-32 rounded-xl border border-line object-cover shadow-card sm:h-40 sm:w-40"
              />
            </div>
          )}

          <p className="text-xs leading-relaxed text-ink-dim sm:text-sm">{character.bio}</p>

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