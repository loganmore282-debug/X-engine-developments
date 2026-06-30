/* ════════════════════════════════════════════════════════════════
   X-ENGINE SERVICE WORKER
   Two jobs:
   1) Offline app-shell caching + faster repeat loads
   2) Firebase Cloud Messaging background push (notifications when the
      app is fully closed)
   ════════════════════════════════════════════════════════════════ */

const CACHE = 'xe-shell-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './preview-1.jpg'
];

// ── INSTALL: pre-cache the app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// ── ACTIVATE: drop old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: network-first for pages, stale-while-revalidate for assets ──
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API / auth / firestore calls — always live
  if (
    url.hostname.includes('railway.app') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit')
  ) {
    return; // let the browser handle it normally
  }

  // Navigations (opening the app / a page): network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Same-origin static assets (core.*.js, icons, css): stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (Google Fonts etc.): cache-first, then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200 && (url.hostname.includes('gstatic') || url.hostname.includes('fonts'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached))
  );
});

/* ════════════════════════════════════════════════════════════════
   FIREBASE CLOUD MESSAGING — background notifications
   ════════════════════════════════════════════════════════════════ */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey:            "AIzaSyBA_S0u69P9Por2kkhF189HHuhLTBX1vtE",
    authDomain:        "x--engine.firebaseapp.com",
    projectId:         "x--engine",
    storageBucket:     "x--engine.firebasestorage.app",
    messagingSenderId: "420172832235",
    appId:             "1:420172832235:web:735d05ea80069177ec4dae"
  });

  const messaging = firebase.messaging();

  // Fires when a push arrives and the app is in the background / closed
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    const d = payload.data || {};
    const title = n.title || d.title || 'X-Engine';
    const body  = n.body  || d.message || '';
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './notification-badge.png',
      tag: d.tag || 'xe-notify',
      data: { url: d.url || './' },
      vibrate: [120, 60, 120]
    });
  });
} catch (e) {
  // FCM scripts unavailable (offline first load) — caching still works
}

// Tap a notification → focus/open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
