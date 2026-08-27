// Bump this on every deploy that changes index.html/manifest.json/icons so
// installed devices pick up the new build instead of sitting on a cached
// shell indefinitely (the exact "stale build" failure mode space8/Voltra
// both hit repeatedly before this pattern was adopted).
const CACHE = 'snow-shell-v21';
const VENDOR_CACHE = 'snow-vendor-firebase-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/badge.png', '/treasure-chest.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations (always try to get the freshest app shell),
// falling back to cache when offline. Cache-first for the static shell
// assets ONLY. Every cross-origin request (every API call to the backend)
// goes straight to the network, every time, with NO caching whatsoever --
// those responses are per-user and must never be shared between
// sessions/devices on the same phone.
//
// ONE deliberate exception: Firebase Auth's SDK script files (imported live
// from gstatic.com in index.html). Public static library code, no
// Authorization header, no per-user data, version-pinned right in the URL
// (.../firebasejs/10.12.0/...) -- cache-first here removes that network
// round-trip from the second app open onward.
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';
self.addEventListener('fetch', e => {
  if (e.request.url.indexOf(FIREBASE_SDK_PREFIX) === 0) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(VENDOR_CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      }))
    );
    return;
  }
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === 'navigate') {
    // cache:'no-cache' forces revalidation against the server instead of
    // letting the browser/CDN hand back a stored copy of index.html.
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .catch(() => fetch(e.request).catch(() => caches.match('/index.html')))
    );
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
