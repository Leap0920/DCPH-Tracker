#!/usr/bin/env node
/**
 * DCPH-Tracker catalog curation.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 * Episode rows (type='episode', 1..1209) are never written and are asserted
 * untouched at the end.
 *
 *   node --env-file=.env.local scripts/curate-catalog.mjs
 *   node --env-file=.env.local scripts/curate-catalog.mjs --phases=deletes,fields,renames,order
 *   node --env-file=.env.local scripts/curate-catalog.mjs --apply
 *   node --env-file=.env.local scripts/curate-catalog.mjs --phases=enrich --apply
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ CONFIG */
/* Verified against the real schema: table `content_entries`, column `type`,
   image source column `image_source`. */
const CONFIG = {
  table: process.env.CATALOG_TABLE ?? 'content_entries',
  col: {
    slug: 'slug',
    type: 'type',
    title: 'title',
    airDate: 'air_date',
    synopsis: 'synopsis',
    image: 'image_url',
    releaseOrder: 'release_order',
    canonOrder: 'canon_order',
    movieNumber: 'movie_number',
    episodeNumber: 'episode_number',
    source: 'image_source',
  },
  episodeType: 'episode',
  outDir: 'scripts/out',
};
const C = CONFIG.col;

/* ------------------------------------------------------------------- FLAGS */
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const VERBOSE = argv.includes('--verbose');
const phaseArg = argv.find((a) => a.startsWith('--phases='));
const PHASES = new Set(
  (phaseArg ? phaseArg.split('=')[1] : 'deletes,fields,renames,order')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const enrichLimitArg = argv.find((a) => a.startsWith('--enrich-limit='));
const ENRICH_LIMIT = enrichLimitArg ? Number(enrichLimitArg.split('=')[1]) : 40;

/* --------------------------------------------------------- CURATION TABLES */

/** Rows to remove. Reason is printed in the diff and stored in the backup. */
const DELETE_SLUGS = {
  // --- duplicates / user-requested removals: movies -------------------------
  'mov-cross-over-movie-lupin-vs-conan': 'dup of mov-37 (Lupin III vs. DC: The Movie)',
  'mov-compilation-movie-scarlet-alibi': 'dup of mov-46 (The Scarlet Alibi)',
  'mov-compilation-movie-conan-vs-kid': 'user: remove all Conan vs Kid',
  'mov-59': 'user: remove all Conan vs Kid (Shark & Jewel)',
  'mov-61': 'user: remove all Conan vs Kid (Jet Black Sniper)',
  // --- OVA duplicates ------------------------------------------------------
  'ova-01': 'user: remove Conan vs Kid + dup of mov-61, wrong air date',
  'ova-02': 'descriptive-title dup of ova-shogakukan-01',
  'ova-03': 'descriptive-title dup of ova-shogakukan-02',
  'ova-04': 'descriptive-title dup of ova-shogakukan-03',
  'ova-06': 'descriptive-title dup of ova-shogakukan-04',
  'ova-07': 'descriptive-title dup of ova-shogakukan-05',
  'ova-08': 'descriptive-title dup of ova-shogakukan-06',
  'ova-10': 'descriptive-title dup of ova-shogakukan-07',
  'ova-12': 'descriptive-title dup of ova-shogakukan-09',
  'ova-18': 'dup of ova-magic-file-01',
  'ova-30': 'dup of ova-detective-conan-vs-wooo-01-02',
  'ova-15': 'PSA short (Anti-Crime Guide), not catalogue content',
  // NOTE: add 'ova-27' here if the dry-run confirms it duplicates ova-bonus-file-01.
  // --- Specials: keep TV specials only -------------------------------------
  'sp-09': 'CM, not a TV special',
  'sp-10': 'CM, not a TV special',
  'sp-11': 'promo video (TDK head cleaner), not a TV special',
  'sp-13': 'mis-titled dup of Movie 8',
  'sp-14': 'movie pre-release promo',
  'sp-15': 'movie promo',
  'sp-16': 'movie promo',
  'sp-17': 'recap (Black History 1)',
  'sp-18': 'recap (Black History 2)',
  'sp-21': 'new year filler segment, not a TV special',
  'sp-22': 'wrong franchise (Arslan Senki)',
  'sp-12': 'series umbrella dup of ova-aoyama-short-stories-part-1/-part-2-extra',
  'sp-20': 'series umbrella dup of mk-magic-kaito-special-* (2010 Magic Kaito)',
  'special-lupin-vs-conan-2009': 'dup of sp-19 (keeping the dcw-sourced sp- row)',
  // --- confirmed via dry-run rename proposal (DCW Category:Specials) --------
  'sp-03': 'leftover 2009 slot; the 2009 TV special (Lupin III vs Conan) is sp-19',
  'sp-08': 'leftover 2023 slot; no such special exists in DCW Category:Specials',
  'sp-23': 'JP-titled dup of sp-06 (Episode One: The Great Detective Turned Small, same 2016-12-09 air date)',
  'ova-31': 'dup of sp-04 (Fugitive: Kogoro Mouri, 2014 TV special)',
  // --- Magic File duplicates: full-titled twins with non-conforming slugs.
  // Their title/synopsis/image were merged onto ova-magic-file-02..05 by
  // scripts/merge-dupes.mjs before this delete. ova-magic-file-01 has no twin.
  'ova-20': 'dupe of ova-magic-file-02 (Magic File 2) — data merged, bad slug dropped',
  'ova-21': 'dupe of ova-magic-file-03 (Magic File 3) — data merged, bad slug dropped',
  'ova-24': 'dupe of ova-magic-file-04 (Magic File 4) — data merged, bad slug dropped',
  'ova-25': 'dupe of ova-magic-file-05 (Magic File 5) — data merged, bad slug dropped',
  // --- Yaiba: user requested removal of the entire series.
  'yaiba-swordsman-legend-1993': 'user: remove Yaiba series',
  'yaiba-samurai-legend-2025': 'user: remove Yaiba series',
};

/** Rows kept on purpose but flagged for human eyes in the report. */
const REVIEW_NOTES = {
  'mov-33': 'verify "The Magician of Starlight" (2012) is a real work, not a bad upstream row',
  'mov-41': 'Manner Movie: theatre-etiquette short, kept as Other Movie',
  'ova-27': 'possible dup of ova-bonus-file-01 (Fantasista Flower) — compare titles',
};

/** Deterministic field fixes. Only listed keys are written. */
const FIELD_OVERRIDES = {
  'mov-37': {
    [C.title]: 'Lupin III vs. Detective Conan: The Movie',
    [C.airDate]: '2013-12-07',
  },
  'sp-19': {
    [C.title]: 'Lupin III vs. Detective Conan',
    [C.airDate]: '2009-03-27',
  },
  'mov-46': {
    [C.title]: 'The Scarlet Alibi',
    [C.airDate]: '2021-02-11',
  },
  // Real air dates merged conceptually from the deleted Magic File twins
  // (keepers had placeholder Jan-1 dates; twins carried the true ones).
  'ova-magic-file-02': { [C.airDate]: '2008-04-19' },
  'ova-magic-file-03': { [C.airDate]: '2009-04-18' },
  'ova-magic-file-04': { [C.airDate]: '2010-04-17' },
  'ova-magic-file-05': { [C.airDate]: '2011-04-16' },
};

/** content_type changes. Empty by default — see REVIEW_NOTES for candidates. */
const RETYPE = {
  // 'ova-31': 'special',
};

/** Force sort position: slug -> [groupPriority, indexWithinGroup]. */
const SORT_KEY_OVERRIDES = {
  'ova-27': [4, 3], // Bonus File: Fantasista Flower -> after bonus-file-01/-02
};

/** DCW categories consulted for the sp-01..sp-08 rename proposal.
 *  Verified live: DCW has no "Category:TV Specials" — the specials category
 *  is "Category:Specials". */
const DCW_TV_SPECIAL_CATEGORY = 'Category:Specials';
const GENERIC_SPECIAL_RE = /^(TV Special \d+|Special \d+|Untitled.*)$/i;

/* ------------------------------------------------------------------- UTILS */
const UA = 'DCPH-Tracker-Curator/1.0 (local dev script; contact: repo owner)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(msg) {
  console.error(`\nABORT: ${msg}\n`);
  process.exit(1);
}

