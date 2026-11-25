/* SUMO 500 service worker — generated at build time by vite.config.js. Do not edit dist/sw.js. */
const VERSION = '__SW_VERSION__';
const CACHE = `sumo500-${VERSION}`;
const PRECACHE = __PRECACHE_LIST__;
const APP_SHELL = '/index.html';

self.addEventListener('install', (event) => {
  // The whole build (HTML + the exact JS/CSS/images it references) is cached as one
  // versioned set, so an offline start never pairs old HTML with new JavaScript.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('sumo500-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function fromNetworkWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(request, { signal: controller.signal }); } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first so a new deployment is picked up; the cached shell of THIS
    // version is the offline fallback for every SPA route (/battle, /growth, ...).
    event.respondWith((async () => {
      try {
        const response = await fromNetworkWithTimeout(request, 3500);
        if (response.ok) return response;
        throw new Error(`HTTP ${response.status}`);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(APP_SHELL)) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname === '/sw.js') return;

  // Hashed build assets and static files: cache first (this version), then network.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && url.pathname.startsWith('/assets/')) cache.put(request, response.clone());
    return response;
  })());
});
