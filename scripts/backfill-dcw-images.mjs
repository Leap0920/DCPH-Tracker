// scripts/backfill-dcw-images.mjs
// Drives the chunked admin route until the cursor is exhausted.
//   node scripts/backfill-dcw-images.mjs --dry-run
//   node scripts/backfill-dcw-images.mjs --base=https://your-app.vercel.app

import process from "node:process";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const base = args.get("base") ?? "http://localhost:3000";
const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET;
const dryRun = args.has("dry-run");
const limit = Number(args.get("limit") ?? 50);
const all = args.has("all"); // re-resolve entries that already have a DCW image

if (!secret) {
  console.error("ADMIN_TASK_SECRET or CRON_SECRET is not set.");
  process.exit(1);
}

let cursor = "";
let totals = { processed: 0, updated: 0, dcw: 0, upstream: 0, placeholder: 0 };
let page = 0;

for (;;) {
  const url = new URL("/api/admin/backfill-images", base);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  if (dryRun) url.searchParams.set("dryRun", "1");
  if (all) url.searchParams.set("onlyMissing", "0");

  const res = await fetch(url, {
    method: "POST",
    headers: { "x-admin-secret": secret },
  });

  if (!res.ok) {
    console.error(`page ${page} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const body = await res.json();
  totals.processed += body.processed ?? 0;
  totals.updated += body.updated ?? 0;

  for (const result of body.results ?? []) {
    totals[result.source] = (totals[result.source] ?? 0) + 1;
    if (result.source !== "dcw") {
      console.warn(`  no DCW image: ${result.slug ?? result.id} — "${result.title}"`);
    }
  }

  console.log(
    `page ${page}: processed=${body.processed} updated=${body.updated} cursor=${body.cursor}`,
  );

  if (body.done || !body.cursor) break;
  cursor = body.cursor;
  page++;
}

console.log("\nsummary", totals);
if (dryRun) console.log("(dry run — nothing was written)");
