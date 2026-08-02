// Deliberately a no-op — the admin panel must NEVER serve stale data from a
// cache. This only exists so the admin panel can be "installed" (PWA icon,
// standalone window); it never intercepts or caches anything.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => {});
