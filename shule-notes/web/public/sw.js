// Makes repeat visits instant: the site's own files (never the server's data) are kept on the device.
const VERSION = 'v1';
const ASSETS = 'shule-assets-' + VERSION;
const SHELL = 'shule-shell-' + VERSION;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.endsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the Shule Notes server (accounts, notes, payments) is never touched here

  // Built files have a fingerprint in their name and never change: kept for good, used straight away.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(ASSETS).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Pictures: shown from the device at once, refreshed in the background.
  if (/\.(png|jpe?g|webp|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.open(ASSETS).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  // The page itself: always the newest from the server, and the last good copy when there is no internet.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((cache) => cache.put('/', copy));
      return res;
    }).catch(() => caches.match('/').then((r) => r || Response.error())));
  }
});
