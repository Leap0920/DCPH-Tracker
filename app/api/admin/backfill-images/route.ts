// app/api/admin/backfill-images/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getDcwEpisodeDetails } from "@/lib/dcw-episode";
import { fetchDcwImageForTitle } from "@/lib/dcw-image-for-title";
import { pickImageUrl, resolveDcwImagesBatch } from "@/lib/dcw-images";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  slug: string | null;
  title: string | null;
  dcw_title: string | null;
  image_source: string | null;
  image_url: string | null;
  type: string | null;
  episode_number: number | null;
};

type Resolved = {
  dcwTitle: string | null;
  imageUrl: string | null;
  via: "batch" | "episode" | "none";
};

const DEEP_CONCURRENCY = 2;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Expensive path: resolve the canonical DCW page for a row (episode-number
 * redirects, category index, orthographic variants, search), then pull an image
 * off that exact page.
 */
async function deepResolve(row: Row): Promise<Resolved> {
  const contentType = row.type ?? "episode";
  const fallbackTitle = row.title ?? row.slug ?? "";
  if (!fallbackTitle && !row.dcw_title) {
    return { dcwTitle: null, imageUrl: null, via: "none" };
  }

  let details = null;
  try {
    details = await getDcwEpisodeDetails({
      dcwTitle: row.dcw_title ?? undefined,
      fallbackTitle,
      // episode_number is only a meaningful DCW hint for actual episodes.
      episodeNumber:
        contentType === "episode" && typeof row.episode_number === "number"
          ? row.episode_number
          : undefined,
      contentType,
    });
  } catch {
    details = null;
  }

  const canonical = details?.title ?? null;
  if (!canonical) return { dcwTitle: null, imageUrl: null, via: "none" };

  const image = await fetchDcwImageForTitle(canonical, { thumbSize: 600 });
  return {
    dcwTitle: canonical,
    imageUrl: image?.url ?? null,
    via: image?.url ? "episode" : "none",
  };
}

export async function POST(request: Request) {
  const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
  const cursor = url.searchParams.get("cursor") ?? "";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlyMissing = url.searchParams.get("onlyMissing") !== "0";
  const deep = url.searchParams.get("deep") !== "0";
  const typeFilter = url.searchParams.get("type");

  const supabase = admin();

  let query = supabase
    .from("content_entries")
    .select(
      "id, slug, title, dcw_title, image_source, image_url, type, episode_number",
    )
    .order("id", { ascending: true })
    .limit(limit);

  if (cursor) query = query.gt("id", cursor);
  if (typeFilter) query = query.eq("type", typeFilter);
  if (onlyMissing) query = query.or("image_source.is.null,image_source.neq.dcw");

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  if (!rows.length) {
    return NextResponse.json({ done: true, processed: 0, updated: 0, cursor: null });
  }

  // --- Pass 1: cheap batched title matching (a couple of API calls total) ---
  let batch: Array<{ id: string; dcwTitle: string | null; url: string | null }> = [];
  try {
    const resolutions = await resolveDcwImagesBatch(
      rows.map((row) => ({
        id: row.id,
        title: row.title ?? row.slug ?? "",
        aliases: [row.dcw_title ?? ""].filter(Boolean),
        contentType: row.type ?? "episode",
      })),
    );
    batch = resolutions.map((resolution) => ({
      id: resolution.id,
      dcwTitle: resolution.dcwTitle ?? null,
      url: resolution.image?.url ?? null,
    }));
  } catch {
    batch = [];
  }

  const resolved = new Map<string, Resolved>();
  for (const row of rows) resolved.set(row.id, { dcwTitle: null, imageUrl: null, via: "none" });
  for (const entry of batch) {
    resolved.set(entry.id, {
      dcwTitle: entry.dcwTitle,
      imageUrl: entry.url,
      via: entry.url ? "batch" : "none",
    });
  }

  // --- Pass 2: per-row canonical resolution for whatever pass 1 missed -----
  if (deep) {
    const stragglers = rows.filter((row) => !resolved.get(row.id)?.imageUrl);
    const deepResults = await mapLimit(stragglers, DEEP_CONCURRENCY, deepResolve);

    stragglers.forEach((row, index) => {
      const deepResult = deepResults[index];
      const previous = resolved.get(row.id);
      resolved.set(row.id, {
        dcwTitle: deepResult.dcwTitle ?? previous?.dcwTitle ?? null,
        imageUrl: deepResult.imageUrl,
        via: deepResult.via,
      });
    });
  }

  const results: Array<Record<string, unknown>> = [];
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const resolution = resolved.get(row.id) ?? {
      dcwTitle: null,
      imageUrl: null,
      via: "none" as const,
    };

    const hadDcw = row.image_source === "dcw";
    const upstream = hadDcw ? null : row.image_url;
    const picked = pickImageUrl(resolution.imageUrl, upstream);

    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      episodeNumber: row.episode_number,
      dcwTitle: resolution.dcwTitle ?? row.dcw_title ?? null,
      imageUrl: picked.url,
      source: picked.source,
      via: resolution.via,
      previousSource: row.image_source,
    });

    if (dryRun) continue;

    // Never downgrade an existing DCW image (matters for onlyMissing=0 runs).
    if (hadDcw && picked.source !== "dcw") {
      skipped++;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (picked.url !== row.image_url) patch.image_url = picked.url;
    if (picked.source !== row.image_source) patch.image_source = picked.source;
    if (resolution.dcwTitle && resolution.dcwTitle !== row.dcw_title) {
      patch.dcw_title = resolution.dcwTitle;
    }

    if (!Object.keys(patch).length) {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("content_entries")
      .update(patch)
      .eq("id", row.id);

    if (!updateError) updated++;
  }

  return NextResponse.json({
    done: rows.length < limit,
    processed: rows.length,
    updated,
    skipped,
    cursor: rows[rows.length - 1].id,
    dryRun,
    deep,
    results,
  });
}
