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
// Codex-verified real bug (2026-08-17): this pointed at a stale/wrong
// backend domain left over from before a rename -- admin-src/index.html
// (and the user app) both use mycallbackurl.onrender.com, but this file
// alone still said mybusinessuganda.onrender.com. Since this constant is
// what the one-tap "Approve" button on a push notification posts to, that
// mismatch meant tapping Approve straight from a notification (no admin
// panel open) silently failed every time -- it was POSTing to a domain
// that isn't this app's real backend.
const SERVER = 'https://mycallbackurl.onrender.com';
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) {}
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || 'Space8 admin';
  const options = {
    body: n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: d,
  };
  // Only set by the server for owner devices on a new-withdrawal push (see
  // sendWithdrawalPush in server.js) — staff devices never get this flag,
  // so they never see the Approve button. requireInteraction keeps it on
  // screen until the owner actually acts on it instead of auto-dismissing.
  if (d.quickApprove === '1') {
    options.actions = [{ action: 'approve', title: 'Approve' }];
    options.requireInteraction = true;
  }
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', e => {
  const action = e.action;
  const d = e.notification.data || {};
  e.notification.close();
  // One-tap approve straight from the notification, no admin panel open at
  // all -- the withdrawalId/pushToken/secret all rode in on this same push
  // (see /admin/withdraw/quick-approve in server.js). Never the master
  // ADMIN_KEY or a login session, and this whole branch is unreachable for
  // staff devices since they never receive the 'approve' action or a secret.
  if (action === 'approve' && d.withdrawalId && d.pushToken && d.secret) {
    e.waitUntil(
      fetch(SERVER + '/admin/withdraw/quick-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId: d.withdrawalId, pushToken: d.pushToken, secret: d.secret })
      })
        .then(r => r.json())
        .then(r => self.registration.showNotification(
          r && r.status === 'success' ? 'Withdrawal sent' : 'Could not approve',
          { body: (r && r.message) || 'Open the admin panel to check.', icon: '/icon-192.png' }
        ))
        .catch(() => self.registration.showNotification('Could not approve', { body: 'Network error — open the admin panel to check.', icon: '/icon-192.png' }))
    );
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
