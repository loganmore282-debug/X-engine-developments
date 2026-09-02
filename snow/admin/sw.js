// Bump this on every deploy that changes index.html/manifest.json/icons.
const CACHE = 'snow-admin-shell-v28';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Firebase Messaging background handler -- shows a notification for pushes
// that arrive while the admin panel tab isn't open/focused. Foreground
// pushes are handled separately by onMessage() in index.html.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyDhaVbSaQyYRdSiP1LLze-Apb6kNNTVCsc",
  authDomain: "snow-beer-cbf65.firebaseapp.com",
  projectId: "snow-beer-cbf65",
  storageBucket: "snow-beer-cbf65.firebasestorage.app",
  messagingSenderId: "171510439127",
  appId: "1:171510439127:web:94f15dd79aa057e3d32492",
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Snow Admin', {
    body: n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
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
