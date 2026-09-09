// Bump this on every deploy that changes index.html/manifest.json/icons.
const CACHE = 'chipz-admin-shell-v5';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
// The uploaded icon, served by chipz-server. manifest.json and index.html's
// <link rel="icon"> point here too; the local /icon-*.png above stay only as
// the offline shell copy. Before this, the admin panel read the PNG that
// shipped in the repo, so replacing the icon in Admin -> Brand changed the
// members' app and left the admin's own icon untouched forever.
const BRAND_ICON = 'https://chipz-server.onrender.com/public/app-icon-192.png';

// Firebase Messaging background handler -- shows a notification for pushes
// that arrive while the admin panel tab isn't open/focused. Foreground
// pushes are handled separately by onMessage() in index.html.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
// Chipz's own Firebase project. This file was left on SNOW's project when
// the panel was forked -- a real bug, not a cosmetic one: the background
// push handler registered against a different project entirely, so admin
// notifications could never arrive here. It must stay in step with
// FIREBASE_CONFIG in admin-src/index.html; a service worker cannot import
// from the page, so the values are necessarily duplicated.
firebase.initializeApp({
  apiKey: "AIzaSyDUfGBx-8WD9SOufQNC5oNrsyikKobJLwM",
  authDomain: "chipz-23a4c.firebaseapp.com",
  projectId: "chipz-23a4c",
  storageBucket: "chipz-23a4c.firebasestorage.app",
  messagingSenderId: "649643781611",
  appId: "1:649643781611:web:31215a9f084cc1918a3dae",
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Chipz Admin', {
    body: n.body || '',
    icon: BRAND_ICON,
    badge: BRAND_ICON,
    data: payload.data || {}
  });
});

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

// Every cross-origin request (every API call to the backend) goes straight
// to the network, always, with NO caching -- these responses carry admin
// data and must never be served from a shared cache to a different admin
// session on the same device.
self.addEventListener('fetch', e => {
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === 'navigate') {
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
