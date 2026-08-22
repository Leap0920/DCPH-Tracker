/**
 * Shared fuzzy-matching helpers for Detective Conan World lookups.
 *
 * Mirrors the proven approach in lib/dcw-images.ts (category index + Jaccard),
 * but takes the API getter as a parameter so this module has no dependency on
 * any particular DCW client. Never throws: every failure degrades to null / an
 * empty index.
 */

export type DcwGetter = (params: Record<string, string>) => Promise<unknown>;

export type DcwCategoryIndex = {
  /** normalized title -> canonical wiki title */
  exact: Map<string, string>;
  entries: { title: string; tokens: Set<string> }[];
};

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "case", "episode", "ep"]);

const INDEX_TTL_MS = 6 * 60 * 60 * 1000; // canonical title lists change slowly
const INDEX_FAILURE_COOLDOWN_MS = 60 * 1000;
const MAX_CATEGORY_PAGES = 8; // 8 * 500 = 4000 members, hard cost ceiling

const indexCache = new Map<string, { at: number; value: DcwCategoryIndex }>();
const indexFailedAt = new Map<string, number>();

const EMPTY_INDEX: DcwCategoryIndex = { exact: new Map(), entries: [] };

/** Titles that are never the episode/movie content page we want. */
const JUNK_TITLE_PATTERNS: RegExp[] = [
  /\//, // subpages: "Foo/Gallery", "Foo/Transcript"
  /\bgallery\b/i,
  /\btranscript\b/i,
  /\bdisambiguation\b/i,
  /^list of\b/i,
  /^category:/i,
  /^file:/i,
  /^template:/i,
  /^user:/i,
  /^talk:/i,
  /\bvolume\s*\d+/i,
  /\bchapter\s*\d+/i,
  /\bsoundtrack\b/i,
  /\bopening\b/i,
  /\bending\b/i,
];

export function isJunkDcwTitle(title: string): boolean {
  if (!title || title.trim().length < 2) return true;
  return JUNK_TITLE_PATTERNS.some((re) => re.test(title));
}

export function normalizeMatchTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:part|pt)\.?\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(" ")
    .trim();
}