function numsIn(s) {
  return (String(s).match(/\d+/g) ?? []).map(Number);
}
function firstNum(s, fallback = 9999) {
  const n = numsIn(s);
  return n.length ? n[0] : fallback;
}
function lastNum(s, fallback = 9999) {
  const n = numsIn(s);
  return n.length ? n[n.length - 1] : fallback;
}
function dateKey(row) {
  const d = row[C.airDate];
  if (!d) return 99999999;
  const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1] + m[2] + m[3]);
  const y = String(d).match(/(19|20)\d{2}/);
  return y ? Number(y[0]) * 10000 : 99999999;
}
function normTitle(t) {
  return String(t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(detective conan|meitantei conan|the movie|movie|episode|special|ova)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function jaccard(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function isPlaceholderImage(v) {
  if (!v) return true;
  return /placeholder|no[-_]?image|default/i.test(String(v));
}
function isThinSynopsis(v) {
  return !v || String(v).trim().length < 40;
}

/* ------------------------------------------------------------------ CLIENT */
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --env-file=.env.local)');
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function loadAll() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from(CONFIG.table)
      .select('*')
      .order(C.slug, { ascending: true })
      .range(from, from + page - 1);
    if (error) die(`load failed: ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

/* ------------------------------------------------------------ ORDER ENGINE */
/**
 * Returns [groupPriority, indexWithinGroup] for a non-episode row.
 * Group priority encodes the subcategory display order the user asked for.
 */
function sortKey(row) {
  const slug = String(row[C.slug] ?? '');
  const title = String(row[C.title] ?? '');
  if (SORT_KEY_OVERRIDES[slug]) return SORT_KEY_OVERRIDES[slug];

  switch (row[C.type]) {
    case 'movie': {
      const mn = row[C.movieNumber];
      if (mn != null) return [0, Number(mn)];
      return [1, dateKey(row)]; // Other Movies, chronological
    }

    case 'special':
      return [0, dateKey(row)]; // TV specials, chronological

    case 'ova': {
      const m = title.match(/\bOVA\s*0*(\d+)/i);
      if (m) return [0, Number(m[1])]; // OVA 01..13
      if (/aoyama[-_ ]?short[-_ ]?stories/i.test(slug) || /short stories/i.test(title))
        return [1, lastNum(slug, 1)];
      if (/secret[-_ ]?file/i.test(slug) || /secret file/i.test(title))
        return [2, lastNum(slug)];
      if (/magic[-_ ]?file/i.test(slug) || /magic file/i.test(title))
        return [3, lastNum(slug)];
      if (/bonus[-_ ]?file/i.test(slug) || /bonus file/i.test(title))
        return [4, lastNum(slug)];
      if (/shogakukan/i.test(slug) || /shogakukan/i.test(title))
        return [5, lastNum(slug)];
      if (/wooo/i.test(slug) || /wooo/i.test(title)) return [6, lastNum(slug)];
      return [7, dateKey(row)];
    }

    case 'magic_kaito': {
      if (slug.includes('mk-magic-kaito-special-'))
        return [0, firstNum(slug.split('mk-magic-kaito-special-')[1] ?? '')];
      if (slug.includes('mk-magic-kaito-1412-'))
        return [1, firstNum(slug.split('mk-magic-kaito-1412-')[1] ?? '')];
      return [9, dateKey(row)];
    }

    case 'live_action': {
      const g = /special/i.test(slug) || /special/i.test(title) ? 0 : 1;
      return [g, firstNum(slug.replace(/^[^0-9]*/, ''))];
    }

    case 'hanzawa':
    case 'zero_tea_time':
      return [0, firstNum(slug.replace(/^[^0-9]*/, ''))];

    case 'yaiba':
      return [0, dateKey(row)];

    default:
      return [9, dateKey(row)];
  }
}

/* --------------------------------------------------------------- DCW CALLS */
let lastDcw = 0;
async function dcw(params) {
  const wait = 1100 - (Date.now() - lastDcw);
  if (wait > 0) await sleep(wait);
  lastDcw = Date.now();
  const qs = new URLSearchParams({ format: 'json', ...params });
  const res = await fetch(`https://www.detectiveconanworld.com/wiki/api.php?${qs}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DCW HTTP ${res.status}`);
  return res.json();
}

async function dcwCategoryMembers(cmtitle) {
  const out = [];
  let cont;
  do {
    const j = await dcw({
      action: 'query',
      list: 'categorymembers',
      cmtitle,
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    out.push(...(j?.query?.categorymembers ?? []));
    cont = j?.continue?.cmcontinue;
  } while (cont);
  return out.filter((m) => m.ns === 0);
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
function parseLooseDate(s) {
  if (!s) return null;
  const txt = String(s).replace(/\[\[|\]\]|<[^>]+>/g, ' ');
  let m = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, year: Number(m[1]) };
  m = txt.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+((?:19|20)\d{2})/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mm = String(MONTHS[m[1].toLowerCase()]).padStart(2, '0');
    const dd = String(Number(m[2])).padStart(2, '0');
    return { iso: `${m[3]}-${mm}-${dd}`, year: Number(m[3]) };
  }
  m = txt.match(/(19|20)\d{2}/);
  return m ? { iso: null, year: Number(m[0]) } : null;
}

async function dcwPageMeta(title) {
  const j = await dcw({
    action: 'query',
    prop: 'revisions|extracts|pageimages',
    rvprop: 'content',
    rvslots: 'main',
    explaintext: '1',
    exintro: '1',
    piprop: 'original',
    redirects: '1',
    titles: title,
  });
  const pages = j?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;
  const wikitext =
    page.revisions?.[0]?.slots?.main?.['*'] ?? page.revisions?.[0]?.['*'] ?? '';
  const field =
    wikitext.match(/\|\s*(?:airdate|air_date|original_?airdate|jp_?airdate)\s*=\s*([^\n|}]+)/i)?.[1] ??
    null;
  const date = parseLooseDate(field) ?? parseLooseDate(page.extract) ?? null;
  return {
    title: page.title,
    date,
    extract: (page.extract ?? '').trim() || null,
    image: page.original?.source ?? null,
  };
}

/* ----------------------------------------------------------------- KITSU CALL */
let lastKitsu = 0;
async function kitsuSearch(text) {
  const wait = 450 - (Date.now() - lastKitsu);
  if (wait > 0) await sleep(wait);
  lastKitsu = Date.now();
  const qs = new URLSearchParams({ 'filter[text]': text, 'page[limit]': '10' });
  const res = await fetch(`https://kitsu.io/api/edge/anime?${qs}`, {
    headers: { Accept: 'application/vnd.api+json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
  const j = await res.json();
  return (j?.data ?? []).map((d) => ({
    title: d.attributes.canonicalTitle,
    titles: Object.values(d.attributes.titles ?? {}).filter(Boolean),
    synopsis: d.attributes.synopsis,
    image: d.attributes.posterImage?.original ?? d.attributes.posterImage?.large ?? null,
    startDate: d.attributes.startDate,
  }));
}

/* ----------------------------------------------------------------- WRITERS */
const writeLog = [];
async function doUpdate(slug, patch, why) {
  writeLog.push({ op: 'update', slug, patch, why });
  if (!APPLY) return;
  const { error } = await sb.from(CONFIG.table).update(patch).eq(C.slug, slug);
  if (error) die(`update ${slug} failed: ${error.message}`);
}
async function doDelete(slugs) {
  for (const s of slugs) writeLog.push({ op: 'delete', slug: s, why: DELETE_SLUGS[s] });
  if (!APPLY) return;
  for (let i = 0; i < slugs.length; i += 50) {
    const batch = slugs.slice(i, i + 50);
    const { error } = await sb.from(CONFIG.table).delete().in(C.slug, batch);
    if (error) die(`delete batch failed: ${error.message}`);
  }
}

/* -------------------------------------------------------------------- MAIN */
console.log(`\n=== curate-catalog  mode=${APPLY ? 'APPLY (WRITES)' : 'DRY RUN'}  phases=${[...PHASES].join(',')} ===`);

let rows = await loadAll();
const episodes = rows.filter((r) => r[C.type] === CONFIG.episodeType);
let others = rows.filter((r) => r[C.type] !== CONFIG.episodeType);
const episodeSlugs = new Set(episodes.map((r) => r[C.slug]));
const bySlug = new Map(rows.map((r) => [r[C.slug], r]));

console.log(`loaded ${rows.length} rows: ${episodes.length} episodes (frozen) + ${others.length} others`);

/* guard: nothing in our tables may target an episode row */
for (const s of [...Object.keys(DELETE_SLUGS), ...Object.keys(FIELD_OVERRIDES), ...Object.keys(RETYPE)])
  if (episodeSlugs.has(s)) die(`curation table targets EPISODE row "${s}" — refusing to run`);

/* backup before any destructive apply */
mkdirSync(CONFIG.outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (APPLY) {
  const file = path.join(CONFIG.outDir, `backup-non-episode-${stamp}.json`);
  writeFileSync(file, JSON.stringify(others, null, 2));
  console.log(`backup of ${others.length} non-episode rows -> ${file}`);
}

/* ---- phase: deletes ---- */
if (PHASES.has('deletes')) {
  const present = Object.keys(DELETE_SLUGS).filter((s) => bySlug.has(s));
  const missing = Object.keys(DELETE_SLUGS).filter((s) => !bySlug.has(s));
  console.log(`\n-- DELETES (${present.length} present, ${missing.length} already gone) --`);
  for (const s of present) {
    const r = bySlug.get(s);
    console.log(`  del ${s.padEnd(38)} [${r[C.type]}] "${r[C.title]}"  <- ${DELETE_SLUGS[s]}`);
  }
  if (missing.length && VERBOSE) console.log(`  (absent: ${missing.join(', ')})`);
  await doDelete(present);
  const gone = new Set(present);
  others = others.filter((r) => !gone.has(r[C.slug])); // simulate for later phases too
  for (const s of present) bySlug.delete(s);
}

/* ---- phase: fields (deterministic overrides + retypes) ---- */
if (PHASES.has('fields')) {
  console.log('\n-- FIELD OVERRIDES / RETYPES --');
  for (const [slug, patch] of Object.entries(FIELD_OVERRIDES)) {
    const r = bySlug.get(slug);
    if (!r) { console.log(`  skip ${slug} (absent)`); continue; }
    const diff = {};
    for (const [k, v] of Object.entries(patch)) if (String(r[k] ?? '') !== String(v)) diff[k] = v;
    if (!Object.keys(diff).length) { if (VERBOSE) console.log(`  ok   ${slug} already correct`); continue; }
    console.log(`  set  ${slug.padEnd(38)} ${JSON.stringify(diff)}`);
    await doUpdate(slug, diff, 'field override');
    Object.assign(r, diff);
  }
  for (const [slug, type] of Object.entries(RETYPE)) {
    const r = bySlug.get(slug);
    if (!r || r[C.type] === type) continue;
    console.log(`  type ${slug.padEnd(38)} ${r[C.type]} -> ${type}`);
    await doUpdate(slug, { [C.type]: type }, 'retype');
    r[C.type] = type;
  }
}

/* ---- phase: renames (DCW-sourced TV special titles) ---- */
if (PHASES.has('renames')) {
  console.log('\n-- TV SPECIAL RENAME PROPOSAL (source: DCW) --');
  const generic = others
    .filter((r) => r[C.type] === 'special' && GENERIC_SPECIAL_RE.test(String(r[C.title] ?? '')))
    .sort((a, b) => String(a[C.slug]).localeCompare(String(b[C.slug])));

  if (!generic.length) {
    console.log('  no generic-titled specials left, nothing to rename');
  } else {
    const members = await dcwCategoryMembers(DCW_TV_SPECIAL_CATEGORY);
    console.log(`  DCW ${DCW_TV_SPECIAL_CATEGORY}: ${members.length} members; fetching metadata (throttled ~1/s)`);

    const known = others
      .filter((r) => r[C.type] === 'special' && !GENERIC_SPECIAL_RE.test(String(r[C.title] ?? '')))
      .map((r) => normTitle(r[C.title]));

    const candidates = [];
    for (const m of members) {
      let meta = null;
      try { meta = await dcwPageMeta(m.title); } catch (e) { console.log(`  warn ${m.title}: ${e.message}`); }
      if (!meta?.date?.year) { if (VERBOSE) console.log(`  skip ${m.title} (no air date found)`); continue; }
      const n = normTitle(meta.title);
      if (known.some((k) => jaccard(k, n) >= 0.6)) { if (VERBOSE) console.log(`  skip ${meta.title} (already in DB)`); continue; }
      candidates.push(meta);
    }

    const proposal = [];
    const byYearRows = new Map();
    for (const r of generic) {
      const y = Math.floor(dateKey(r) / 10000);
      if (!byYearRows.has(y)) byYearRows.set(y, []);
      byYearRows.get(y).push(r);
    }
    for (const [year, rowsForYear] of byYearRows) {
      const cands = candidates
        .filter((c) => c.date.year === year)
        .sort((a, b) => String(a.date.iso ?? '').localeCompare(String(b.date.iso ?? '')));
      if (cands.length === rowsForYear.length) {
        rowsForYear.forEach((r, i) =>
          proposal.push({ slug: r[C.slug], from: r[C.title], to: cands[i].title, airDate: cands[i].date.iso, confident: true }),
        );
      } else {
        rowsForYear.forEach((r) =>
          proposal.push({
            slug: r[C.slug], from: r[C.title], to: null, confident: false,
            year, candidates: cands.map((c) => `${c.title} (${c.date.iso ?? c.date.year})`),
          }),
        );
      }
    }

    const file = path.join(CONFIG.outDir, `tv-special-rename-proposal-${stamp}.json`);
    writeFileSync(file, JSON.stringify(proposal, null, 2));
    console.log(`  proposal -> ${file}`);
    for (const p of proposal) {
      if (p.confident) {
        console.log(`  ren  ${p.slug.padEnd(10)} "${p.from}" -> "${p.to}" (${p.airDate ?? 'date unchanged'})`);
        const patch = { [C.title]: p.to, [C.source]: 'dcw' };
        if (p.airDate) patch[C.airDate] = p.airDate;
        await doUpdate(p.slug, patch, 'DCW TV special rename');
        Object.assign(bySlug.get(p.slug) ?? {}, patch);
      } else {
        console.log(`  REVIEW ${p.slug} year=${p.year}: ${p.candidates.length} DCW candidates -> ${p.candidates.join(' | ') || '(none)'}`);
      }
    }
  }
}

/* ---- phase: order ---- */
if (PHASES.has('order')) {
  console.log('\n-- RELEASE ORDER (dense 1..N per content_type) --');
  const byType = new Map();
  for (const r of others) {
    if (!byType.has(r[C.type])) byType.set(r[C.type], []);
    byType.get(r[C.type]).push(r);
  }
  let changed = 0;
  for (const [type, list] of [...byType.entries()].sort()) {
    const keyed = list.map((r) => ({ r, k: sortKey(r) }));
    keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || String(a.r[C.slug]).localeCompare(String(b.r[C.slug])));
    console.log(`  ${type} (${keyed.length})`);
    for (let i = 0; i < keyed.length; i++) {
      const { r, k } = keyed[i];
      const next = i + 1;
      const note = k[0] === 9 || k[1] === 9999 || k[1] === 99999999 ? '  <-- UNCLASSIFIED, check' : '';
      if (Number(r[C.releaseOrder] ?? NaN) !== next) {
        changed++;
        console.log(`    ${String(next).padStart(3)}  ${String(r[C.slug]).padEnd(38)} was=${r[C.releaseOrder] ?? 'NULL'}  "${r[C.title]}"${note}`);
        await doUpdate(r[C.slug], { [C.releaseOrder]: next }, `order ${type}`);
        r[C.releaseOrder] = next;
      } else if (VERBOSE) {
        console.log(`    ${String(next).padStart(3)}  ${String(r[C.slug]).padEnd(38)} unchanged${note}`);
      }
    }
  }
  console.log(`  ${changed} release_order values need writing`);
}

/* ---- phase: enrich (opt-in) ---- */
if (PHASES.has('enrich')) {
  console.log(`\n-- ENRICH (fills only NULL/placeholder synopsis+image, limit=${ENRICH_LIMIT}) --`);
  const targets = others
    .filter((r) => isThinSynopsis(r[C.synopsis]) || isPlaceholderImage(r[C.image]))
    .sort((a, b) => String(a[C.type]).localeCompare(String(b[C.type])) || Number(a[C.releaseOrder] ?? 0) - Number(b[C.releaseOrder] ?? 0))
    .slice(0, ENRICH_LIMIT);
  console.log(`  ${targets.length} candidate rows this pass`);

  for (const r of targets) {
    const title = String(r[C.title] ?? '');
    if (!title) continue;
    const patch = {};

    // 1) DCW article (best prose for franchise-specific works)
    try {
      const meta = await dcwPageMeta(title);
      if (meta) {
        if (isThinSynopsis(r[C.synopsis]) && meta.extract) patch[C.synopsis] = meta.extract.slice(0, 1200);
        if (isPlaceholderImage(r[C.image]) && meta.image) patch[C.image] = meta.image;
      }
    } catch (e) { console.log(`  warn dcw "${title}": ${e.message}`); }

    // 2) Kitsu fallback
    if (isThinSynopsis(patch[C.synopsis] ?? r[C.synopsis]) || isPlaceholderImage(patch[C.image] ?? r[C.image])) {
      try {
        const hits = await kitsuSearch(title);
        const nt = normTitle(title);
        const best = hits
          .map((h) => ({ h, s: Math.max(jaccard(nt, normTitle(h.title)), ...h.titles.map((t) => jaccard(nt, normTitle(t)))) }))
          .sort((a, b) => b.s - a.s)[0];
        if (best && best.s >= 0.5) {
          if (isThinSynopsis(patch[C.synopsis] ?? r[C.synopsis]) && best.h.synopsis)
            patch[C.synopsis] = String(best.h.synopsis).slice(0, 1200);
          if (isPlaceholderImage(patch[C.image] ?? r[C.image]) && best.h.image)
            patch[C.image] = best.h.image;
        }
      } catch (e) { console.log(`  warn kitsu "${title}": ${e.message}`); }
    }

    if (!Object.keys(patch).length) { console.log(`  --   ${r[C.slug]} no data found for "${title}"`); continue; }
    console.log(`  fill ${String(r[C.slug]).padEnd(38)} ${Object.keys(patch).join('+')}`);
    await doUpdate(r[C.slug], patch, 'enrich');
    Object.assign(r, patch);
  }
}

/* ---- verify ---- */
console.log('\n-- VERIFY --');
const finalRows = APPLY ? await loadAll() : rows.filter((r) => !(PHASES.has('deletes') && DELETE_SLUGS[r[C.slug]]));
const finalEpisodes = finalRows.filter((r) => r[C.type] === CONFIG.episodeType);
const finalOthers = finalRows.filter((r) => r[C.type] !== CONFIG.episodeType);

const epNums = finalEpisodes.map((r) => Number(r[C.episodeNumber])).filter((n) => Number.isFinite(n));
console.log(`  episodes: ${finalEpisodes.length} (min=${Math.min(...epNums)} max=${Math.max(...epNums)})  expected 1209/1/1209`);
if (finalEpisodes.length !== episodes.length) console.log('  !! EPISODE COUNT CHANGED — investigate immediately');
if (writeLog.some((w) => episodeSlugs.has(w.slug))) console.log('  !! an episode slug appears in the write log');

const counts = {};
for (const r of finalOthers) counts[r[C.type]] = (counts[r[C.type]] ?? 0) + 1;
for (const [t, n] of Object.entries(counts).sort()) console.log(`  ${t.padEnd(14)} ${n}`);

const nullOrder = finalOthers.filter((r) => r[C.releaseOrder] == null);
if (PHASES.has('order')) console.log(`  null release_order: ${nullOrder.length}${nullOrder.length ? ' -> ' + nullOrder.map((r) => r[C.slug]).join(', ') : ' (good)'}`);

for (const [t, list] of Object.entries(
  finalOthers.reduce((acc, r) => ((acc[r[C.type]] ??= []).push(r), acc), {}),
)) {
  const seen = new Map();
  for (const r of list) {
    const o = r[C.releaseOrder];
    if (o == null) continue;
    if (seen.has(o)) console.log(`  !! duplicate release_order ${o} in ${t}: ${seen.get(o)} vs ${r[C.slug]}`);
    seen.set(o, r[C.slug]);
  }
}

console.log('  near-duplicate titles (same type, same year, jaccard>=0.7):');
let dupFound = 0;
for (let i = 0; i < finalOthers.length; i++)
  for (let j = i + 1; j < finalOthers.length; j++) {
    const a = finalOthers[i], b = finalOthers[j];
    if (a[C.type] !== b[C.type]) continue;
    if (Math.floor(dateKey(a) / 10000) !== Math.floor(dateKey(b) / 10000)) continue;
    if (jaccard(normTitle(a[C.title]), normTitle(b[C.title])) >= 0.7) {
      dupFound++;
      console.log(`    ${a[C.slug]} "${a[C.title]}"  ~=  ${b[C.slug]} "${b[C.title]}"`);
    }
  }
if (!dupFound) console.log('    none');

console.log('  review notes:');
for (const [slug, note] of Object.entries(REVIEW_NOTES))
  if (finalOthers.some((r) => r[C.slug] === slug)) console.log(`    ${slug.padEnd(20)} ${note}`);

const summary = writeLog.reduce((a, w) => ((a[w.op] = (a[w.op] ?? 0) + 1), a), {});
console.log(`\n${APPLY ? 'APPLIED' : 'WOULD APPLY'}: ${JSON.stringify(summary)}`);
const logFile = path.join(CONFIG.outDir, `curate-${APPLY ? 'applied' : 'dryrun'}-${stamp}.json`);
writeFileSync(logFile, JSON.stringify(writeLog, null, 2));
console.log(`write log -> ${logFile}`);
if (!APPLY) console.log('re-run with --apply to write.\n');
