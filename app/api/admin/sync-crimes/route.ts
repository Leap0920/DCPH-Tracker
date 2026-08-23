// app/api/admin/sync-crimes/route.ts
//
// Walks every DCW page embedding {{InfoBox Crime}}, parses each crime block and
// upserts it into dcw_cases. Batches 50 titles per wiki request, so the whole
// wiki (~838 pages) normally completes in a single invocation.
//
//   curl -X POST "$BASE/api/admin/sync-crimes" -H "x-admin-secret: $SECRET"
//
// Re-invoke with ?cursor=<returned cursor> while done is false.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  TITLE_BATCH_SIZE,
  fetchWikitextBatch,
  listCrimeCaseTitles,
  parseCrimeBlocks,
} from "@/lib/dcw-cases";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Leaves ~60s of the 300s ceiling for the final DB writes and the response. */
const DEFAULT_BUDGET_MS = 240_000;
const UPSERT_CHUNK = 500;

/** Normalized title matching: lowercase, strip curly quotes, strip punctuation. */
function dcwNorm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Strip common tracker prefixes to reveal the core episode title.
 * "Detective Conan Episode 123: The Recipe" -> "therecipe"
 * "Case Closed Movie 05: Countdown to Heaven" -> "countdowntoheaven"
 */
function stripTrackerPrefix(title: string): string {
  let t = title;
  // Strip "Detective Conan" / "Case Closed" / "Meitantei Conan" franchise prefix
  t = t.replace(/^(?:detective conan|case closed|meitantei conan)\s*/i, "");
  // Strip "Episode NNN:" or "Episode NNN -"
  t = t.replace(/^episode\s*\d+\s*[:\-–—]\s*/i, "");
  // Strip "Movie NN:" or "Movie NN -"
  t = t.replace(/^movie\s*\d+\s*[:\-–—]\s*/i, "");
  // Strip leading brackets "[OVA]" etc.
  t = t.replace(/^\[[^\]]*\]\s*/, "");
  return dcwNorm(t);
}

