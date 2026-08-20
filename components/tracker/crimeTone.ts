import {
  ArrowDown,
  Bomb,
  Cable,
  Coffee,
  Crosshair,
  Flame,
  FlaskConical,
  Gem,
  Hammer,
  Lock,
  Skull,
  Sword,
  Theater,
  UserX,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { CrimeIconName, CrimeTone } from "@/lib/crime-categories";

export const CRIME_ICONS: Record<CrimeIconName, LucideIcon> = {
  Sword,
  Hammer,
  Cable,
  FlaskConical,
  Crosshair,
  Bomb,
  Flame,
  Waves,
  ArrowDown,
  Zap,
  Wind,
  Lock,
  Theater,
  Skull,
  UserX,
  Gem,
  Coffee,
};

type ToneClasses = {
  /** Badge / chip surface. */
  chip: string;
  /** Icon colour on a neutral surface. */
  icon: string;
  /** Small accent dot. */
  dot: string;
};

/**
 * Written out literally, never interpolated — Tailwind's scanner cannot see
 * `text-${tone}-300`.
 */
export const CRIME_TONE_CLASSES: Record<CrimeTone, ToneClasses> = {
  crimson: {
    chip: "border-red-500/20 bg-red-500/10 text-red-200",
    icon: "text-red-300",
    dot: "bg-red-400",
  },
  orange: {
    chip: "border-orange-500/20 bg-orange-500/10 text-orange-200",
    icon: "text-orange-300",
    dot: "bg-orange-400",
  },
  amber: {
    chip: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    icon: "text-amber-300",
    dot: "bg-amber-400",
  },
  yellow: {
    chip: "border-yellow-500/20 bg-yellow-500/10 text-yellow-200",
    icon: "text-yellow-300",
    dot: "bg-yellow-400",
  },
  lime: {
    chip: "border-lime-500/20 bg-lime-500/10 text-lime-200",
    icon: "text-lime-300",
    dot: "bg-lime-400",
  },
  emerald: {
    chip: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    icon: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  teal: {
    chip: "border-teal-500/20 bg-teal-500/10 text-teal-200",
    icon: "text-teal-300",
    dot: "bg-teal-400",
  },
  cyan: {
    chip: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    icon: "text-cyan-300",
    dot: "bg-cyan-400",
  },
  sky: {
    chip: "border-sky-500/20 bg-sky-500/10 text-sky-200",
    icon: "text-sky-300",
    dot: "bg-sky-400",
  },
  indigo: {
    chip: "border-indigo-500/20 bg-indigo-500/10 text-indigo-200",
    icon: "text-indigo-300",
    dot: "bg-indigo-400",
  },
  violet: {
    chip: "border-violet-500/20 bg-violet-500/10 text-violet-200",
    icon: "text-violet-300",
    dot: "bg-violet-400",
  },
  fuchsia: {
    chip: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200",
    icon: "text-fuchsia-300",
    dot: "bg-fuchsia-400",
  },
  rose: {
    chip: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    icon: "text-rose-300",
    dot: "bg-rose-400",
  },
  slate: {
    chip: "border-slate-500/20 bg-slate-500/10 text-slate-200",
    icon: "text-slate-300",
    dot: "bg-slate-400",
  },
  zinc: {
    chip: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
    icon: "text-zinc-400",
    dot: "bg-zinc-500",
  },
};
