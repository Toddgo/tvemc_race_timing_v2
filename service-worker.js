/* TVEMC Race Timing v2 - service-worker.js
   Minimal safe baseline (no top-level return)
*/

const CACHE_NAME = "tvemc-rtv2-cache-v1";
const APP_SCOPE_PREFIX = "/tvemc_race_timing_v2/";

// If you want to temporarily disable caching without breaking registration:
const ENABLE_CACHING = true;

self.addEventListener("install", (event) => {
  // Activate immediately
  self.skipWaiting();
  if (!ENABLE_CACHING) return;

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Keep this minimal; add files later once stable
      return cache.addAll([
        APP_SCOPE_PREFIX,
      ]);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    // if (!ENABLE_CACHING) return; // optional

    // Clean old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("tvemc-rtv2-cache-") && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
  })());
});


// Network-first for API calls; cache-first for same-origin static
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // NEVER intercept your PHP APIs in a cachey way
  const isApi =
    url.pathname.endsWith(".php") ||
    url.pathname.includes("/api/") ||
    url.searchParams.has("event_code") ||
    url.pathname.includes("passes_") ||
    url.pathname.includes("runners_") ||
    url.pathname.includes("status_overrides");

  if (isApi) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  if (!ENABLE_CACHING) {
    event.respondWith(fetch(req));
    return;
  }

  // Static: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      return cached || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return resp;
      });
    })
  );
});

