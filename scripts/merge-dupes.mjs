#!/usr/bin/env node
// scripts/merge-dupes.mjs
// Backfill "keeper" rows from soon-to-be-deleted duplicate rows.
// Dry-run by default. Pass --apply to write (backs up affected rows first).
//
// Supabase translation of the advisor's merge design: same MERGE_PAIRS,
// same field rules, persistence via the service-role client exactly like
// scripts/curate-catalog.mjs.
//
//   node --env-file=.env.local scripts/merge-dupes.mjs
//   node --env-file=.env.local scripts/merge-dupes.mjs --apply

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --env-file=.env.local)");
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function loadAll() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from("content_entries")
      .select("*")
      .order("slug", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    rows.push(...data);
    if (!data || data.length < page) break;
  }
  return rows;
}

// keep = the row that survives (stable, matcher-friendly slug)
// drop = the row curate-catalog.mjs will delete (richer data, bad slug)
const MERGE_PAIRS = [
  { keep: "ova-magic-file-02", drop: "ova-20" },
  { keep: "ova-magic-file-03", drop: "ova-21" },
  { keep: "ova-magic-file-04", drop: "ova-24" },
  { keep: "ova-magic-file-05", drop: "ova-25" },
];

// Never merged: slug, release_order, canon_order (the order phase re-derives those).
const TEXT_FIELDS = ["title", "synopsis"];
const NULLABLE_FIELDS = ["movie_number", "episode_number"];

function isPlaceholder(url) {
  if (!url) return true;
  const s = String(url).trim();
  if (!s) return true;
  return /placeholder|no[-_ ]?image|default\.(svg|png|jpg)$/i.test(s);
}

function longer(a, b) {
  const A = (a ?? "").toString().trim();
  const B = (b ?? "").toString().trim();
  if (!B) return null; // nothing to take
  if (B.length <= A.length) return null;
  return B;
}

async function updateRow(slug, patch) {
  const { error } = await sb.from("content_entries").update(patch).eq("slug", slug);
  if (error) throw new Error(`update ${slug} failed: ${error.message}`);
}

async function main() {
  const rows = await loadAll();
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const changes = [];
  const problems = [];

  for (const { keep, drop } of MERGE_PAIRS) {
    const k = bySlug.get(keep);
    const d = bySlug.get(drop);
    if (!k) { problems.push(`keeper missing, skipped: ${keep}`); continue; }
    if (!d) { problems.push(`twin missing (already merged?), skipped: ${drop}`); continue; }

    const patch = {};

    for (const f of TEXT_FIELDS) {
      const v = longer(k[f], d[f]);
      if (v !== null) patch[f] = v;
    }
    for (const f of NULLABLE_FIELDS) {
      if ((k[f] === null || k[f] === undefined || k[f] === "") &&
          d[f] !== null && d[f] !== undefined && d[f] !== "") {
        patch[f] = d[f];
      }
    }
    // image_url + image_source move together or not at all
    if (isPlaceholder(k.image_url) && !isPlaceholder(d.image_url)) {
      patch.image_url = d.image_url;
      patch.image_source = d.image_source ?? null;
    }

    if (Object.keys(patch).length === 0) {
      console.log(`= ${keep}: nothing to take from ${drop}`);
      continue;
    }
    changes.push({ keep, drop, patch, before: k });
  }

  for (const c of changes) {
    console.log(`\n~ ${c.keep}  (from ${c.drop})`);
    for (const [f, v] of Object.entries(c.patch)) {
      const oldV = c.before[f] === null || c.before[f] === "" ? "<empty>" : String(c.before[f]);
      console.log(`    ${f}:`);
      console.log(`      - ${oldV.slice(0, 120)}`);
      console.log(`      + ${String(v).slice(0, 120)}`);
    }
  }

  if (problems.length) {
    console.log("\nWARNINGS:");
    for (const p of problems) console.log(`  ! ${p}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${changes.length} row(s) would be updated. Re-run with --apply.`);
    return;
  }
  if (!changes.length) { console.log("\nNothing to apply."); return; }

  // Backup affected rows before writing (JSON, mirrors curate-catalog).
  mkdirSync("scripts/out", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRows = changes.map((c) => ({ keeper: c.before, droppedTwin: bySlug.get(c.drop) }));
  const bakFile = path.join("scripts/out", `backup-premerge-${stamp}.json`);
  writeFileSync(bakFile, JSON.stringify(backupRows, null, 2));
  console.log(`\nBackup: ${bakFile}`);

  let n = 0;
  for (const c of changes) {
    try {
      await updateRow(c.keep, c.patch);
      n++;
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }
  console.log(`APPLIED — ${n} row(s) updated.`);
}

main().catch((err) => {
  console.error(`merge-dupes failed: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
