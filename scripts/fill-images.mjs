#!/usr/bin/env node
// scripts/fill-images.mjs
//
// Fills image_url for content_entries rows that have a placeholder image.
// Never throws per-row: every network call degrades to null, main is wrapped.
// Dry-run by default; --apply backs up affected rows first (JSON, like curate).
//
// Modes / flags:
//   --apply              write changes (default: dry run)
//   --check              validate EXISTING non-placeholder urls; with --apply,
//                        reset dead ones to placeholder so a later pass retries
//   --type=ova,special   restrict to types (comma separated)
//   --only=slug,slug     restrict to explicit slugs
//   --limit=N            stop after N successful resolutions
//   --sim=0.5            min title similarity for search-based sources
//   --fallback           as a last resort, assign TYPE_FALLBACK asset
//   --verbose            log every candidate considered
//
// Optional env: TMDB_API_KEY (unlocks live-action / movie coverage)
//
// Supabase translation of the advisor's design: same sources, throttles and
// validation; persistence via the service-role client.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------- CLI ------------------------------------ */

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const val = (name, dflt = null) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const APPLY = has("--apply");
const CHECK = has("--check");
const VERBOSE = has("--verbose");
const USE_FALLBACK = has("--fallback");
const MIN_SIM = Number(val("sim", "0.5"));
const LIMIT = Number(val("limit", "0")) || Infinity;
const TYPES = (val("type") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = (val("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TMDB_KEY = process.env.TMDB_API_KEY ?? "";

/* ---------------------------- config ------------------------------------ */

// Explicit wins. url = use verbatim; kitsuId = pull posterImage.
const TARGETED_OVERRIDES = {
  "mov-51": { kitsuId: 49539 }, // Meitantei Conan: Sekigan no Flashback (Movie 28)
  // Zero's Tea Time series poster (episode thumbs are null on Kitsu)
  "ztt-01": { kitsuId: 45281 },
  "ztt-02": { kitsuId: 45281 },
  "ztt-03": { kitsuId: 45281 },
  "ztt-04": { kitsuId: 45281 },
  "ztt-05": { kitsuId: 45281 },
  "ztt-06": { kitsuId: 45281 },
};

// Zero's Tea Time: Kitsu TV entry with 6 per-episode thumbnails.
const ZTT_KITSU_ANIME_ID = 45281;

// Only used with --fallback. Add these assets to /public/images/fallback/ first.
const TYPE_FALLBACK = {
  ova: "/images/fallback/ova.svg",
  special: "/images/fallback/special.svg",
  live_action: "/images/fallback/live-action.svg",
  zero_tea_time: "/images/fallback/zero-tea-time.svg",
  movie: "/images/fallback/movie.svg",
  magic_kaito: "/images/fallback/magic-kaito.svg",
  hanzawa: "/images/fallback/hanzawa.svg",
};

const PLACEHOLDER_URL = "/placeholder-episode.svg";

const UA = "DCPH-Tracker/1.0 (catalog image backfill; contact: local script)";

/* --------------------------- supabase ----------------------------------- */

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
      .select("slug, type, title, air_date, image_url, image_source, movie_number, episode_number")
      .order("slug", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    rows.push(...data);
    if (!data || data.length < page) break;
  }
  return rows;
}

function isPlaceholder(url) {
  if (!url) return true;
  const s = String(url).trim();
  if (!s) return true;
  return /placeholder|no[-_ ]?image|default\.(svg|png|jpg)$/i.test(s);
}

/* --------------------------- primitives --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Throttle {
  constructor(ms) { this.ms = ms; this.last = 0; }
  async wait() {
    const d = this.ms - (Date.now() - this.last);
    if (d > 0) await sleep(d);
    this.last = Date.now();
  }
}

const T = {
  dcw: new Throttle(1100),
  jikan: new Throttle(1200), // well under Jikan's 3/s and 60/min
  kitsu: new Throttle(450),
  tmdb: new Throttle(300),
  head: new Throttle(120),
};

async function safeFetch(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { "user-agent": UA, ...(opts.headers ?? {}) },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (i + 1));
        continue;
      }
      return res;
    } catch (err) {
      if (VERBOSE) console.log(`    fetch error (${i + 1}/${tries}): ${err?.message ?? err}`);
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

async function getJson(url, opts = {}) {
  const res = await safeFetch(url, opts);
  if (!res || !res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/** Confirm a URL actually serves an image before we persist it. */
async function isLiveImage(url) {
  if (!url) return false;
  if (url.startsWith("/")) return true; // local asset, trust the repo
  await T.head.wait();
  let res = await safeFetch(url, { method: "HEAD", timeoutMs: 10000 }, 2);
  if (!res || res.status === 405 || res.status === 403) {
    res = await safeFetch(url, { method: "GET", headers: { range: "bytes=0-1023" }, timeoutMs: 12000 }, 2);
  }
  if (!res || !res.ok) return false;
  const ct = res.headers.get("content-type") ?? "";
  return ct.startsWith("image/");
}

/* --------------------------- similarity --------------------------------- */

const STOP = new Set([
  "the", "a", "an", "of", "and", "in", "to", "detective", "conan", "case",
  "closed", "meitantei", "movie", "special", "ova", "episode", "part",
]);

function tokens(s) {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      // "02" and "2" must compare equal — this is what bit us last round
      .map((t) => (/^\d+$/.test(t) ? String(Number(t)) : t))
      .filter((t) => !STOP.has(t))
  );
}

function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function bestOf(dbTitle, candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c?.image) continue;
    const score = Math.max(0, ...(c.titles ?? []).map((t) => jaccard(dbTitle, t)));
    if (VERBOSE) console.log(`    cand ${score.toFixed(2)} :: ${(c.titles ?? [])[0] ?? "?"}`);
    if (!best || score > best.score) best = { ...c, score };
  }
  return best && best.score >= MIN_SIM ? best : null;
}