export function matchTokens(value: string): Set<string> {
  const normalized = normalizeMatchTitle(value);
  return new Set(normalized ? normalized.split(" ") : []);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

type CategoryMembersResponse = {
  query?: { categorymembers?: { title?: string; ns?: number }[] };
  continue?: { cmcontinue?: string };
};

/**
 * Dump a category's namespace-0 members into an exact map + token entries.
 * Cached per-process for 6h; a failed fetch is retried after 60s.
 */
export async function fetchDcwCategoryIndex(
  get: DcwGetter,
  category: string,
): Promise<DcwCategoryIndex> {
  const key = category.toLowerCase();
  const now = Date.now();

  const cached = indexCache.get(key);
  if (cached && now - cached.at < INDEX_TTL_MS) return cached.value;

  const failedAt = indexFailedAt.get(key);
  if (failedAt && now - failedAt < INDEX_FAILURE_COOLDOWN_MS) return EMPTY_INDEX;

  const exact = new Map<string, string>();
  const entries: { title: string; tokens: Set<string> }[] = [];

  try {
    let cmcontinue: string | undefined;
    for (let page = 0; page < MAX_CATEGORY_PAGES; page += 1) {
      const params: Record<string, string> = {
        action: "query",
        list: "categorymembers",
        cmtitle: category.startsWith("Category:") ? category : `Category:${category}`,
        cmnamespace: "0",
        cmlimit: "500",
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;

      const data = (await get(params)) as CategoryMembersResponse | null | undefined;
      const members = data?.query?.categorymembers ?? [];
      for (const member of members) {
        const title = typeof member?.title === "string" ? member.title.trim() : "";
        if (!title || isJunkDcwTitle(title)) continue;
        const normalized = normalizeMatchTitle(title);
        if (!normalized) continue;
        if (!exact.has(normalized)) exact.set(normalized, title);
        entries.push({ title, tokens: matchTokens(title) });
      }

      cmcontinue = data?.continue?.cmcontinue;
      if (!cmcontinue) break;
    }
  } catch {
    // never throw
  }

  if (entries.length === 0) {
    indexFailedAt.set(key, now);
    return EMPTY_INDEX;
  }

  const value: DcwCategoryIndex = { exact, entries };
  indexCache.set(key, { at: now, value });
  indexFailedAt.delete(key);
  return value;
}

/**
 * Merge several category indexes into one. Each category keeps its own cache
 * entry, so a single empty/failed category cannot poison the others (the
 * magic_kaito case: two categories, either one may be renamed or emptied).
 * Exact-map precedence follows the given category order (first wins).
 */
export async function fetchDcwCategoryIndexes(
  get: DcwGetter,
  categories: string[],
): Promise<DcwCategoryIndex> {
  const list = (categories ?? []).filter(
    (category) => typeof category === "string" && category.trim().length > 0,
  );
  if (list.length === 0) return EMPTY_INDEX;
  if (list.length === 1) return fetchDcwCategoryIndex(get, list[0] as string);

  let indexes: DcwCategoryIndex[] = [];
  try {
    indexes = await Promise.all(list.map((category) => fetchDcwCategoryIndex(get, category)));
  } catch {
    return EMPTY_INDEX;
  }

  const exact = new Map<string, string>();
  const entries: { title: string; tokens: Set<string> }[] = [];
  for (const index of indexes) {
    for (const [key, title] of index.exact) if (!exact.has(key)) exact.set(key, title);
    for (const entry of index.entries) entries.push(entry);
  }

  return entries.length > 0 ? { exact, entries } : EMPTY_INDEX;
}

/** Exact normalized hit, else the best Jaccard match at or above threshold. */
export function matchInIndex(
  index: DcwCategoryIndex,
  candidate: string,
  threshold = 0.6,
): string | null {
  const normalized = normalizeMatchTitle(candidate);
  if (!normalized) return null;

  const direct = index.exact.get(normalized);
  if (direct) return direct;

  const candidateTokens = matchTokens(candidate);
  if (candidateTokens.size === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const entry of index.entries) {
    const score = jaccard(candidateTokens, entry.tokens);
    if (score > bestScore) {
      bestScore = score;
      best = entry.title;
    }
  }
  return bestScore >= threshold ? best : null;
}

type SearchResponseShape = {
  query?: { search?: { title?: string }[] };
};

/**
 * Search DCW and pick the best of the top 5 by Jaccard instead of blindly
 * taking hit[0]. Junk pages (galleries, subpages, lists) are discarded first.
 *
 * `allowFirstHitFallback` defaults to true, so existing callers keep their
 * exact previous behavior. Callers resolving numbered spin-off content pass
 * false: for those rows hit[0] is reliably the wrong page (overview/index
 * pages, or a neighbouring entry) and a wrong page is worse than no page.
 */
export async function searchDcwBestTitle(
  get: DcwGetter,
  query: string,
  options: { limit?: number; threshold?: number; allowFirstHitFallback?: boolean } = {},
): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const limit = options.limit ?? 5;
  const threshold = options.threshold ?? 0.4;

  let hits: string[] = [];
  try {
    const data = (await get({
      action: "query",
      list: "search",
      srsearch: trimmed,
      srnamespace: "0",
      srlimit: String(limit),
    })) as SearchResponseShape | null | undefined;

    hits = (data?.query?.search ?? [])
      .map((hit) => (typeof hit?.title === "string" ? hit.title.trim() : ""))
      .filter((title) => title.length > 0 && !isJunkDcwTitle(title));
  } catch {
    return null;
  }

  if (hits.length === 0) return null;

  const queryTokens = matchTokens(trimmed);
  let best: string | null = null;
  let bestScore = 0;
  for (const title of hits) {
    const score = jaccard(queryTokens, matchTokens(title));
    if (score > bestScore) {
      bestScore = score;
      best = title;
    }
  }

  if (best && bestScore >= threshold) return best;
  return options.allowFirstHitFallback === false ? null : (hits[0] ?? null);
}

/** Canonical internal content-type key, tolerant of the DB's spelling variants. */
export function normalizeContentType(type?: string | null): string {
  const value = (type ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  switch (value) {
    case "episode":
    case "episodes":
    case "tv":
    case "tv_episode":
    case "tv_episodes":
      return "episode";
    case "movie":
    case "movies":
      return "movie";
    case "ova":
    case "ovas":
      return "ova";
    case "special":
    case "specials":
    case "tv_special":
    case "tv_specials":
      return "special";
    case "live_action":
    case "liveaction":
    case "drama":
      return "live_action";
    case "magic_kaito":
    case "magickaito":
    case "magic_kaito_1412":
      return "magic_kaito";
    case "hanzawa":
    case "culprit_hanzawa":
    case "the_culprit_hanzawa":
      return "hanzawa";
    case "zero_tea_time":
    case "zeros_tea_time":
    case "zero's_tea_time":
    case "zero_no_tiitaimu":
      return "zero_tea_time";
    default:
      return value;
  }
}

/**
 * content_entries.type -> ordered DCW categories holding that content's pages.
 *
 * Verified against the live wiki: Category:TV_Specials, Category:Hanzawa and
 * Category:Live_Action do not exist; the real homes are Specials,
 * "The Culprit Hanzawa Episodes" and "Drama Episodes". Magic Kaito content is
 * split across the 1412 series and the older TV specials.
 */
export function dcwCategoriesForType(type?: string | null): string[] {
  switch (normalizeContentType(type)) {
    case "movie":
      return ["Movies"];
    case "ova":
      return ["OVAs"];
    case "special":
      return ["Specials"];
    case "live_action":
      return ["Drama Episodes"];
    case "magic_kaito":
      return ["Magic Kaito 1412 Episodes", "Magic Kaito TV Specials"];
    case "hanzawa":
      return ["The Culprit Hanzawa Episodes"];
    case "zero_tea_time":
      return ["Zero's Tea Time Episodes"];
    default:
      return ["Episodes"];
  }
}

/**
 * @deprecated Prefer dcwCategoriesForType. Kept so existing callers keep
 * compiling and behaving; returns the primary category only.
 */
export function dcwCategoryForType(type?: string | null): string {
  return dcwCategoriesForType(type)[0] as string;
}

/* ------------------------------------------------------------------ *
 * Numbered overview tables: deterministic number -> canonical page.
 *
 * DCW names spin-off content pages by their real title ("The Time-Bombed
 * Skyscraper"), never by number, and CirrusSearch returns zero hits for
 * "Detective Conan Movie 01: ..." style queries. The only reliable number ->
 * page mapping lives in the numbered overview tables, so we parse them.
 * ------------------------------------------------------------------ */

type OverviewSource = { page: string; template: string };

const OVERVIEW_BY_TYPE: Record<string, OverviewSource> = {
  movie: { page: "Regular movies", template: "MovieItem" },
  special: { page: "TV Special", template: "SpecialItem" },
  ova: { page: "OVAs", template: "OVAItem" },
  hanzawa: { page: "The Culprit Hanzawa Season 1", template: "HanzawaSeasonItem" },
  zero_tea_time: { page: "Zero's Tea Time Season 1", template: "ZTTSeasonItem" },
};

/**
 * Overview / franchise index pages. These are never the specific content page
 * for a numbered entry, and search likes to return them as hit[0]. Kept out of
 * isJunkDcwTitle on purpose: other callers (images, franchise lookups) may
 * legitimately want them.
 */
const OVERVIEW_DENY = new Set(
  [
    "Regular movies",
    "Movies",
    "TV Special",
    "TV Specials",
    "Specials",
    "OVAs",
    "OVA",
    "Magic File",
    "Secret File",
    "Magic Kaito",
    "Magic Kaito 1412",
    "The Culprit Hanzawa",
    "The Culprit Hanzawa Season 1",
    "Zero's Tea Time",
    "Zero\u2019s Tea Time",
    "Zero's Tea Time Season 1",
    "Zero\u2019s Tea Time Season 1",
    "Drama",
    "Live action",
  ].map((title) => title.toLowerCase()),
);

export function isDcwOverviewTitle(title: string): boolean {
  if (!title) return false;
  return OVERVIEW_DENY.has(title.replace(/_/g, " ").trim().toLowerCase());
}

/** Chars scanned per row when the next row start is far away (long summaries). */
const OVERVIEW_ROW_WINDOW = 4000;

function overviewFieldNumber(field: string): number | null {
  const cleaned = field.replace(/'+/g, "").replace(/\[\[|\]\]/g, "").trim();
  const match = /^(?:[A-Za-z _-]{0,14}=\s*)?0*(\d{1,4})$/.exec(cleaned);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] as string, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extract `N -> [[link]]` pairs from a numbered overview template.
 *
 * Rows look like `{{MovieItem|1|''[[The Time-Bombed Skyscraper]]''|date...}}`
 * or `{{HanzawaSeasonItem|5|5|[[Along Came A Culprit]]|...|summary=...}}`.
 * Nested templates and links inside `summary=` are tolerated by scanning a
 * bounded window from each row start instead of balancing braces, and only the
 * numeric fields ahead of the first wiki link are considered.
 */
export function parseNumberedOverview(
  wikitext: string,
  template: string,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!wikitext || !template) return out;

  try {
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rowStart = new RegExp(`\\{\\{\\s*${escaped}\\s*\\|`, "gi");

    const starts: number[] = [];
    let match: RegExpExecArray | null = rowStart.exec(wikitext);
    while (match !== null) {
      starts.push(match.index + match[0].length);
      match = rowStart.exec(wikitext);
    }

    for (let i = 0; i < starts.length; i += 1) {
      const from = starts[i] as number;
      const nextStart = i + 1 < starts.length ? (starts[i + 1] as number) : wikitext.length;
      const hardEnd = Math.min(wikitext.length, nextStart, from + OVERVIEW_ROW_WINDOW);
      const row = wikitext.slice(from, hardEnd);

      const linkMatch = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(row);
      if (!linkMatch) continue;

      // Only ''italic''/'''bold''' padding around the link target is stripped
      // (runs of 2+ apostrophes at the edges). Single apostrophes and double
      // quotes are real title characters: "The Part-Time Workers' Requiem",
      // 'Next Conan's Hint "Hairball"'.
      const title = (linkMatch[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^'{2,5}/, "")
        .replace(/'{2,5}$/, "")
        .trim();
      if (!title || isJunkDcwTitle(title)) continue;

      const head = row.slice(0, linkMatch.index);
      const numbers: number[] = [];
      for (const field of head.split("|").slice(0, 4)) {
        const value = overviewFieldNumber(field);
        if (value !== null) numbers.push(value);
        if (numbers.length >= 2) break;
      }

      for (const n of numbers) {
        if (!out.has(n)) out.set(n, title);
      }
    }
  } catch {
    // never throw
  }

  return out;
}

type ParseWikitextShape = {
  parse?: { wikitext?: string | { "*"?: string } };
};

const overviewCache = new Map<string, { at: number; value: Map<number, string> }>();
const overviewFailedAt = new Map<string, number>();
const OVERVIEW_TTL_MS = 12 * 60 * 60 * 1000; // overview tables are near-static

/**
 * Resolve the canonical DCW page for item `n` of a numbered content type.
 * Returns null for unmapped types, out-of-range numbers, and every failure.
 */
export async function resolveNumberedOverviewTitle(
  get: DcwGetter,
  type: string | null | undefined,
  n: number,
): Promise<string | null> {
  if (!Number.isFinite(n) || n <= 0) return null;

  const source = OVERVIEW_BY_TYPE[normalizeContentType(type)];
  if (!source) return null;

  const key = source.page.toLowerCase();
  const now = Date.now();

  const cached = overviewCache.get(key);
  if (cached && now - cached.at < OVERVIEW_TTL_MS) return cached.value.get(n) ?? null;

  const failedAt = overviewFailedAt.get(key);
  if (failedAt && now - failedAt < INDEX_FAILURE_COOLDOWN_MS) return null;

  let map = new Map<number, string>();
  try {
    const data = (await get({
      action: "parse",
      page: source.page,
      prop: "wikitext",
      redirects: "1",
    })) as ParseWikitextShape | null | undefined;

    const raw = data?.parse?.wikitext;
    const wikitext = typeof raw === "string" ? raw : (raw?.["*"] ?? "");
    map = parseNumberedOverview(wikitext, source.template);
  } catch {
    // never throw
  }

  if (map.size === 0) {
    overviewFailedAt.set(key, now);
    return null;
  }

  overviewCache.set(key, { at: now, value: map });
  overviewFailedAt.delete(key);
  return map.get(n) ?? null;
}
