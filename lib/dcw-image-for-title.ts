// lib/dcw-image-for-title.ts
// Resolve a representative image for an ALREADY-CANONICAL DCW page title.
// Complements lib/dcw-images.ts (which does its own fuzzy title matching) by
// skipping matching entirely: the caller has already resolved the page title
// (e.g. via getDcwEpisodeDetails), so we only need pageimages / prop=images.

// NOTE: keep this in sync with the API base used by lib/dcw-episode.ts.
const DCW_API = "https://www.detectiveconanworld.com/wiki/api.php";
const USER_AGENT = "DCPH-Tracker/1.0 (image backfill)";

const REQUEST_INTERVAL_MS = 250;
const CACHE_TTL_MS = 30 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

export type DcwTitleImage = {
  url: string;
  width?: number;
  height?: number;
  page: string;
};

const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp)$/i;

const BAD_FILE_PATTERN = new RegExp(
  [
    "logo",
    "icon",
    "button",
    "spoiler",
    "placeholder",
    "banner",
    "stub",
    "under[_ ]?construction",
    "ambox",
    "disambig",
    "magnify",
    "crystal",
    "emoticon",
    "smiley",
    "wiki\\.png",
    "favicon",
    "nuvola",
    "^flag",
    "^arrow",
    "^bullet",
    "^star",
    "^check",
    "^cross",
    "^question",
    "^edit",
  ].join("|"),
  "i",
);

// ---------------------------------------------------------------- throttle ---

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = REQUEST_INTERVAL_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastAt = Date.now();
    }
  });
  chain = run.catch(() => undefined);
  return run as Promise<T>;
}

async function dcwGet<T>(params: Record<string, string>): Promise<T | null> {
  const url = new URL(DCW_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return throttle(async () => {
    try {
      const response = await fetch(url.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        next: { revalidate: 60 * 60 * 24 * 7 },
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  });
}

// ------------------------------------------------------------------- cache ---

type CacheEntry = { value: DcwTitleImage | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(title: string, thumbSize: number) {
  return `${thumbSize}::${title.trim().toLowerCase()}`;
}

// ------------------------------------------------------------------ shapes ---

type PageImagesResponse = {
  query?: {
    pages?: Array<{
      title?: string;
      missing?: boolean;
      thumbnail?: { source?: string; width?: number; height?: number };
      original?: { source?: string; width?: number; height?: number };
    }>;
  };
};

type ImagesListResponse = {
  query?: {
    pages?: Array<{
      title?: string;
      missing?: boolean;
      images?: Array<{ title?: string }>;
    }>;
  };
};

type ImageInfoResponse = {
  query?: {
    pages?: Array<{
      title?: string;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        thumbwidth?: number;
        thumbheight?: number;
        width?: number;
        height?: number;
        mime?: string;
      }>;
    }>;
  };
};

// ------------------------------------------------------------------- steps ---

async function viaPageImages(
  title: string,
  thumbSize: number,
): Promise<DcwTitleImage | null> {
  const data = await dcwGet<PageImagesResponse>({
    action: "query",
    prop: "pageimages",
    piprop: "thumbnail|original",
    pithumbsize: String(thumbSize),
    pilicense: "any",
    redirects: "1",
    titles: title,
  });

  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;

  const thumb = page.thumbnail?.source ? page.thumbnail : page.original;
  if (!thumb?.source) return null;

  return {
    url: thumb.source,
    width: thumb.width,
    height: thumb.height,
    page: page.title ?? title,
  };
}

async function viaFileList(
  title: string,
  thumbSize: number,
): Promise<DcwTitleImage | null> {
  const listed = await dcwGet<ImagesListResponse>({
    action: "query",
    prop: "images",
    imlimit: "40",
    redirects: "1",
    titles: title,
  });

  const page = listed?.query?.pages?.[0];
  if (!page || page.missing) return null;

  const candidates = (page.images ?? [])
    .map((image) => image.title ?? "")
    .filter(Boolean)
    .filter((fileTitle) => {
      const bare = fileTitle.replace(/^File:/i, "");
      if (!IMAGE_EXT_PATTERN.test(bare)) return false;
      if (BAD_FILE_PATTERN.test(bare)) return false;
      return true;
    })
    .slice(0, 8);

  if (!candidates.length) return null;

  const info = await dcwGet<ImageInfoResponse>({
    action: "query",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: String(thumbSize),
    titles: candidates.join("|"),
  });

  const pages = info?.query?.pages ?? [];
  const ordered = candidates
    .map((candidate) =>
      pages.find(
        (entry) => (entry.title ?? "").toLowerCase() === candidate.toLowerCase(),
      ),
    )
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  for (const entry of ordered) {
    const first = entry.imageinfo?.[0];
    if (!first) continue;
    if (first.mime && !/^image\//i.test(first.mime)) continue;
    // Skip tiny sprites / UI chrome that slipped past the name filter.
    if (typeof first.width === "number" && first.width < 120) continue;
    const url = first.thumburl ?? first.url;
    if (!url) continue;
    return {
      url,
      width: first.thumbwidth ?? first.width,
      height: first.thumbheight ?? first.height,
      page: page.title ?? title,
    };
  }

  return null;
}

// -------------------------------------------------------------------- main ---

/**
 * Best-effort image for a known DCW page title. Follows redirects, prefers the
 * page's designated lead image, then falls back to the first sane file on the
 * page. Returns null when nothing usable exists.
 */
export async function fetchDcwImageForTitle(
  title: string,
  options: { thumbSize?: number } = {},
): Promise<DcwTitleImage | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const thumbSize = options.thumbSize ?? 600;
  const key = cacheKey(trimmed, thumbSize);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let result = await viaPageImages(trimmed, thumbSize);
  if (!result) result = await viaFileList(trimmed, thumbSize);

  cache.set(key, {
    value: result,
    expiresAt: Date.now() + (result ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
  });

  return result;
}
