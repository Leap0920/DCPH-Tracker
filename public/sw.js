/* Detective Conan PH — service worker.
 *
 * Deliberately conservative:
 *   - Immutable build assets: cache-first (safe, content-hashed URLs).
 *   - Same-origin static files in PRECACHE: stale-while-revalidate.
 *   - Everything else (HTML, /api/*, Supabase, auth): network-only, untouched.
 *
 * Bump CACHE_VERSION on any change to this file or PRECACHE_ASSETS.
 */

const CACHE_VERSION = "dcph-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMMUTABLE_CACHE = `${CACHE_VERSION}-immutable`;

const PRECACHE_ASSETS = [
  "/tab-icon.png",
  "/hero-image.jpg",
  "/hero-image-darkM.jpg",
];

/* Never intercept these, regardless of origin. */
const BYPASS_PATH_PREFIXES = ["/api/", "/auth/", "/callback"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // addAll() rejects wholesale if any single asset 404s — add individually.
      await Promise.all(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image")
  );
}

function isPrecachedAsset(url) {
  return PRECACHE_ASSETS.includes(url.pathname);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;
  return new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (BYPASS_PATH_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (request.headers.get("accept")?.includes("text/html")) return;
  if (request.headers.has("range")) return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, IMMUTABLE_CACHE));
    return;
  }

  if (isPrecachedAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});
