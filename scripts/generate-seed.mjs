import fs from 'fs';
import { CATALOG, episodeToYear } from './conan-catalog.mjs';

const JIKAN = 'https://api.jikan.moe/v4';
const MAL_ID = 235;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastJikan = 0;
async function jikanFetch(url) {
  const now = Date.now();
  const since = now - lastJikan;
  if (since < 400) await sleep(400 - since);
  lastJikan = Date.now();
  const res = await fetch(url);
  if (res.status === 429) { await sleep(1000); return jikanFetch(url); }
  if (!res.ok) throw new Error('Jikan ' + res.status + ' ' + url);
  return res.json();
}

function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
function sqlNum(n) { return (n === null || n === undefined) ? 'NULL' : String(n); }
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function pad(n) { return String(n).padStart(3, '0'); }

async function getJikanEpisodes() {
  const map = new Map();
  let page = 1, hasNext = true;
  while (hasNext) {
    const j = await jikanFetch(`${JIKAN}/anime/${MAL_ID}/episodes?page=${page}`);
    for (const ep of j.data) map.set(ep.mal_id, { title: ep.title, aired: ep.aired });
    hasNext = j.pagination.has_next_page;
    page++;
  }
  return map;
}

async function getAnimeImage() {
  try {
    const j = await jikanFetch(`${JIKAN}/anime/${MAL_ID}/full`);
    return j.data.images?.jpg?.large_image_url || '';
  } catch { return ''; }
}

async function main() {
  const seriesImage = await getAnimeImage();
  const epMap = await getJikanEpisodes();

  const rows = [];
  let releaseOrder = 0;
  let lastYear = 1996;

  for (const node of CATALOG) {
    if (node.k === 'ep') {
      for (let n = node.f; n <= node.t; n++) {
        releaseOrder++;
        const ep = epMap.get(n);
        const title = ep?.title || `Episode ${pad(n)}`;
        const air = ep?.aired ? ep.aired.slice(0, 10) : `${episodeToYear(n)}-01-01`;
        lastYear = episodeToYear(n);
        rows.push([`ep-${pad(n)}`, title, 'episode', n, null, air, releaseOrder, null, null, seriesImage, null, releaseOrder]);
      }
      continue;
    }

    releaseOrder++;
    let slug, title, type, epNum = null, movNum = null;
    switch (node.k) {
      case 'mov':
        slug = `mov-${String(node.n).padStart(2, '0')}`; title = `Movie ${node.n}`; type = 'movie'; movNum = node.n; break;
      case 'comp':
        slug = `mov-${slugify(node.title)}`; title = node.title; type = 'movie'; break;
      case 'sp':
        slug = `sp-${String(node.n).padStart(2, '0')}`; title = `TV Special ${node.n}`; type = 'special'; break;
      case 'ova':
        slug = `ova-${slugify(node.title)}`; title = node.title; type = 'ova'; break;
      case 'la':
        slug = `la-${slugify(node.title)}`; title = node.title; type = 'live_action'; break;
      case 'mk':
        slug = `mk-${slugify(node.title)}`; title = node.title; type = 'magic_kaito'; break;
      case 'hanzawa':
        slug = `hz-${String(node.n).padStart(2, '0')}`; title = `The Culprit Hanzawa ${node.n}`; type = 'hanzawa'; break;
      case 'zero':
        slug = `ztt-${String(node.n).padStart(2, '0')}`; title = `Zero's Tea Time ${node.n}`; type = 'zero_tea_time'; break;
      default:
        continue;
    }
    const air = `${lastYear}-01-01`;
    rows.push([slug, title, type, epNum, movNum, air, releaseOrder, null, null, null, null, releaseOrder]);
  }

  const cols = ['slug', 'title', 'type', 'episode_number', 'movie_number', 'air_date', 'canon_order', 'arc_id', 'synopsis', 'image_url', 'runtime_minutes', 'release_order'];
  const lines = rows.map((r) =>
    `(${sqlStr(r[0])}, ${sqlStr(r[1])}, ${sqlStr(r[2])}, ${sqlNum(r[3])}, ${sqlNum(r[4])}, ${sqlStr(r[5])}, ${sqlNum(r[6])}, ${sqlNum(r[7])}, ${sqlStr(r[8])}, ${sqlStr(r[9])}, ${sqlNum(r[10])}, ${sqlNum(r[11])})`
  );
  const sql =
    `-- Auto-generated seed: full Detective Conan catalog (Jikan episodes + curated franchise)\n` +
    `-- release_order gives the canonical chronological watch order.\n` +
    `-- Run in Supabase SQL Editor. Idempotent: existing rows get release_order updated,\n` +
    `-- new rows are inserted. Safe to re-run.\n\n` +
    `INSERT INTO content_entries (${cols.join(', ')}) VALUES\n` +
    lines.join(',\n') +
    '\nON CONFLICT (slug) DO UPDATE SET release_order = EXCLUDED.release_order;\n';

  const out = 'C:\\codes\\DCPH-Tracker\\supabase\\seed-content.sql';
  fs.writeFileSync(out, sql);
  console.log(`Wrote ${rows.length} rows to ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