/* ------------------------------ sources --------------------------------- */

const DCW_API = "https://www.detectiveconanworld.com/wiki/api.php";
const BAD_FILE = /(icon|logo|wiki|nav|button|spoiler|stub|placeholder|edit|arrow|magnify|favicon|ambox|crystal|sprite)/i;

/** DCW: list a page's File: attachments, then resolve the best one to a URL. */
async function dcwImage(pageTitle, dbTitle) {
  await T.dcw.wait();
  const listUrl =
    `${DCW_API}?action=query&format=json&redirects=1&prop=images&imlimit=50` +
    `&titles=${encodeURIComponent(pageTitle)}`;
  const list = await getJson(listUrl);
  const pages = list?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;

  const files = (page.images ?? [])
    .map((i) => i.title)
    .filter((t) => /\.(png|jpe?g|webp)$/i.test(t) && !BAD_FILE.test(t));
  if (!files.length) return null;

  // Prefer files whose name overlaps the entry title.
  files.sort((a, b) => jaccard(dbTitle, b.replace(/^File:/, "")) - jaccard(dbTitle, a.replace(/^File:/, "")));
  const shortlist = files.slice(0, 6);

  await T.dcw.wait();
  const infoUrl =
    `${DCW_API}?action=query&format=json&prop=imageinfo&iiprop=url|size` +
    `&titles=${encodeURIComponent(shortlist.join("|"))}`;
  const info = await getJson(infoUrl);
  const infoPages = Object.values(info?.query?.pages ?? {});

  let best = null;
  for (const p of infoPages) {
    const ii = p?.imageinfo?.[0];
    if (!ii?.url) continue;
    const w = Number(ii.width ?? 0);
    if (w && w < 120) continue; // thumbnail junk
    const score = jaccard(dbTitle, (p.title ?? "").replace(/^File:/, "")) * 1000 + w;
    if (!best || score > best.score) best = { url: ii.url, score };
  }
  return best?.url ?? null;
}

/** Page-title candidates to try on DCW for a given row. */
function dcwCandidates(e) {
  const t = (e.title ?? "").trim();
  const out = [t];
  out.push(t.replace(/^Detective Conan[:\s-]*/i, ""));
  out.push(`Detective Conan ${t.replace(/^Detective Conan[:\s-]*/i, "")}`);
  if (e.type === "zero_tea_time" && e.episode_number) {
    out.unshift(`TIME.${e.episode_number}`, `Zero's Tea Time Episode ${e.episode_number}`);
  }
  if (e.type === "movie" && e.movie_number) out.push(`Movie ${e.movie_number}`);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, 3);
}

async function jikanSearch(q) {
  await T.jikan.wait();
  const j = await getJson(
    `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=5&sfw=false`
  );
  return (j?.data ?? []).map((m) => ({
    titles: [
      m.title, m.title_english, m.title_japanese,
      ...((m.titles ?? []).map((x) => x.title)),
    ].filter(Boolean),
    image:
      m.images?.jpg?.large_image_url ??
      m.images?.webp?.large_image_url ??
      m.images?.jpg?.image_url ??
      null,
  }));
}

async function kitsuSearchImages(q) {
  await T.kitsu.wait();
  const j = await getJson(
    `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=5`,
    { headers: { accept: "application/vnd.api+json" } }
  );
  return (j?.data ?? []).map((d) => {
    const a = d.attributes ?? {};
    return {
      titles: [a.canonicalTitle, ...Object.values(a.titles ?? {})].filter(Boolean),
      image: a.posterImage?.original ?? a.posterImage?.large ?? a.posterImage?.medium ?? null,
    };
  });
}

