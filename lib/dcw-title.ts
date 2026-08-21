// lib/dcw-title.ts
// SINGLE SOURCE OF TRUTH for "DCPH content_entries.title -> Detective Conan World
// article title". Both the image path (lib/dcw-images.ts) and the wiki-details
// path (lib/dcw-episode.ts) MUST resolve through this module. No other file may
// implement title normalisation, fuzzy matching, or search fallback.
//
// Resolution ladder, cheapest and most reliable first:
//   0. knownDcwTitle  - already stored in the DB from a previous run (trusted)
//   1. number         - episode_number -> article, via the number index
//   2. exact          - normalised string equality against the category dump
//   3. fuzzy          - trigram + token scoring against the category dump
//   4. search         - list=search, scored, multiple candidate strings tried
// Every candidate is then EXISTENCE-VERIFIED in one batched request before it is
// handed downstream, so we never return a title that 404s into a placeholder.

import { chunkArray, dcwQuery } from "./dcw";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DcwTitleInput = {
  /** content_entries.id, echoed back so callers can zip results. */
  id: string;
  /** Primary title from Jikan/Kitsu. */
  title: string;
  /** Japanese title, romaji, alternate translations. */
  aliases?: string[];
  /** Canonical broadcast episode number. The most reliable key we have. */
  episodeNumber?: number | null;
  /** 'episode' | 'movie' | 'ova' | 'special' | 'manga' */
  contentType?: string;
  /** Previously resolved + verified DCW title. Trusted, skips all lookup. */
  knownDcwTitle?: string | null;
};

export type DcwTitleVia = "known" | "number" | "exact" | "fuzzy" | "search" | "none";

export type DcwTitleMatch = {
  id: string;
  /** Canonical DCW article title, post-redirect, verified to exist. */
  title: string | null;
  /** 0..1 confidence. 1 for known/number/exact. */
  score: number;
  via: DcwTitleVia;
  /** True when we are confident enough to persist this to the DB. */
  persist: boolean;
};

/** Fuzzy accept threshold. Calibrate against real data before lowering. */
const FUZZY_MIN = 0.58;
/** A fuzzy win must beat the runner-up by this much, else it is ambiguous. */
const FUZZY_MARGIN = 0.04;
/** Search hits are relevance-ranked but must still clear this bar. */
const SEARCH_MIN = 0.45;

export const DCW_CATEGORY_BY_TYPE: Record<string, string> = {
  episode: "Episodes",
  movie: "Movies",
  ova: "OVAs",
  special: "TV Specials",
  manga: "Manga Volumes",
};

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Punctuation and unicode folding shared by every normaliser. */
function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/&/g, " and ")
    .replace(/\bvs\.?\b/g, "vs")
    .replace(/\bdr\.?\b/g, "dr")
    .replace(/\bmr\.?\b/g, "mr")
    .replace(/\bms\.?\b/g, "ms")
    .replace(/\bmrs\.?\b/g, "mrs");
}

/**
 * Strips the things that differ between Jikan and DCW but carry no meaning:
 * parentheticals, "Part N", part-of-episode markers, and the leading article.
 * Deliberately KEEPS "case", "detective", "mystery" - dropping them, as the old
 * lib/dcw-images.ts normalizeTitle did, destroys the signal that separates
 * hundreds of similarly-shaped episode titles.
 */
export function normalizeTitle(value: string): string {
  return fold(value)
    .replace(/\((?:[^()]*)\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:part|pt)\.?\s*(?:\d+|[ivx]+|one|two|three|four|five)\b/g, " ")
    .replace(/\b(?:episode|ep|eps)\.?\s*\d+\b/g, " ")
    .replace(/\bdetective conan\b/g, " ")
    .replace(/\bcase closed\b/g, " ")
    .replace(/^\s*the\s+/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(" ").filter(Boolean));
}

