"use client";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchContentEntries } from "@/lib/queries/client/content";
import { getCrimeCategory, isCrimeSlug } from "@/lib/crime-categories";
import { CRIME_ICONS, CRIME_TONE_CLASSES } from "@/components/tracker/crimeTone";
import { CrimeBadges } from "@/components/tracker/CrimeBadges";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";

export default function CrimeCategoryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  if (!isCrimeSlug(slug)) notFound();
  const category = getCrimeCategory(slug)!;
  const Icon = CRIME_ICONS[category.icon];
  const tone = CRIME_TONE_CLASSES[category.tone];
  const { data, isLoading } = useQuery({ queryKey: ["content"], queryFn: fetchContentEntries });
  const entries = (data as { entries?: unknown[] } | undefined)?.entries ?? [];
  const filtered = useMemo(() => (entries as { crime_types?: string[]; canon_order: number }[]).filter((e) => e.crime_types?.includes(slug)).sort((a,b)=>a.canon_order-b.canon_order), [entries, slug]);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-4">
        <Link href="/tracker/crimes" className="text-xs font-medium text-zinc-500 hover:text-zinc-300">← All categories</Link>
        <div className="flex items-start gap-3">
          <span className={`inline-flex size-10 items-center justify-center rounded-md border ${tone.chip}`}><Icon className="size-5" /></span>
          <div><h1 className="text-2xl font-semibold text-white">{category.label}</h1><p className="text-xs text-zinc-500">{isLoading ? "Loading…" : `${filtered.length} entries`}</p></div>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">{category.description}</p>
        <Link href={`/tracker?crime=${slug}`} className="inline-flex rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Watch these in the tracker</Link>
      </header>
      {filtered.length === 0 && !isLoading ? <p className="rounded-md border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-zinc-500">No entries categorized as {category.label} yet.</p> : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/10">
          {(filtered as unknown as { id:string; slug:string; title:string; episode_number:number|null; type:string; air_date:string; crime_types:string[] }[]).map((e)=>(
            <li key={e.id}><Link href={`/tracker/${e.slug}`} className="flex items-center justify-between gap-4 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05]"><div className="min-w-0 space-y-1"><p className="truncate text-sm font-medium text-zinc-100">{e.episode_number ? `#${e.episode_number} · `: ""}{e.title}</p><div className="flex items-center gap-2"><span className="text-[11px] text-zinc-500">{CONTENT_TYPE_LABELS[e.type as keyof typeof CONTENT_TYPE_LABELS] ?? e.type}</span><CrimeBadges crimeTypes={e.crime_types} max={2} /></div></div><span className="shrink-0 text-[11px] tabular-nums text-zinc-600">{e.air_date}</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
