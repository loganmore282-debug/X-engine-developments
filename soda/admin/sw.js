// Bump this on every deploy that changes index.html/manifest.json/icons.
const CACHE = 'soda-admin-shell-v79';
// The panel lives under a secret path on the SAME host as the member app, so
// everything it owns is addressed relative to this worker (never from '/'),
// and its cache name has its own prefix so neither worker ever clears the
// other's cache.
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'vendor/firebase-app-compat.js', 'vendor/firebase-messaging-compat.js'];
// The uploaded icon, served by Soda backend. manifest.json and index.html's
// <link rel="icon"> point here too; the local /icon-*.png above stay only as
// the offline shell copy. Before this, the admin panel read the PNG that
// shipped in the repo, so replacing the icon in Admin -> Brand changed the
// members' app and left the admin's own icon untouched forever.
const BRAND_ICON = '/api/public/app-icon-192.png';

// Firebase Messaging background handler -- shows a notification for pushes
// that arrive while the admin panel tab isn't open/focused. Foreground
// pushes are handled separately by onMessage() in index.html.
// Firebase 10.12.0 compat builds are served from this origin (admin/vendor/)
// rather than gstatic: a blocked or flaky third-party host used to stop both
// this worker and the page from loading Firebase, so push could not start.
importScripts('vendor/firebase-app-compat.js');
importScripts('vendor/firebase-messaging-compat.js');
// Keep this in step with FIREBASE_CONFIG in admin-src/index.html. A service
// worker cannot import page variables, so the public web config is duplicated
// here deliberately for background messaging.
firebase.initializeApp({
  apiKey: "AIzaSyCOij0DRicI7MKDEibIlFfm0n3dl_faOnM",
  authDomain: "chnpetrol.firebaseapp.com",
  projectId: "chnpetrol",
  storageBucket: "chnpetrol.firebasestorage.app",
  messagingSenderId: "969724557876",
  appId: "1:969724557876:web:553284e329bdfd146a2861",
});
const messaging = firebase.messaging();
// The API is on the same host, under /api.
const API_ORIGIN = self.location.origin + '/api';

// The server sends DATA-ONLY pushes (title/body live in `data`), so THIS is
// the only place a notification is created. A message that carries a
// `notification` block is shown by the Firebase SDK on its own, and showing it
// here too is what made every alert appear twice -- such a message (an older
// server) is therefore left to the SDK.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  if (payload.notification && !d.title) return;
  // One notification per event: the same tag replaces rather than stacks, so a
  // repeated delivery, or the result of an approval, takes the place of the
  // alert instead of piling up beside it.
  const tag = d.withdrawalId ? 'wd-' + d.withdrawalId : d.depositId ? 'dep-' + d.depositId : undefined;
  const options = {
    body: d.body || '',
    icon: BRAND_ICON,
    badge: BRAND_ICON,
    tag,
    timestamp: Date.now(),
    data: d,
  };
  // Present only on an OWNER device's copy of a new-withdrawal alert (see
  // sendAdminPush). Staff devices never receive the flag, the token or the
  // secret, so they never see the button.
  if (d.quickApprove === '1' && d.withdrawalId && d.pushToken && d.secret) {
    options.actions = [{ action: 'approve', title: 'Approve' }];
    options.requireInteraction = true;
  }
  return self.registration.showNotification(d.title || 'Soda Admin', options);
});

// Tells any open admin page to refresh or jump to a tab.
async function tellPanels(message) {
  // Only THIS panel's own windows: the member app shares the host now.
  const list = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(c => c.url.indexOf(self.registration.scope) === 0);
  list.forEach(c => { try { c.postMessage(message); } catch (_) {} });
  return list;
}
async function openPanel(d) {
  const tab = d.type === 'withdrawal' ? 'withdrawals' : d.type === 'deposit' ? 'deposits' : '';
  const list = await tellPanels(tab ? { type: 'soda-admin-open', tab } : { type: 'soda-admin-refresh' });
  for (const c of list) {
    if ('focus' in c) return c.focus();
  }
  if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope + (tab ? '?tab=' + tab : ''));
}
// One tap on "Approve": the admin panel does not have to be open. The
// withdrawal id and this device's own token/secret arrived inside the push.
async function approveFromNotification(d) {
  const result = (title, body) => self.registration.showNotification(title, {
    body, icon: BRAND_ICON, badge: BRAND_ICON, tag: 'wd-' + d.withdrawalId, data: { type: 'withdrawal' },
  });
  try {
    const resp = await fetch(API_ORIGIN + '/admin/withdraw/quick-approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId: d.withdrawalId, pushToken: d.pushToken, secret: d.secret }),
    });
    const json = await resp.json().catch(() => ({}));
    if (resp.ok && json.status === 'success') await result('Withdrawal approved', json.message || 'The payout has been sent.');
    else await result('Could not approve', json.message || 'Open the admin panel to check.');
  } catch (_) {
    await result('Could not approve', 'No connection. Open the admin panel to check.');
  }
  await tellPanels({ type: 'soda-admin-refresh' });
}
self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  if (e.action === 'approve' && d.withdrawalId && d.pushToken && d.secret) {
    e.waitUntil(approveFromNotification(d));
    return;
  }
  e.waitUntil(openPanel(d));
});

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('soda-admin-shell-') === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Every cross-origin request (every API call to the backend) goes straight
// to the network, always, with NO caching -- these responses carry admin
// data and must never be served from a shared cache to a different admin
// session on the same device.
self.addEventListener('fetch', e => {
  const reqUrl = new URL(e.request.url);
  // The API is same-origin now (/api/...): never cached, always the network.
  if (reqUrl.origin !== self.location.origin || reqUrl.pathname.indexOf('/api/') === 0) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .catch(() => fetch(e.request).catch(() => caches.match(new URL('index.html', self.registration.scope).href)))
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