type CaseRow = {
  page_title: string;
  case_index: number;
  crime_type: string;
  crime_slug: string;
  cause_death: string | null;
  cause_slug: string | null;
  victim: string | null;
  suspects: string | null;
  people: string | null;
  location: string | null;
  description: string | null;
  date_text: string | null;
  time_text: string | null;
  age_text: string | null;
  victim_label: string | null;
  cause_death_label: string | null;
  suspects_label: string | null;
  image_name: string | null;
  entry_id: string | null;
  updated_at: string;
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? "";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const budgetMs = Math.min(
    Number(url.searchParams.get("budgetMs") ?? DEFAULT_BUDGET_MS) || DEFAULT_BUDGET_MS,
    280_000,
  );
  const maxTitles = Number(url.searchParams.get("limit") ?? 0) || Infinity;

  const supabase = admin();

  let allTitles: string[];
  try {
    allTitles = await listCrimeCaseTitles();
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to list crime pages: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  // Titles are sorted, so "everything after the cursor" is a stable resume point.
  const pending = cursor ? allTitles.filter((title) => title > cursor) : allTitles;
  if (pending.length === 0) {
    return NextResponse.json({
      done: true,
      totalTitles: allTitles.length,
      processedTitles: 0,
      casesUpserted: 0,
      casesDeleted: 0,
      cursor: null,
      remaining: 0,
    });
  }

  const batches = chunk(pending.slice(0, maxTitles === Infinity ? undefined : maxTitles), TITLE_BATCH_SIZE);

  const rows: CaseRow[] = [];
  /** page_title -> highest case_index parsed this run (0 = template gone). */
  const blockCount = new Map<string, number>();
  const failedTitles: string[] = [];
  let processedTitles = 0;
  let lastTitle = cursor;
  let budgetExhausted = false;

  // ── Build entry lookup maps ONCE upfront (not per-batch) ──────────────────
  // Per-batch queries break on titles with apostrophes/special chars in .or().in().
  const entryIdByNormTitle = new Map<string, string>();
  const entryIdByStrippedTitle = new Map<string, string>();
  {
    const PAGE_SIZE = 1000;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: chunk } = await supabase
        .from("content_entries")
        .select("id, title, dcw_title")
        .range(from, from + PAGE_SIZE - 1);
      if (!chunk || chunk.length === 0) break;
      for (const row of chunk as { id: string; title: string; dcw_title: string | null }[]) {
        if (row.dcw_title) {
          entryIdByNormTitle.set(dcwNorm(row.dcw_title), row.id);
        }
        if (row.title) {
          const normTitle = dcwNorm(row.title);
          if (!entryIdByNormTitle.has(normTitle)) {
            entryIdByNormTitle.set(normTitle, row.id);
          }
          const stripped = stripTrackerPrefix(row.title);
          if (stripped && !entryIdByStrippedTitle.has(stripped)) {
            entryIdByStrippedTitle.set(stripped, row.id);
          }
        }
      }
      if (chunk.length < PAGE_SIZE) break;
    }
  }

  for (const batch of batches) {
    if (Date.now() - startedAt > budgetMs) {
      budgetExhausted = true;
      break;
    }

    let wikitextByTitle: Map<string, string>;
    try {
      wikitextByTitle = await fetchWikitextBatch(batch);
    } catch {
      // One bad batch shouldn't kill the run; the cursor will retry it later.
      failedTitles.push(...batch);
      continue;
    }

    const stamp = new Date().toISOString();

    for (const title of batch) {
      processedTitles++;
      if (title > lastTitle) lastTitle = title;

      const wikitext = wikitextByTitle.get(title);
      if (wikitext === undefined) {
        failedTitles.push(title);
        continue;
      }

      const parsed = parseCrimeBlocks(wikitext);
      blockCount.set(title, parsed.length);

      for (const item of parsed) {
        rows.push({
          page_title: title,
          case_index: item.caseIndex,
          crime_type: item.crimeType,
          crime_slug: item.crimeSlug,
          cause_death: item.causeDeath,
          cause_slug: item.causeSlug,
          victim: item.victim,
          suspects: item.suspects,
          people: item.people,
          location: item.location,
          description: item.description,
          date_text: item.dateText,
          time_text: item.timeText,
          age_text: item.ageText,
          victim_label: item.victimLabel,
          cause_death_label: item.causeDeathLabel,
          suspects_label: item.suspectsLabel,
          image_name: item.imageName,
          entry_id:
            entryIdByNormTitle.get(dcwNorm(title)) ??
            entryIdByStrippedTitle.get(stripTrackerPrefix(title)) ??
            entryIdByStrippedTitle.get(dcwNorm(title)) ??
            null,
          updated_at: stamp,
        });
      }
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      done: !budgetExhausted && processedTitles >= pending.length,
      totalTitles: allTitles.length,
      processedTitles,
      casesParsed: rows.length,
      failedTitles,
      cursor: lastTitle || null,
      sample: rows.slice(0, 5),
      elapsedMs: Date.now() - startedAt,
    });
  }

  let casesUpserted = 0;
  const writeErrors: string[] = [];

  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await supabase
      .from("dcw_cases")
      .upsert(group, { onConflict: "page_title,case_index" });
    if (error) writeErrors.push(error.message);
    else casesUpserted += group.length;
  }

  // Stale-block cleanup: a page that dropped from 3 crime blocks to 2 would
  // otherwise keep a phantom case_index 3 forever. Grouped by block count so
  // this costs a handful of statements, not one per page.
  let casesDeleted = 0;
  const titlesByCount = new Map<number, string[]>();
  for (const [title, count] of blockCount) {
    const bucket = titlesByCount.get(count);
    if (bucket) bucket.push(title);
    else titlesByCount.set(count, [title]);
  }
  for (const [count, titles] of titlesByCount) {
    for (const group of chunk(titles, 200)) {
      const { data, error } = await supabase
        .from("dcw_cases")
        .delete()
        .in("page_title", group)
        .gt("case_index", count)
        .select("id");
      if (error) writeErrors.push(error.message);
      else casesDeleted += data?.length ?? 0;
    }
  }

  const done = !budgetExhausted && processedTitles >= pending.length;

  return NextResponse.json({
    done,
    totalTitles: allTitles.length,
    processedTitles,
    casesUpserted,
    casesDeleted,
    remaining: Math.max(0, pending.length - processedTitles),
    cursor: done ? null : lastTitle || null,
    budgetExhausted,
    failedTitles,
    writeErrors,
    elapsedMs: Date.now() - startedAt,
  });
}
