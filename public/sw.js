/* JABAL MANDI Billing — service worker.
 * Goal: survive short network hiccups. The app shell loads from cache when
 * the connection flaps; live data still flows through Convex over its own
 * connection (cross-origin, never touched here), so it reconnects + replays
 * queued writes on its own. Bump CACHE to invalidate old caches on deploy. */
const CACHE = "jabal-pwa-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icon.svg"])).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never interfere with writes or non-GET requests.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests. Convex (wss/https to *.convex.cloud) and
  // any other origin pass straight through untouched.
  if (url.origin !== self.location.origin) return;

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Page navigations: network-first (always fresh online), fall back to cached
  // copy of a previously visited page, then the offline page.
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Other same-origin GETs (icons, public assets): network-first with fallback.
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw new Error("offline");
  }
}
