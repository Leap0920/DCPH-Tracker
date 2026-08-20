"use client";

import { getCrimeCategories } from "@/lib/crime-categories";
import { CRIME_ICONS, CRIME_TONE_CLASSES } from "@/components/tracker/crimeTone";

type CrimeBadgesProps = {
  crimeTypes: readonly string[] | null | undefined;
  max?: number;
  className?: string;
};

export function CrimeBadges({
  crimeTypes,
  max = 3,
  className,
}: CrimeBadgesProps) {
  const categories = getCrimeCategories(crimeTypes);
  if (!categories.length) return null;

  const shown = categories.slice(0, max);
  const overflow = categories.length - shown.length;

  return (
    <ul className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((category) => {
        const Icon = CRIME_ICONS[category.icon];
        const tone = CRIME_TONE_CLASSES[category.tone];
        return (
          <li key={category.slug}>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${tone.chip}`}
              title={category.label}
            >
              <Icon aria-hidden="true" className="size-3" />
              {category.label}
            </span>
          </li>
        );
      })}
      {overflow > 0 ? (
        <li>
          <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium leading-none text-zinc-400">
            +{overflow}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
