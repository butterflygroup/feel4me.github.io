/**
 * Offline support. Network-first, so a normal deploy shows up immediately with no
 * version bump; the cache is only used when the network is unavailable or slow.
 * Add new site files to PRECACHE so they work offline from the first visit.
 */
const CACHE = "feel4me-v1";
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE = [
  "./",
  "css/site.css",
  "js/wheel.js",
  "js/colors-panel.js",
  "js/emotion-guide.js",
  "js/feelings-reference.js",
  "data/emotions.json",
  "data/emotion-guides.json",
  "manifest.webmanifest",
  "icons/favicon-32.png",
  "icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Shared color links (`/?pb=…`) and guide drafts all resolve to the same cached page. */
async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === "navigate") return cache.match("./");
  return undefined;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) {
      const key = request.mode === "navigate" ? "./" : request;
      cache.put(key, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await fromCache(request);
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
