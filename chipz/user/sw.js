// Bump this on every deploy that changes index.html/manifest.json/icons so
// installed devices pick up the new build instead of sitting on a cached
// shell indefinitely (the exact "stale build" failure mode space8/Voltra
// both hit repeatedly before this pattern was adopted).
const CACHE = 'chipz-shell-v74';
const VENDOR_CACHE = 'chipz-vendor-firebase-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/treasure-chest.png', '/turntable.png', '/spin-wheel.png', '/copy-clip.png',
  '/nav-home.png', '/nav-products.png', '/nav-myproducts.png', '/nav-referral.png', '/nav-team.png', '/nav-account.png',
  '/act-deposit.png', '/act-withdraw.png', '/act-channel.png', '/act-service.png', '/act-bell.png',
  '/set-download.png', '/set-wallet.png', '/set-balance.png', '/set-messages.png', '/set-loginpw.png', '/set-tradepw.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR_CACHE && k !== BRAND_CACHE).map(k => caches.delete(k))))
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

// ── THE INSTALLED APP'S NAME ──
//
// Owner: "let's not make chipz to be default name, let's make it to be
// backend such that the set name abides every functions ... system visuals
// should be backend." The name Android prints under the installed icon, and
// the one in Chrome's "Install app" sheet, come from manifest.json's `name` --
// a static file the phone downloads, never a line of app code. Renaming the
// app in the admin panel therefore changed every screen and left that alone.
//
// A service worker is the one thing that can close that gap on a static host:
// it owns this origin's responses, so it can hand Chrome a manifest built
// from the live setting while keeping the file same-origin, which a
// cross-origin or data: manifest could not (scope and start_url resolve
// against the manifest's own origin, so either would break installing
// outright).
//
// Everything here is best-effort by design. Any failure -- offline, backend
// asleep, malformed JSON -- falls through to the manifest exactly as shipped,
// because a phone that cannot install the app is a far worse outcome than one
// that installs it under last week's name.
const API_ORIGIN = 'https://chipz-server.onrender.com';
const BRAND_CACHE = 'chipz-brand-v1';
const BRAND_KEY = '/__brand-name';

async function rememberedBrandName() {
  try {
    const c = await caches.open(BRAND_CACHE);
    const hit = await c.match(BRAND_KEY);
    return hit ? (await hit.text()).trim() : '';
  } catch (_) { return ''; }
}
async function fetchBrandName() {
  try {
    const r = await fetch(API_ORIGIN + '/public/settings', { cache: 'no-store' });
    if (!r.ok) return '';
    const d = await r.json();
    const n = d && d.settings && typeof d.settings.brandName === 'string'
      ? d.settings.brandName.trim() : '';
    if (!n) return '';
    const c = await caches.open(BRAND_CACHE);
    await c.put(BRAND_KEY, new Response(n, { headers: { 'Content-Type': 'text/plain' } }));
    return n;
  } catch (_) { return ''; }
}
async function brandedManifest(request) {
  // Start from the real file, so every field except the name stays exactly as
  // shipped -- icons, colours, scope, display. Only the wording is rewritten.
  let base = null;
  try { base = await fetch(request, { cache: 'no-cache' }); } catch (_) {}
  if (!base || !base.ok) base = await caches.match('/manifest.json');
  if (!base) return fetch(request);
  let json;
  try { json = await base.clone().json(); } catch (_) { return base; }

  // Serve what is already known and refresh in the background: a manifest
  // fetch happens while Chrome is deciding whether to show an install prompt,
  // and blocking it on a cold backend is how that prompt never appears.
  let name = await rememberedBrandName();
  const refreshing = fetchBrandName();
  if (!name) name = await refreshing;
  else refreshing.catch(() => {});

  const shipped = typeof json.name === 'string' ? json.name : '';
  if (name && name !== shipped) {
    json.name = name;
    json.short_name = name;
    // The description carries the name inside a sentence. Substituting the
    // shipped name keeps one copy of that sentence -- restating it here would
    // be a second place to edit and a first place to drift.
    if (shipped && typeof json.description === 'string')
      json.description = json.description.split(shipped).join(name);
  }
  return new Response(JSON.stringify(json), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }
  });
}

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
    // Do NOT respondWith here. Returning without responding hands the request
    // back to the browser untouched, which is what respondWith(fetch(...))
    // was approximating anyway -- minus a service-worker round trip, and
    // minus the worker sitting in the middle of media streaming. The Home
    // banner video is served from chipz-server with byte ranges; a worker
    // relaying 206 responses is a known source of stalled video, and there is
    // nothing to gain here since none of this is cached.
    return;
  }
  // Before the cache-first branch below: '/manifest.json' is in SHELL, so
  // without this it would always be served as the file that shipped.
  if (reqUrl.pathname === '/manifest.json') {
    e.respondWith(brandedManifest(e.request).catch(() => fetch(e.request)));
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
