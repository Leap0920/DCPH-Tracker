"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchContentEntries } from "@/lib/queries/client/content";
import { CRIME_GROUPS, countCrimes, getCrimeCategory } from "@/lib/crime-categories";
import { CRIME_ICONS, CRIME_TONE_CLASSES } from "@/components/tracker/crimeTone";

export default function CrimeCategoriesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["content"],
    queryFn: fetchContentEntries,
  });
  const entries = (data as { entries?: { crime_types?: string[] | null }[] } | undefined)?.entries ?? [];
  const counts = useMemo(() => countCrimes(entries), [entries]);
  const totalTagged = useMemo(() => entries.filter((e) => (e.crime_types?.length ?? 0) > 0).length, [entries]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-8 space-y-2">
        <Link href="/tracker" className="text-xs font-medium text-zinc-500 hover:text-zinc-300">← Tracker</Link>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Crime categories</h1>
        <p className="max-w-2xl text-sm text-zinc-400">Browse the case archive by method and scenario. {totalTagged} entries categorized so far.</p>
      </header>
      <div className="space-y-10">
        {CRIME_GROUPS.map((group) => (
          <section key={group.kind}>
            <div className="mb-3 flex items-baseline justify-between border-b border-white/10 pb-2">
              <h2 className="text-sm font-medium text-zinc-200">{group.label}</h2>
              <p className="text-xs text-zinc-500">{group.blurb}</p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.slugs.map((slug) => {
                const category = getCrimeCategory(slug);
                if (!category) return null;
                const Icon = CRIME_ICONS[category.icon];
                const tone = CRIME_TONE_CLASSES[category.tone];
                const count = counts[slug];
                return (
                  <li key={slug}>
                    <Link href={`/tracker/crimes/${slug}`} className="group flex h-full flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-4 hover:border-white/20 hover:bg-white/[0.04]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2">
                          <span className={`inline-flex size-7 items-center justify-center rounded-md border ${tone.chip}`}><Icon aria-hidden className="size-4" /></span>
                          <span className="text-sm font-medium text-zinc-100">{category.label}</span>
                        </span>
                        <span className="text-xs tabular-nums text-zinc-500">{isLoading ? "…" : count}</span>
                      </div>
                      <p className="line-clamp-3 text-xs leading-relaxed text-zinc-400">{category.description}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
