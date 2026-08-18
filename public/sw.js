/* Detective Conan PH — conservative static-cache-only service worker.
 *
 * Scope: ONLY immutable static assets.
 *  - Pre-caches /icon.svg + /hero-image.jpg on install.
 *  - Cache-first for /_next/static/* build assets (content-hashed → immutable)
 *    and the same icon/font assets at runtime.
 *  - NEVER caches or intercepts: /api/* routes, Supabase REST URLs, or HTML
 *    navigations — those stay network-only so DB-backed pages are always fresh.
 * No push, no offline-first, no runtime caching of page HTML.
 */

const STATIC_CACHE = "dcph-static-v1";

const PRECACHE_ASSETS = ["/icon.svg", "/hero-image.jpg"];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// Only immutable, same-origin static requests are handled by this worker:
// content-hashed /_next/* build assets plus our own icon assets. Everything
// else (HTML navigations, /api/*, Supabase REST) falls through untouched.
function isCacheableStatic(url) {
  if (!isSameOrigin(url)) return false;
  const { pathname } = url;
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/icon.svg" ||
    pathname === "/hero-image.jpg"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isCacheableStatic(url)) return; // network-only for everything else

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
