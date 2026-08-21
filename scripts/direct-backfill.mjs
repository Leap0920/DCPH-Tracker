import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE env vars. Run with: node --env-file=.env.local scripts/direct-backfill.mjs");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const DCW_API = "https://www.detectiveconanworld.com/wiki/api.php";
const USER_AGENT = "DCPH-Tracker/1.0 (+https://github.com/your-org/DCPH-Tracker)";

function titleCandidates(title) {
  const t = title.trim();
  const withoutPart = t.replace(/\s*\(Part\s*\d+\).*$/i, "").trim();
  const withoutParen = t.replace(/\s*\(.*?\)\s*$/g, "").trim();
  return [...new Set([t, withoutPart, withoutParen].filter(Boolean))];
}

async function fetchPageImage(title) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "pageimages",
    piprop: "thumbnail|original",
    pithumbsize: "600",
    pilicense: "any",
    redirects: "1",
    titles: title,
  });
  try {
    const res = await fetch(`${DCW_API}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const page = json?.query?.pages?.[0];
    if (!page || page.missing) return null;
    const img = page.thumbnail?.source || page.original?.source || null;
    if (!img) return null;
    return { url: img, page: page.title };
  } catch { return null; }
}

async function fetchImagesFallback(title) {
  try {
    const p1 = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "images", imlimit: "50", redirects: "1", titles: title });
    const r1 = await fetch(`${DCW_API}?${p1}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (!r1.ok) return null;
    const j1 = await r1.json();
    const allFiles = (j1?.query?.pages?.[0]?.images ?? []).map(i => i.title).filter(n => /\.(jpe?g|png|webp)$/i.test(n) && !/(logo|icon|wiki|placeholder|flag\.svg)/i.test(n));
    // Only use episode screenshots — ignore character portraits (Conan_Edogawa.jpg etc.)
    const epFiles = allFiles.filter(n => /EP\s*\d+|Case\s*\d+|Episode/i.test(n));
    if (!epFiles.length) return null;
    const candidates = epFiles.slice(0, 3);
    // Filter out pure character portraits if we have EP candidates — character files are like "Conan Edogawa.jpg"
    const p2 = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "url", iiurlwidth: "600", redirects: "1", titles: candidates.join("|") });
    const r2 = await fetch(`${DCW_API}?${p2}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (!r2.ok) return null;
    const j2 = await r2.json();
    const best = (j2?.query?.pages ?? []).map(p => p.imageinfo?.[0]).find(i => i?.thumburl || i?.url);
    if (!best) return null;
    return { url: best.thumburl || best.url, page: title };
  } catch { return null; }
}

async function fetchDcwImage(title) {
  for (const cand of titleCandidates(title)) {
    let hit = await fetchPageImage(cand);
    if (hit) return hit;
    hit = await fetchImagesFallback(cand);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 200));
  }
  // last try: search
  try {
    const sp = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "search", srsearch: title, srnamespace: "0", srlimit: "3" });
    const sr = await fetch(`${DCW_API}?${sp}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (sr.ok) {
      const sj = await sr.json();
      const first = sj?.query?.search?.[0]?.title;
      if (first) {
        let hit = await fetchPageImage(first);
        if (hit) return hit;
        hit = await fetchImagesFallback(first);
        if (hit) return hit;
      }
    }
  } catch {}
  return null;
}

const PAGE_SIZE = 50;
let cursor = null;
let total = 0, updated = 0, dcw = 0, fallback = 0;
const dryRun = process.argv.includes("--dry-run");

for (;;) {
  let q = supabase.from("content_entries").select("id, title, slug, image_url, image_source").order("id").limit(PAGE_SIZE);
  if (cursor) q = q.gt("id", cursor);
  if (!process.argv.includes("--all")) {
    q = q.is("image_source", null);
  }
  const { data, error } = await q;
  if (error) { console.error(error); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const row of data) {
    total++;
    const title = row.title?.trim();
    if (!title) { fallback++; continue; }
    const hit = await fetchDcwImage(title);
    if (hit) {
      dcw++;
      console.log(`✓ ${row.slug}: ${title} -> ${hit.url.slice(0,80)}`);
      if (!dryRun) {
        const { error: upErr } = await supabase.from("content_entries").update({
          image_url: hit.url,
          dcw_title: hit.page,
          image_source: "dcw",
        }).eq("id", row.id);
        if (!upErr) updated++;
      }
    } else {
      fallback++;
      console.log(`- no DCW image: ${row.slug}: ${title}`);
      if (!dryRun) {
        // Mark as upstream to avoid infinite retry; keep existing image_url
        const { error: upErr } = await supabase.from("content_entries").update({
          image_source: row.image_url ? "upstream" : "placeholder",
        }).eq("id", row.id);
        if (!upErr) updated++;
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  cursor = data[data.length - 1].id;
  if (data.length < PAGE_SIZE) break;
}
console.log(`\nDone. total=${total} dcw=${dcw} fallback=${fallback} updated=${updated} ${dryRun ? "(dry run)" : ""}`);
