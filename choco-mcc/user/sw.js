// v2: FIXED A SEV-1 BUG — one member's account data was being served to the
// NEXT member who signed in on the same browser/device ("I signed out,
// signed up, and saw the old account's records"). Root cause: the fetch
// handler below applied cache-first to EVERY request, with no origin check.
// A service worker intercepts ALL fetches made by pages it controls,
// including cross-origin ones — so every API call the app makes to the
// Render backend (GET /account, /deposits, /withdrawals, /transactions,
// etc.) was ALSO being cache-matched and cache-stored here. The Cache API
// keys purely on request URL + method; it does NOT key on the Authorization
// header. Every one of those endpoints identifies the user ONLY via that
// header (the URL is always exactly "/account", "/deposits", ...), so once
// any member's response was cached under that URL, literally any other
// member who later hit the same endpoint on the same device got served that
// FIRST member's cached data — a real, reproducible cross-account data leak,
// not a database or Firebase problem. The bump to v2 also forces every
// already-affected device to drop its poisoned v1 cache on next load.
// v3: new app icon shipped (icon-192/512 + maskable variants) — bumped so
// every device (including ones already on v2) re-fetches the precached
// SHELL list below instead of keeping the old icon cached indefinitely.
// v4: deposit screen procedure box + curved home banner + clear
// success state on the deposit-status screen — bumped so devices pull
// the fresh index.html instead of the cached shell.
const CACHE = 'chocomcc-shell-v4';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations (always try to get the freshest app shell),
// falling back to cache when offline. Cache-first for the static shell
// assets ONLY. Anything cross-origin (every API call to the backend) goes
// straight to the network, every time, with NO caching whatsoever — those
// responses are per-user and must never be shared between sessions/devices.
self.addEventListener('fetch', e => {
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => cached))
  );
});
