/**
 * Free, key-less description enrichment for the crime taxonomy.
 *
 * Order of attempts: Detective Conan World (MediaWiki 1.45) -> English
 * Wikipedia -> null. Every category already ships a curated local description,
 * so a null here is a normal, non-error outcome.
 *
 * Server-only: DCW does not send permissive CORS headers, and this relies on
 * Next's fetch cache for shared revalidation.
 */

const DCW_API = "https://www.detectiveconanworld.com/wiki/api.php";
const WIKIPEDIA_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";

const USER_AGENT =
  "DCPH-Tracker/1.0 (open-source Detective Conan watch tracker; contact via repository issues)";

const DEFAULT_REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_TIMEOUT_MS = 6_000;
const MIN_EXTRACT_LENGTH = 60;

export type WikiSource = "detectiveconanworld" | "wikipedia";

export type WikiExtract = {
  source: WikiSource;
  title: string;
  extract: string;
  url: string;
};

type FetchOptions = {
  revalidate?: number;
  timeoutMs?: number;
};

async function getJson<T>(url: string, options: FetchOptions): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      next: { revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS },
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Timeouts, DNS failures and malformed JSON are all "no enrichment".
    return null;
  }
}

function tidy(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length >= MIN_EXTRACT_LENGTH ? text : null;
}

type DcwResponse = {
  query?: {
    pages?: {
      title?: string;
      missing?: boolean;
      extract?: string;
      fullurl?: string;
    }[];
  };
};

async function fetchDcwExtract(
  title: string,
  options: FetchOptions,
): Promise<WikiExtract | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "extracts|info",
    inprop: "url",
    explaintext: "1",
    exintro: "1",
    exsectionformat: "plain",
    redirects: "1",
    titles: title,
    origin: "*",
  });

  const data = await getJson<DcwResponse>(`${DCW_API}?${params}`, options);
  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;

  const extract = tidy(page.extract);
  if (!extract) return null;

  return {
    source: "detectiveconanworld",
    title: page.title ?? title,
    extract,
    url:
      page.fullurl ??
      `https://www.detectiveconanworld.com/wiki/${encodeURIComponent(
        (page.title ?? title).replace(/ /g, "_"),
      )}`,
  };
}

type WikipediaSummary = {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

async function fetchWikipediaExtract(
  title: string,
  options: FetchOptions,
): Promise<WikiExtract | null> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const data = await getJson<WikipediaSummary>(
    `${WIKIPEDIA_SUMMARY}/${slug}?redirect=true`,
    options,
  );

  if (!data || data.type === "disambiguation") return null;

  const extract = tidy(data.extract);
  if (!extract) return null;

  return {
    source: "wikipedia",
    title: data.title ?? title,
    extract,
    url:
      data.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${slug}`,
  };
}

/**
 * Returns the first usable extract across the supplied candidate titles.
 * Never throws.
 */
export async function fetchCrimeWikiExtract(
  candidates: {
    wikiTitles: readonly string[];
    wikipediaTitles: readonly string[];
  },
  options: FetchOptions = {},
): Promise<WikiExtract | null> {
  for (const title of candidates.wikiTitles) {
    const hit = await fetchDcwExtract(title, options);
    if (hit) return hit;
  }

  for (const title of candidates.wikipediaTitles) {
    const hit = await fetchWikipediaExtract(title, options);
    if (hit) return hit;
  }

  return null;
}
