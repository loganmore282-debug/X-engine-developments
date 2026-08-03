// Deliberately a no-op — the admin panel must NEVER serve stale data from a
// cache. This only exists so the admin panel can be "installed" (PWA icon,
// standalone window); it never intercepts or caches anything.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => {});

// Background push display — handled directly via the raw Web Push API
// rather than the Firebase Messaging SDK's own background handler, so this
// file stays a plain no-op service worker plus exactly these two listeners;
// no caching logic is ever added here.
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) {}
  const n = payload.notification || {};
  const title = n.title || 'ChocoMCC admin';
  const options = {
    body: n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
