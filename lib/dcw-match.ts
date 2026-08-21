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
 */
export async function searchDcwBestTitle(
  get: DcwGetter,
  query: string,
  options: { limit?: number; threshold?: number } = {},
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
  return hits[0];
}

/** content_entries.type -> DCW category holding that content's pages. */
export function dcwCategoryForType(type?: string | null): string {
  switch ((type ?? "").toLowerCase().trim()) {
    case "movie":
    case "movies":
      return "Movies";
    case "ova":
    case "ovas":
      return "OVAs";
    case "special":
    case "specials":
    case "tv special":
    case "tv_special":
      return "TV Specials";
    default:
      return "Episodes";
  }
}