async function kitsuPosterById(id) {
  await T.kitsu.wait();
  const j = await getJson(`https://kitsu.io/api/edge/anime/${id}`, {
    headers: { accept: "application/vnd.api+json" },
  });
  const p = j?.data?.attributes?.posterImage;
  return p?.original ?? p?.large ?? p?.medium ?? null;
}

/** Zero's Tea Time per-episode thumbnails, fetched once and cached. */
let _zttCache = null;
async function zttThumbs() {
  if (_zttCache) return _zttCache;
  _zttCache = new Map();
  await T.kitsu.wait();
  const j = await getJson(
    `https://kitsu.io/api/edge/anime/${ZTT_KITSU_ANIME_ID}/episodes?page[limit]=20&sort=number`,
    { headers: { accept: "application/vnd.api+json" } }
  );
  const rows = j?.data ?? [];
  if (!rows.length) { console.log("  ! ZTT episode payload empty"); return _zttCache; }
  if (VERBOSE) console.log(`    ZTT attribute keys: ${Object.keys(rows[0].attributes ?? {}).join(", ")}`);
  for (const r of rows) {
    const a = r.attributes ?? {};
    const img = a.thumbnail?.original ?? a.thumbnail?.large ?? a.thumbnail?.small ?? null;
    if (a.number != null && img) _zttCache.set(Number(a.number), img);
  }
  return _zttCache;
}

async function tmdbSearch(q, year) {
  if (!TMDB_KEY) return [];
  await T.tmdb.wait();
  const j = await getJson(
    `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(TMDB_KEY)}` +
    `&language=en-US&include_adult=false&query=${encodeURIComponent(q)}`
  );
  return (j?.results ?? [])
    .filter((r) => r.poster_path)
    .map((r) => ({
      titles: [r.title, r.name, r.original_title, r.original_name].filter(Boolean),
      image: `https://image.tmdb.org/t/p/w780${r.poster_path}`,
      year: (r.release_date ?? r.first_air_date ?? "").slice(0, 4),
    }))
    .filter((r) => !year || !r.year || Math.abs(Number(r.year) - Number(year)) <= 1);
}

/* --------------------------- resolution --------------------------------- */

async function resolveImage(e) {
  const title = e.title ?? e.slug;
  const year = (e.air_date ?? "").slice(0, 4) || null;

  // 1. explicit overrides
  const ov = TARGETED_OVERRIDES[e.slug];
  if (ov) {
    const url = ov.url ?? (ov.kitsuId ? await kitsuPosterById(ov.kitsuId) : null);
    if (url && (await isLiveImage(url))) return { url, source: ov.url ? "manual" : "kitsu" };
  }

  // 2. Zero's Tea Time per-episode thumbnails (fallback to series poster via override above)
  // Per-episode thumbs are null on Kitsu for this title, so series poster is used.
  if (e.type === "zero_tea_time") {
    // Try per-episode first if episode_number present, then series poster override will catch it above
    const epNum = e.episode_number != null ? Number(e.episode_number) : Number(String(e.slug).match(/\d+/)?.[0]);
    if (Number.isFinite(epNum)) {
      const url = (await zttThumbs()).get(epNum);
      if (url && (await isLiveImage(url))) return { url, source: "kitsu-episode" };
    }
  }

  // 3. DCW infobox image (best coverage for Conan-only extras)
  for (const page of dcwCandidates(e)) {
    const url = await dcwImage(page, title);
    if (url && (await isLiveImage(url))) return { url, source: "dcw" };
  }

  // 4. TMDB first for live action — the only source that indexes it
  if (e.type === "live_action" || e.type === "hanzawa") {
    const hit = bestOf(title, await tmdbSearch(title, year));
    if (hit && (await isLiveImage(hit.image))) return { url: hit.image, source: "tmdb" };
  }

  // 5. Jikan (MAL)
  {
    const hit = bestOf(title, await jikanSearch(title));
    if (hit && (await isLiveImage(hit.image))) return { url: hit.image, source: "mal" };
  }

  // 6. Kitsu search
  {
    const hit = bestOf(title, await kitsuSearchImages(title));
    if (hit && (await isLiveImage(hit.image))) return { url: hit.image, source: "kitsu" };
  }

  // 7. TMDB for anything else, if a key is present
  if (TMDB_KEY) {
    const hit = bestOf(title, await tmdbSearch(title, year));
    if (hit && (await isLiveImage(hit.image))) return { url: hit.image, source: "tmdb" };
  }

  // 8. opt-in local fallback
  if (USE_FALLBACK && TYPE_FALLBACK[e.type]) {
    return { url: TYPE_FALLBACK[e.type], source: "fallback" };
  }

  return null;
}

