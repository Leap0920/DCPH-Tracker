"use client";

import Link from "next/link";

import {
  CRIME_CATEGORIES,
  CRIME_FILTER_ALL,
  type CrimeFilter,
  type CrimeSlug,
} from "@/lib/crime-categories";
import { CRIME_ICONS, CRIME_TONE_CLASSES } from "@/components/tracker/crimeTone";

type CrimeFilterBarProps = {
  value: CrimeFilter;
  counts?: Record<CrimeSlug, number>;
  onChange: (value: CrimeFilter) => void;
  /** Hides categories with a zero count. Defaults to true. */
  hideEmpty?: boolean;
};

export function CrimeFilterBar({
  value,
  counts,
  onChange,
  hideEmpty = true,
}: CrimeFilterBarProps) {
  const visible = CRIME_CATEGORIES.filter((category) => {
    if (!counts || !hideEmpty) return true;
    return counts[category.slug] > 0 || value === category.slug;
  });

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Filter by crime category"
      >
        <button
          type="button"
          onClick={() => onChange(CRIME_FILTER_ALL)}
          aria-pressed={value === CRIME_FILTER_ALL}
          className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
            value === CRIME_FILTER_ALL
              ? "border-white/20 bg-white/10 text-white"
              : "border-white/10 bg-transparent text-zinc-400 hover:border-white/20 hover:text-zinc-200"
          }`}
        >
          All crimes
        </button>

        {visible.map((category) => {
          const Icon = CRIME_ICONS[category.icon];
          const tone = CRIME_TONE_CLASSES[category.tone];
          const active = value === category.slug;
          const count = counts?.[category.slug];

          return (
            <button
              key={category.slug}
              type="button"
              onClick={() =>
                onChange(active ? CRIME_FILTER_ALL : category.slug)
              }
              aria-pressed={active}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? tone.chip
                  : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`size-3.5 ${active ? "" : tone.icon}`}
              />
              {category.label}
              {typeof count === "number" ? (
                <span className="text-[10px] tabular-nums text-zinc-500">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <Link
        href="/tracker/crimes"
        className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
      >
        Browse
      </Link>
    </div>
  );
}