function trigrams(value: string): Set<string> {
  const padded = ` ${normalizeTitle(value).replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) n++;
  return n;
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  return (2 * intersectionSize(a, b)) / (a.size + b.size);
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  const shared = intersectionSize(a, b);
  return shared / (a.size + b.size - shared);
}

/** Handles the case where one title is a strict superset of the other. */
function containment<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  return intersectionSize(a, b) / Math.min(a.size, b.size);
}

export type Scored = { tokens: Set<string>; grams: Set<string> };

export function prepare(value: string): Scored {
  return { tokens: tokenSet(value), grams: trigrams(value) };
}

/**
 * Blended similarity. Trigrams carry the most weight because they survive word
 * reordering and partial translation differences; containment rescues the
 * "DCW title is a shorter paraphrase" case that pure Jaccard fails.
 */
export function similarity(a: Scored, b: Scored): number {
  return (
    0.5 * dice(a.grams, b.grams) +
    0.3 * containment(a.tokens, b.tokens) +
    0.2 * jaccard(a.tokens, b.tokens)
  );
}

/* ------------------------------------------------------------------ */
/* Candidate string generation                                         */
/* ------------------------------------------------------------------ */

/**
 * Surface forms worth trying verbatim against the API, in descending order of
 * likelihood. Verbatim attempts are cheap (batched) and skip fuzzy entirely.
 */
export function titleCandidates(input: DcwTitleInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed || trimmed.length < 3) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  push(input.knownDcwTitle);

  const bases = [input.title, ...(input.aliases ?? [])].filter(Boolean);
  for (const base of bases) {
    push(base);
    // Drop trailing "(Part 1)" / "Part 2" - DCW usually covers a multi-part
    // episode in ONE article, so both parts must collapse to the same target.
    push(base.replace(/\s*[\(\[]?\s*(?:part|pt)\.?\s*(?:\d+|[ivx]+)\s*[\)\]]?\s*$/i, ""));
    push(base.replace(/\s*\([^()]*\)\s*$/, ""));
    // "The " on/off - DCW is inconsistent about the leading article.
    if (/^the\s+/i.test(base)) push(base.replace(/^the\s+/i, ""));
    else push(`The ${base}`);
    // Colon and dash variants.
    push(base.replace(/\s*[-\u2013\u2014]\s*/g, ": "));
    push(base.replace(/\s*:\s*/g, " - "));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Category index                                                      */
/* ------------------------------------------------------------------ */

export type DcwIndex = {
  /** normalizeTitle(article) -> article */
  exact: Map<string, string>;
  entries: Array<{ title: string; scored: Scored }>;
};

const indexCache = new Map<string, Promise<DcwIndex>>();

async function buildCategoryIndex(category: string): Promise<DcwIndex> {
  const titles: string[] = [];
  let cont: string | undefined;

  do {
    const data = await dcwQuery<{
      query?: { categorymembers?: Array<{ title: string }> };
      continue?: { cmcontinue?: string };
    }>({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${category}`,
      cmnamespace: 0,
      cmlimit: 500,
      cmcontinue: cont,
    });

    for (const member of data.query?.categorymembers ?? []) titles.push(member.title);
    cont = data.continue?.cmcontinue;
  } while (cont);

  const exact = new Map<string, string>();
  for (const title of titles) {
    const key = normalizeTitle(title);
    // First writer wins: category order is alphabetical and stable, so repeated
    // runs pick the same article for a colliding key.
    if (key && !exact.has(key)) exact.set(key, title);
  }

  return {
    exact,
    entries: titles.map((title) => ({ title, scored: prepare(title) })),
  };
}

export function fetchDcwCategoryIndex(category: string): Promise<DcwIndex> {
  const cached = indexCache.get(category);
  if (cached) return cached;
  // Cache the PROMISE, not the result: concurrent callers must share one dump.
  const pending = buildCategoryIndex(category).catch((error) => {
    indexCache.delete(category);
    throw error;
  });
  indexCache.set(category, pending);
  return pending;
}