/* ------------------------------ modes ----------------------------------- */

function selectRows(wantPlaceholder, allRows) {
  let rows = allRows;
  if (TYPES.length) rows = rows.filter((r) => TYPES.includes(r.type));
  if (ONLY.length) rows = rows.filter((r) => ONLY.includes(r.slug));
  return rows.filter((r) => (wantPlaceholder ? isPlaceholder(r.image_url) : !isPlaceholder(r.image_url)));
}

async function runCheck(allRows) {
  const rows = selectRows(false, allRows);
  console.log(`Validating ${rows.length} existing image url(s)...\n`);
  const dead = [];
  for (const r of rows) {
    const ok = await isLiveImage(r.image_url);
    if (!ok) { dead.push(r); console.log(`  DEAD  ${r.type.padEnd(14)} ${r.slug}  ${String(r.image_url).slice(0, 90)}`); }
    else if (VERBOSE) console.log(`  ok    ${r.slug}`);
  }
  console.log(`\n${dead.length} dead / ${rows.length} checked.`);
  if (!dead.length || !APPLY) {
    if (dead.length) console.log("Re-run with --check --apply to reset them to placeholder for refill.");
    return;
  }
  await writeBackup(dead, "precheck");
  for (const r of dead) {
    const { error } = await sb.from("content_entries")
      .update({ image_url: PLACEHOLDER_URL, image_source: "placeholder" })
      .eq("slug", r.slug);
    if (error) { console.error(`reset ${r.slug} failed: ${error.message}`); process.exit(1); }
  }
  console.log(`Reset ${dead.length} row(s) to placeholder. Now run the fill pass.`);
}

async function writeBackup(rows, tag) {
  mkdirSync("scripts/out", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join("scripts/out", `backup-${tag}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`Backup: ${file}`);
}

async function runFill(allRows) {
  const rows = selectRows(true, allRows);
  console.log(`${rows.length} row(s) need an image.`);
  console.log(`TMDB: ${TMDB_KEY ? "enabled" : "DISABLED (set TMDB_API_KEY for live-action coverage)"}`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}  sim>=${MIN_SIM}  fallback=${USE_FALLBACK}\n`);

  const found = [];
  const missing = [];

  for (const e of rows) {
    if (found.length >= LIMIT) { missing.push(e); continue; }
    console.log(`- ${e.type.padEnd(14)} ${e.slug}  "${(e.title ?? "").slice(0, 60)}"`);
    let hit = null;
    try {
      hit = await resolveImage(e);
    } catch (err) {
      console.log(`    ! resolver error: ${err?.message ?? err}`);
    }
    if (hit) { console.log(`    -> [${hit.source}] ${String(hit.url).slice(0, 100)}`); found.push({ e, hit }); }
    else { console.log("    -> no image found"); missing.push(e); }
  }

  if (APPLY && found.length) {
    await writeBackup(found.map((f) => f.e), "preimages");
    for (const { e, hit } of found) {
      const { error } = await sb.from("content_entries")
        .update({ image_url: hit.url, image_source: hit.source })
        .eq("slug", e.slug);
      if (error) { console.error(`update ${e.slug} failed: ${error.message}`); process.exit(1); }
    }
    console.log(`\nAPPLIED — ${found.length} row(s) updated.`);
  } else if (found.length) {
    console.log(`\nDRY RUN — ${found.length} row(s) would be updated. Re-run with --apply.`);
  }

  const bySource = {};
  for (const { hit } of found) bySource[hit.source] = (bySource[hit.source] ?? 0) + 1;
  console.log("\n=== SUMMARY ===");
  console.log(`resolved: ${found.length}`);
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${s.padEnd(14)} ${n}`);
  }
  console.log(`still missing: ${missing.length}`);
  const byType = {};
  for (const m of missing) (byType[m.type] ??= []).push(m.slug);
  for (const [t, slugs] of Object.entries(byType)) {
    console.log(`   ${t} (${slugs.length}): ${slugs.join(", ")}`);
  }
  if (missing.length) {
    console.log(
      "\nThese have no image in DCW, MAL, Kitsu or TMDB — that is an upstream data gap,\n" +
      "not a bug. Options: supply urls via TARGETED_OVERRIDES, or run with --fallback\n" +
      "to assign the per-type placeholder assets."
    );
  }
}

/* ------------------------------- main ----------------------------------- */

try {
  const allRows = await loadAll();
  if (CHECK) await runCheck(allRows);
  else await runFill(allRows);
} catch (err) {
  console.error(`fill-images failed: ${err?.stack ?? err}`);
  process.exitCode = 1;
}
