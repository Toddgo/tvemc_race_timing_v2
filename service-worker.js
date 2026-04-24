/* TVEMC Race Timing v2 - service-worker.js
   Offline-first app shell cache.
   - Static JS/CSS/HTML: cache-first (served instantly offline)
   - PHP APIs: network-only (offline queue handled in race_timing.js)
   - Navigation: network-first, fallback to cached index.html
   Bump CACHE_VERSION when you deploy updated JS/CSS files.
*/

const CACHE_VERSION = "v3";
const CACHE_NAME = `tvemc-rtv2-cache-${CACHE_VERSION}`;
const APP_SCOPE_PREFIX = "/tvemc_race_timing_v2/";

// Static app-shell files to pre-cache on install.
// All paths are relative to the server root.
const APP_SHELL = [
  APP_SCOPE_PREFIX + "index.html",
  APP_SCOPE_PREFIX + "race_timing.js",
  APP_SCOPE_PREFIX + "race_timing.css",
  APP_SCOPE_PREFIX + "results_strip.js",
  APP_SCOPE_PREFIX + "results_strip.css",
  APP_SCOPE_PREFIX + "results_strip_modes.js",
  APP_SCOPE_PREFIX + "results_engine.js",
  APP_SCOPE_PREFIX + "results_math.js",
  APP_SCOPE_PREFIX + "radio-system.js",
  APP_SCOPE_PREFIX + "message-batches.js",
  APP_SCOPE_PREFIX + "station_autopass.js",
  APP_SCOPE_PREFIX + "autopass_undo.js",
  APP_SCOPE_PREFIX + "general_comments.js",
  APP_SCOPE_PREFIX + "hq_inbox_poll.js",
  APP_SCOPE_PREFIX + "hq_log.js",
  APP_SCOPE_PREFIX + "manifest.json",
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting(); // activate immediately without waiting for old tabs to close

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use individual catches so one missing file does not abort the whole install
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) =>
            console.warn(`[SW] Could not pre-cache ${url}:`, err.message)
          )
        )
      )
    )
  );
});

// ── Activate: delete stale caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim(); // take control of open pages immediately

      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("tvemc-rtv2-cache-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
    })()
  );
});

// ── Fetch: route requests ─────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle requests within our directory scope
  if (!url.pathname.startsWith(APP_SCOPE_PREFIX)) return;

  // PHP endpoints: network-only.
  // The app's offlineQueue handles submissions when the network is down.
  if (url.pathname.endsWith(".php")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          JSON.stringify({ success: false, error: "Offline – request queued locally" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // Navigation (page loads): network-first, fall back to cached index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Opportunistically update the cache with the fresh page
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return resp;
        })
        .catch(() =>
          caches.match(APP_SCOPE_PREFIX + "index.html")
        )
    );
    return;
  }

  // Static assets: cache-first, update in background
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      });
      return cached || network;
    })
  );
});

