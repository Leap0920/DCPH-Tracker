// lib/dcw.ts
// Low-level Detective Conan World (MediaWiki 1.45) API client.
// Public wiki: no API key. Requires a descriptive User-Agent and self-throttling.

export const DCW_API = "https://www.detectiveconanworld.com/wiki/api.php";

export const DCW_USER_AGENT =
  process.env.DCW_USER_AGENT ??
  "DCPH-Tracker/1.0 (+https://github.com/your-org/DCPH-Tracker; you@example.com)";

const MIN_INTERVAL_MS = 200; // <= 5 req/s
const MAX_RETRIES = 4;

type Params = Record<string, string | number | boolean | undefined>;

let lastCallAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Single api.php GET with throttling, maxlag awareness and exponential backoff.
 * Throws on unrecoverable errors; callers should treat failures as "no image".
 */
export async function dcwQuery<T = unknown>(params: Params): Promise<T> {
  const search = new URLSearchParams({
    format: "json",
    formatversion: "2",
    maxlag: "5",
  });

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const url = `${DCW_API}?${search.toString()}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": DCW_USER_AGENT,
          Accept: "application/json",
          "Accept-Encoding": "gzip",
        },
        // Never let a hung wiki stall a sync run.
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }

      if (!res.ok) throw new Error(`DCW ${res.status} ${res.statusText}`);

      const json = (await res.json()) as { error?: { code?: string; info?: string } };

      // MediaWiki replica lag: back off and retry.
      if (json.error?.code === "maxlag") {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      if (json.error) throw new Error(`DCW API error: ${json.error.code} ${json.error.info ?? ""}`);

      return json as T;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      await sleep(500 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("DCW request failed");
}