export function matchInIndex(
  index: DcwIndex,
  candidate: string,
): { title: string; score: number; via: "exact" | "fuzzy" } | null {
  const key = normalizeTitle(candidate);
  if (!key) return null;

  const exact = index.exact.get(key);
  if (exact) return { title: exact, score: 1, via: "exact" };

  const scored = prepare(candidate);
  let best: { title: string; score: number } | null = null;
  let runnerUp = 0;

  for (const entry of index.entries) {
    const score = similarity(scored, entry.scored);
    if (!best || score > best.score) {
      runnerUp = best ? best.score : runnerUp;
      best = { title: entry.title, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best || best.score < FUZZY_MIN) return null;
  // Ambiguous: two articles score nearly the same. Refuse rather than guess -
  // a wrong image is worse than a placeholder because it looks correct.
  if (best.score - runnerUp < FUZZY_MARGIN) return null;
  return { title: best.title, score: best.score, via: "fuzzy" };
}

/* ------------------------------------------------------------------ */
/* Episode-number index                                                */
/* ------------------------------------------------------------------ */

let numberIndexPromise: Promise<Map<number, string>> | null = null;

/**
 * Probe whether DCW has "Episode N" redirects. If it does, this is the whole
 * ballgame: one batched request per 50 episodes, zero fuzzy matching, exact
 * canonical titles. Returns an empty map when the redirects do not exist.
 */
async function buildNumberIndexFromRedirects(max: number): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  const all = Array.from({ length: max }, (_, i) => i + 1);

  for (const chunk of chunkArray(all, 50)) {
    let data: {
      query?: {
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<{ title: string; missing?: boolean }>;
      };
    };
    try {
      data = await dcwQuery({
        action: "query",
        titles: chunk.map((n) => `Episode ${n}`).join("|"),
        redirects: 1,
        format: "json",
      });
    } catch {
      continue;
    }

    for (const hop of data.query?.redirects ?? []) {
      const m = /^Episode\s+(\d+)$/i.exec(hop.from);
      if (m) found.set(Number(m[1]), hop.to);
    }
    // A non-redirect page literally titled "Episode 123" is also usable.
    for (const page of data.query?.pages ?? []) {
      if (page.missing) continue;
      const m = /^Episode\s+(\d+)$/i.exec(page.title);
      if (m && !found.has(Number(m[1]))) found.set(Number(m[1]), page.title);
    }

    // Bail out early if the first two batches yield nothing - the redirects
    // do not exist and there is no point issuing 20 more requests.
    if (!found.size && chunk[chunk.length - 1] >= 100) break;
  }

  return found;
}

/**
 * Fallback: parse an episode list article's wikitext for "number ... [[Article]]"
 * rows. Deliberately format-agnostic because DCW's table markup is not
 * guaranteed stable - probe 3 tells us which page titles actually exist.
 */
async function buildNumberIndexFromListPages(
  listPages: string[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();

  for (const page of listPages) {
    let wikitext = "";
    try {
      const data = await dcwQuery<{
        query?: {
          pages?: Array<{
            missing?: boolean;
            revisions?: Array<{ slots?: { main?: { content?: string } }; content?: string }>;
          }>;
        };
      }>({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        rvlimit: 1,
        redirects: 1,
        titles: page,
      });
      const rev = data.query?.pages?.[0]?.revisions?.[0];
      wikitext = rev?.slots?.main?.content ?? rev?.content ?? "";
    } catch {
      continue;
    }
    if (!wikitext) continue;

    // Split on table row separators as well as newlines so single-line rows work.
    for (const row of wikitext.split(/\n\|-|\n/)) {
      const numMatch = /(?:^|\|)\s*'*(\d{1,4})'*\s*(?:\||$)/.exec(row);
      if (!numMatch) continue;
      const linkMatch = /\[\[\s*(?!File:|Image:|Category:)([^\]|#]+?)\s*(?:\||\]\])/.exec(row);
      if (!linkMatch) continue;
      const n = Number(numMatch[1]);
      const target = linkMatch[1].trim();
      if (!n || !target) continue;
      if (!found.has(n)) found.set(n, target);
    }
  }

  return found;
}

export function fetchDcwEpisodeNumberIndex(
  options: { maxEpisode?: number; listPages?: string[] } = {},
): Promise<Map<number, string>> {
  if (numberIndexPromise) return numberIndexPromise;

  const { maxEpisode = 1200, listPages = [] } = options;

  numberIndexPromise = (async () => {
    const viaRedirects = await buildNumberIndexFromRedirects(maxEpisode);
    if (viaRedirects.size > maxEpisode * 0.5) return viaRedirects;

    const viaList = await buildNumberIndexFromListPages(listPages);
    for (const [n, title] of viaList) if (!viaRedirects.has(n)) viaRedirects.set(n, title);
    return viaRedirects;
  })().catch((error) => {
    numberIndexPromise = null;
    throw error;
  });

  return numberIndexPromise;
}

/* ------------------------------------------------------------------ */
/* Existence verification                                              */
/* ------------------------------------------------------------------ */

/**
 * Batched existence check. Returns requested-title -> canonical title for pages
 * that exist, following normalisation and redirects. THIS is the step the old
 * code was missing: without it a bogus title silently becomes a placeholder.
 */
export async function verifyTitles(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(titles.filter(Boolean))];

  for (const chunk of chunkArray(unique, 50)) {
    let data: {
      query?: {
        normalized?: Array<{ from: string; to: string }>;
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<{ title: string; missing?: boolean; ns?: number }>;
      };
    };
    try {
      data = await dcwQuery({
        action: "query",
        titles: chunk.join("|"),
        redirects: 1,
        format: "json",
      });
    } catch {
      continue;
    }

    // Walk normalisation + redirect hops back to the title we asked for.
    const originOf = new Map<string, string>(chunk.map((t) => [t, t]));
    for (const hop of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) {
      originOf.set(hop.to, originOf.get(hop.from) ?? hop.from);
    }

    for (const page of data.query?.pages ?? []) {
      if (page.missing) continue;
      if (page.ns !== undefined && page.ns !== 0) continue;
      const origin = originOf.get(page.title);
      if (origin) out.set(origin, page.title);
      out.set(page.title, page.title);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Search fallback                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tries several candidate query strings and scores every hit. Unlike the old
 * searchDcwTitle it NEVER returns an unscored top hit - below SEARCH_MIN we
 * return null so the caller can fall back to a placeholder instead of showing
 * a confidently wrong episode.
 */
export async function searchDcwTitle(
  candidates: string[],
  index?: DcwIndex,
): Promise<{ title: string; score: number } | null> {
  let best: { title: string; score: number } | null = null;

  for (const candidate of candidates.slice(0, 3)) {
    let hits: Array<{ title: string }> = [];
    try {
      const data = await dcwQuery<{ query?: { search?: Array<{ title: string }> } }>({
        action: "query",
        list: "search",
        srsearch: candidate,
        srnamespace: 0,
        srlimit: 8,
        srinfo: "",
        srprop: "",
      });
      hits = data.query?.search ?? [];
    } catch {
      continue;
    }
    if (!hits.length) continue;

    const scored = prepare(candidate);
    for (const hit of hits) {
      let score = similarity(scored, prepare(hit.title));
      // Prefer hits that are in the right category index when we have one.
      if (index && index.exact.has(normalizeTitle(hit.title))) score += 0.08;
      if (!best || score > best.score) best = { title: hit.title, score };
    }

    if (best && best.score >= 0.75) break; // good enough, stop spending requests
  }

  return best && best.score >= SEARCH_MIN ? best : null;
}

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/**
 * Batch resolver. Use this from the backfill route/script and from sync.
 * Cost for ~1000 episodes: ~24 number-index requests (once, cached) +
 * ~20 verification batches + at most 1-3 search requests per unresolved entry.
 */
export async function resolveDcwTitles(
  items: DcwTitleInput[],
  options: {
    useNumberIndex?: boolean;
    useSearchFallback?: boolean;
    maxEpisode?: number;
    listPages?: string[];
  } = {},
): Promise<DcwTitleMatch[]> {
  const {
    useNumberIndex = true,
    useSearchFallback = true,
    maxEpisode = 1200,
    listPages = [],
  } = options;

  if (!items.length) return [];

  const results = new Map<string, DcwTitleMatch>(
    items.map((item) => [
      item.id,
      { id: item.id, title: null, score: 0, via: "none", persist: false },
    ]),
  );

  /* --- Stage 0: trust already-stored titles. ------------------------ */
  const pending: DcwTitleInput[] = [];
  for (const item of items) {
    if (item.knownDcwTitle) {
      results.set(item.id, {
        id: item.id,
        title: item.knownDcwTitle,
        score: 1,
        via: "known",
        persist: false,
      });
    } else {
      pending.push(item);
    }
  }

  /* --- Stage 1: episode number. ------------------------------------ */
  if (useNumberIndex && pending.some((i) => typeof i.episodeNumber === "number")) {
    let numbers = new Map<number, string>();
    try {
      numbers = await fetchDcwEpisodeNumberIndex({ maxEpisode, listPages });
    } catch {
      // Fall through to title matching.
    }
    if (numbers.size) {
      for (const item of pending) {
        if (results.get(item.id)!.title) continue;
        const n = item.episodeNumber;
        if (typeof n !== "number") continue;
        const hit = numbers.get(n);
        if (!hit) continue;
        results.set(item.id, {
          id: item.id,
          title: hit,
          score: 1,
          via: "number",
          persist: true,
        });
      }
    }
  }

  /* --- Stage 2/3: category index, exact then fuzzy. ---------------- */
  const indexes = new Map<string, DcwIndex>();
  const stillPending = pending.filter((i) => !results.get(i.id)!.title);
  for (const type of new Set(stillPending.map((i) => i.contentType ?? "episode"))) {
    const category = DCW_CATEGORY_BY_TYPE[type] ?? DCW_CATEGORY_BY_TYPE.episode;
    try {
      indexes.set(type, await fetchDcwCategoryIndex(category));
    } catch {
      // No index for this type; search fallback still applies.
    }
  }

  for (const item of stillPending) {
    const index = indexes.get(item.contentType ?? "episode");
    if (!index) continue;
    for (const candidate of titleCandidates(item)) {
      const hit = matchInIndex(index, candidate);
      if (!hit) continue;
      results.set(item.id, {
        id: item.id,
        title: hit.title,
        score: hit.score,
        via: hit.via,
        persist: true,
      });
      break;
    }
  }

  /* --- Stage 3.5: verify everything we have not proven exists. ------ */
  const unverified = [...results.values()].filter(
    (r) => r.title && (r.via === "known" || r.via === "number"),
  );
  if (unverified.length) {
    const verified = await verifyTitles(unverified.map((r) => r.title!));
    for (const result of unverified) {
      const canonical = verified.get(result.title!);
      if (canonical) {
        // Persist when the canonical form differs from what we had stored.
        if (canonical !== result.title) result.persist = true;
        result.title = canonical;
      } else {
        results.set(result.id, {
          id: result.id,
          title: null,
          score: 0,
          via: "none",
          persist: false,
        });
      }
    }
  }

  /* --- Stage 4: search fallback, one entry at a time. -------------- */
  if (useSearchFallback) {
    for (const item of items) {
      const current = results.get(item.id)!;
      if (current.title) continue;
      const index = indexes.get(item.contentType ?? "episode");
      const hit = await searchDcwTitle(titleCandidates(item), index);
      if (!hit) continue;
      const verified = await verifyTitles([hit.title]);
      const canonical = verified.get(hit.title);
      if (!canonical) continue;
      results.set(item.id, {
        id: item.id,
        title: canonical,
        score: hit.score,
        via: "search",
        persist: hit.score >= 0.65, // only cache confident search hits
      });
    }
  }

  return items.map((item) => results.get(item.id)!);
}

/** Convenience single-entry wrapper for the details API route. */
export async function resolveDcwTitle(
  input: Omit<DcwTitleInput, "id"> & { id?: string },
): Promise<DcwTitleMatch> {
  const [match] = await resolveDcwTitles([{ ...input, id: input.id ?? "one" }]);
  return match;
}
