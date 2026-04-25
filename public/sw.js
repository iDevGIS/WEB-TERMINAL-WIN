// CYBERFRAME service worker
// Strategy:
//   - Never touch WebSocket / API / share / watch / admin endpoints
//   - Network-first for HTML shell (so updates roll out fast)
//   - Cache-first for static assets in /plugins/, /novnc/, favicon, manifest
//   - Falls back to cached shell when offline

const CACHE_VERSION = 'cyberframe-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isPassthrough(url) {
  const p = url.pathname;
  if (p.startsWith('/api/')) return true;
  if (p.startsWith('/ws') || p.startsWith('/share-ws')) return true;
  if (p.startsWith('/watch/')) return true;
  if (p.startsWith('/admin')) return true;
  if (p.startsWith('/upload')) return true;
  return false;
}

function isStatic(url) {
  const p = url.pathname;
  if (p === '/favicon.svg' || p === '/manifest.webmanifest') return true;
  if (p.startsWith('/plugins/')) return true;
  if (p.startsWith('/novnc/')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (isPassthrough(url)) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const resp = await fetch(req);
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Network-first for shell HTML
  event.respondWith(
    (async () => {
      try {
        const resp = await fetch(req);
        if (resp && resp.ok && (req.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html')) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put('/', resp.clone());
        }
        return resp;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match('/') || await cache.match('/index.html');
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
