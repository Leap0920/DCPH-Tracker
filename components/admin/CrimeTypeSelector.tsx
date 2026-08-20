"use client";

import {
  CRIME_GROUPS,
  getCrimeCategory,
  normalizeCrimeSlugs,
  type CrimeSlug,
} from "@/lib/crime-categories";
import { CRIME_ICONS, CRIME_TONE_CLASSES } from "@/components/tracker/crimeTone";

type CrimeTypeSelectorProps = {
  value: readonly string[] | null | undefined;
  onChange: (value: CrimeSlug[]) => void;
  disabled?: boolean;
};

export function CrimeTypeSelector({
  value,
  onChange,
  disabled = false,
}: CrimeTypeSelectorProps) {
  const selected = new Set(normalizeCrimeSlugs(value));

  const toggle = (slug: CrimeSlug) => {
    const next = new Set(selected);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
    }
    onChange(normalizeCrimeSlugs([...next]));
  };

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium text-zinc-200">
        Crime categories
      </legend>
      <p className="text-xs text-zinc-500">
        Select every category that applies. Leave empty if unknown.
      </p>

      {CRIME_GROUPS.map((group) => (
        <div key={group.kind} className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.slugs.map((slug) => {
              const category = getCrimeCategory(slug);
              if (!category) return null;
              const Icon = CRIME_ICONS[category.icon];
              const tone = CRIME_TONE_CLASSES[category.tone];
              const active = selected.has(slug);

              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggle(slug)}
                  aria-pressed={active}
                  title={category.description}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
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
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
