#!/usr/bin/env node
/**
 * Health check for the 4 external data sources + Supabase.
 * None of the 4 anime APIs require an API key; this verifies reachability,
 * response shape and latency. Read-only, safe to run any time.
 *
 *   node --env-file=.env.local scripts/api-health-check.mjs
 */

const UA = 'DCPH-Tracker-HealthCheck/1.0 (local dev script)';
const TIMEOUT_MS = 15000;

async function timed(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t0, detail };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, detail: err?.message ?? String(err) };
  }
}

async function getJson(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.slice(0, 160).replace(/\s+/g, ' ');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${snippet}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response (${text.slice(0, 120).replace(/\s+/g, ' ')})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

const checks = [
  () =>
    timed('Jikan (MAL)  api.jikan.moe/v4', async () => {
      const j = await getJson('https://api.jikan.moe/v4/anime/235');
      const t = j?.data?.title;
      if (!t) throw new Error('missing data.title');
      return `anime/235 -> "${t}"`;
    }),

  () =>
    timed('Kitsu        kitsu.io/api/edge', async () => {
      const j = await getJson('https://kitsu.io/api/edge/anime/210', {
        headers: { Accept: 'application/vnd.api+json' },
      });
      const a = j?.data?.attributes;
      if (!a) throw new Error('missing data.attributes');
      return `anime/210 -> "${a.canonicalTitle}" (episodeCount=${a.episodeCount ?? 'null'})`;
    }),

  () =>
    timed('Kitsu search filter[text]', async () => {
      const url =
        'https://kitsu.io/api/edge/anime?filter%5Btext%5D=magic%20kaito&page%5Blimit%5D=3';
      const j = await getJson(url, { headers: { Accept: 'application/vnd.api+json' } });
      const n = Array.isArray(j?.data) ? j.data.length : 0;
      if (n === 0) throw new Error('search returned 0 rows');
      return `"magic kaito" -> ${n} hits (first: ${j.data[0].attributes.canonicalTitle})`;
    }),

  () =>
    timed('AniList      graphql.anilist.co', async () => {
      const j = await getJson('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query ($id: Int) {
            Media(id: $id, type: ANIME) {
              id
              title { romaji }
              nextAiringEpisode { episode airingAt }
            }
          }`,
          variables: { id: 235 },
        }),
      });
      if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
      const m = j?.data?.Media;
      if (!m) throw new Error('missing data.Media');
      const next = m.nextAiringEpisode
        ? `next ep ${m.nextAiringEpisode.episode} @ ${new Date(
            m.nextAiringEpisode.airingAt * 1000,
          ).toISOString()}`
        : 'no nextAiringEpisode';
      return `Media(235) "${m.title.romaji}" -> ${next}`;
    }),

  () =>
    timed('DCW wiki     detectiveconanworld.com', async () => {
      const url =
        'https://www.detectiveconanworld.com/wiki/api.php?action=query&meta=siteinfo&siprop=general&format=json';
      const j = await getJson(url);
      const g = j?.query?.general;
      if (!g) throw new Error('missing query.general');
      return `${g.sitename} / ${g.generator}`;
    }),

  () =>
    timed('DCW categorymembers TV Specials', async () => {
      const url =
        'https://www.detectiveconanworld.com/wiki/api.php?action=query&list=categorymembers' +
        '&cmtitle=Category%3ATV_Specials&cmlimit=500&format=json';
      const j = await getJson(url);
      const members = j?.query?.categorymembers ?? [];
      if (members.length === 0) throw new Error('0 members (category name may differ)');
      return `${members.length} members (e.g. "${members[0].title}")`;
    }),

  () =>
    timed('Supabase     REST + service role', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
      if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
      const res = await fetch(`${url}/rest/v1/?select=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return `reachable @ ${new URL(url).host} (service role len=${key.length})`;
    }),
];

const results = [];
for (const c of checks) results.push(await c());

const pad = Math.max(...results.map((r) => r.name.length));
console.log('');
for (const r of results) {
  console.log(
    `${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(pad)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`,
  );
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
console.log('Note: Jikan / Kitsu / AniList / DCW are all keyless public APIs — no API keys to rotate.');
process.exit(failed.length ? 1 : 0);
