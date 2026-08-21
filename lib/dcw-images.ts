// lib/dcw-images.ts
// Resolves DCPH content entries -> Detective Conan World article -> image URL.

import { chunkArray, dcwQuery } from "./dcw";

export type DcwImage = {
  url: string;
  width?: number;
  height?: number;
  /** Resolved DCW article title, stored for idempotent re-runs. */
  page: string;
};

export type DcwResolvable = {
  /** Your content_entries.id */
  id: string;
  /** Primary title from Jikan/Kitsu. */
  title: string;
  /** Extra candidates: japanese title, romaji, previously stored dcw_title. */
  aliases?: string[];
  /** Used to pick which DCW category index to fuzzy-match against. */
  contentType?: string;
};

/**
 * VERIFY these against `action=query&list=allcategories` before trusting them.
 */
export const DCW_CATEGORY_BY_TYPE: Record<string, string> = {
  episode: "Episodes",
  movie: "Movies",
  ova: "OVAs",
  special: "TV Specials",
  manga: "Manga Volumes",
};

const BAD_FILE_PATTERN =
  /(logo|icon|nav|stub|ambox|disambig|spoiler|placeholder|wiki|button|flag|star|edit|seal|banner)/i;
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp)$/i;

/* ------------------------------------------------------------------ */
/* Normalisation + fuzzy matching                                      */
/* ------------------------------------------------------------------ */

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(part|pt)\.?\s*\d+\b/g, " ")
    .replace(/\b(the|a|an|of|and|case|episode|ep)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/* ------------------------------------------------------------------ */
/* Category index (one dump, reused for every entry)                   */
/* ------------------------------------------------------------------ */

export type DcwIndex = {
  exact: Map<string, string>;
  entries: Array<{ title: string; tokens: Set<string> }>;
};

const indexCache = new Map<string, DcwIndex>();

export async function fetchDcwCategoryIndex(category: string): Promise<DcwIndex> {
  const cached = indexCache.get(category);
  if (cached) return cached;

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

  const index: DcwIndex = {
    exact: new Map(titles.map((title) => [normalizeTitle(title), title])),
    entries: titles.map((title) => ({ title, tokens: tokens(title) })),
  };

  indexCache.set(category, index);
  return index;
}

export function matchInIndex(index: DcwIndex, candidate: string, threshold = 0.6): string | null {
  const normalized = normalizeTitle(candidate);
  const exact = index.exact.get(normalized);
  if (exact) return exact;

  const candidateTokens = tokens(candidate);
  let best: { title: string; score: number } | null = null;

  for (const entry of index.entries) {
    const score = jaccard(candidateTokens, entry.tokens);
    if (!best || score > best.score) best = { title: entry.title, score };
  }

  return best && best.score >= threshold ? best.title : null;
}

/* ------------------------------------------------------------------ */
/* Title resolution fallback: full-text search                         */
/* ------------------------------------------------------------------ */

export async function searchDcwTitle(query: string): Promise<string | null> {
  const data = await dcwQuery<{ query?: { search?: Array<{ title: string }> } }>({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: 0,
    srlimit: 5,
    srinfo: "",
    srprop: "",
  });

  const hits = data.query?.search ?? [];
  if (!hits.length) return null;

  const queryTokens = tokens(query);
  let best: { title: string; score: number } | null = null;

  for (const hit of hits) {
    const score = jaccard(queryTokens, tokens(hit.title));
    if (!best || score > best.score) best = { title: hit.title, score };
  }

  // Search is already relevance-ranked; accept a looser threshold than the index.
  return best && best.score >= 0.4 ? best.title : hits[0].title;
}

/* ------------------------------------------------------------------ */
/* Image extraction — fast path                                        */
/* ------------------------------------------------------------------ */

/**
 * Batched prop=pageimages. Up to 50 titles per request.
 * pilimit MUST be set: it defaults to 1, which would return one image per batch.
 * pilicense=any is required — episode screenshots are non-free.
 */
export async function fetchPageImages(
  titles: string[],
  thumbSize = 600,
): Promise<Map<string, DcwImage>> {
  const out = new Map<string, DcwImage>();
  const unique = [...new Set(titles.filter(Boolean))];

  for (const chunk of chunkArray(unique, 50)) {
    let data: {
      query?: {
        normalized?: Array<{ from: string; to: string }>;
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<{
          title: string;
          missing?: boolean;
          thumbnail?: { source: string; width?: number; height?: number };
          original?: { source: string; width?: number; height?: number };
        }>;
      };
    };

    try {
      data = await dcwQuery({
        action: "query",
        prop: "pageimages",
        piprop: "thumbnail|original|name",
        pithumbsize: thumbSize,
        pilicense: "any",
        pilimit: chunk.length,
        redirects: 1,
        titles: chunk.join("|"),
      });
    } catch {
      continue; // caller falls back per-title
    }

    const query = data.query;
    if (!query) continue;

    // Map the final (normalised/redirected) title back to what we asked for.
    const originOf = new Map<string, string>(chunk.map((t) => [t, t]));
    for (const hop of [...(query.normalized ?? []), ...(query.redirects ?? [])]) {
      originOf.set(hop.to, originOf.get(hop.from) ?? hop.from);
    }

    for (const page of query.pages ?? []) {
      if (page.missing) continue;
      const picked = page.thumbnail ?? page.original;
      if (!picked?.source) continue;

      out.set(originOf.get(page.title) ?? page.title, {
        url: picked.source,
        width: picked.width,
        height: picked.height,
        page: page.title,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Image extraction — fallback (no PageImages / no lead image)          */
/* ------------------------------------------------------------------ */

export async function fetchFileFallback(
  title: string,
  thumbSize = 600,
): Promise<DcwImage | null> {
  try {
    const listing = await dcwQuery<{
      query?: { pages?: Array<{ images?: Array<{ title: string }> }> };
    }>({
      action: "query",
      prop: "images",
      imlimit: 30,
      redirects: 1,
      titles: title,
    });

    const files = (listing.query?.pages?.[0]?.images ?? [])
      .map((image) => image.title)
      .filter((name) => IMAGE_EXT_PATTERN.test(name) && !BAD_FILE_PATTERN.test(name))
      .slice(0, 5);

    if (!files.length) return null;

    const info = await dcwQuery<{
      query?: {
        pages?: Array<{
          title: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            width?: number;
            height?: number;
            thumbwidth?: number;
            thumbheight?: number;
          }>;
        }>;
      };
    }>({
      action: "query",
      prop: "imageinfo",
      iiprop: "url|size",
      iiurlwidth: thumbSize,
      redirects: 1,
      titles: files.join("|"),
    });

    const best = (info.query?.pages ?? [])
      .map((page) => page.imageinfo?.[0])
      .filter((i): i is NonNullable<typeof i> => Boolean(i?.url || i?.thumburl))
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

    if (!best) return null;

    return {
      url: best.thumburl ?? best.url!,
      width: best.thumbwidth ?? best.width,
      height: best.thumbheight ?? best.height,
      page: title,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export type DcwResolution = {
  id: string;
  dcwTitle: string | null;
  image: DcwImage | null;
};

/**
 * Resolve a batch of entries. Cost model for ~1000 episodes:
 *   1 category dump (~2 requests) + ~20 pageimages batches + 1-2 requests per miss.
 */
export async function resolveDcwImagesBatch(
  items: DcwResolvable[],
  options: { thumbSize?: number; useSearchFallback?: boolean } = {},
): Promise<DcwResolution[]> {
  const { thumbSize = 600, useSearchFallback = true } = options;
  if (!items.length) return [];

  // 1. Build one index per content type present in the batch.
  const indexes = new Map<string, DcwIndex>();
  for (const type of new Set(items.map((i) => i.contentType ?? "episode"))) {
    const category = DCW_CATEGORY_BY_TYPE[type] ?? DCW_CATEGORY_BY_TYPE.episode;
    try {
      indexes.set(type, await fetchDcwCategoryIndex(category));
    } catch {
      // Index unavailable -> rely on direct titles + search.
    }
  }

  // 2. Pick a candidate article title per entry.
  const resolutions: DcwResolution[] = [];
  const needsSearch: DcwResolution[] = [];

  for (const item of items) {
    const index = indexes.get(item.contentType ?? "episode");
    const candidates = [...(item.aliases ?? []), item.title].filter(Boolean);

    let matched: string | null = null;
    if (index) {
      for (const candidate of candidates) {
        matched = matchInIndex(index, candidate);
        if (matched) break;
      }
    }

    const resolution: DcwResolution = { id: item.id, dcwTitle: matched ?? item.title, image: null };
    resolutions.push(resolution);
    if (!matched) needsSearch.push(resolution);
  }

  // 3. Fast path: batched pageimages on whatever titles we have.
  const firstPass = await fetchPageImages(
    resolutions.map((r) => r.dcwTitle!).filter(Boolean),
    thumbSize,
  );
  for (const resolution of resolutions) {
    const hit = resolution.dcwTitle ? firstPass.get(resolution.dcwTitle) : undefined;
    if (hit) {
      resolution.image = hit;
      resolution.dcwTitle = hit.page;
    }
  }

  // 4. Search fallback for entries whose title never matched anything.
  if (useSearchFallback) {
    for (const resolution of needsSearch) {
      if (resolution.image) continue;
      const item = items.find((i) => i.id === resolution.id)!;
      const found = await searchDcwTitle(item.title);
      if (!found) continue;
      resolution.dcwTitle = found;
      const viaPageImages = await fetchPageImages([found], thumbSize);
      resolution.image = viaPageImages.get(found) ?? null;
    }
  }

  // 5. Last resort: scrape the article's file list.
  for (const resolution of resolutions) {
    if (resolution.image || !resolution.dcwTitle) continue;
    resolution.image = await fetchFileFallback(resolution.dcwTitle, thumbSize);
  }

  return resolutions;
}

/** Final fallback chain: DCW -> upstream (Jikan/Kitsu) -> local placeholder. */
export function pickImageUrl(
  dcw: string | null | undefined,
  upstream: string | null | undefined,
): { url: string; source: "dcw" | "upstream" | "placeholder" } {
  if (dcw) return { url: dcw, source: "dcw" };
  if (upstream) return { url: upstream, source: "upstream" };
  return { url: "/placeholder-episode.svg", source: "placeholder" };
}
