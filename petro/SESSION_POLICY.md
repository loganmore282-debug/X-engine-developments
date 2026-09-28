# Browser session and navigation update

Both panels sign out after 15 minutes without real interaction, with an
8-hour maximum session. Keyboard, touch, pointer and wheel input count as
activity. Polling, visibility changes and simply leaving a tab open do not.
Expiry is checked again when a suspended tab returns, before new activity
can renew it. Old sessions without the new metadata require a fresh login.

Member Firebase persistence and the personal account snapshot use tab session
storage. Static images and application assets retain their normal caches.
Silent stored-password login is disabled; autofill can still help the user
enter credentials. Expiry suppresses autofill auto-submit until manual login.

The server checks member sessions by Firebase uid/auth_time, so token refresh
does not reset the maximum lifetime. Activity heartbeats renew only unexpired
sessions. Logout revokes that login's record. Owner browser login now issues an
opaque expiring token, like staff login. Existing non-browser master-key API
integration remains supported. No payment transaction is cancelled by logout;
provider callbacks and reconciliation still run server-side.

Navigation improvements: concurrent GET requests share in-flight work (never
payment writes); repeated current-tab taps keep the page; unchanged asset data
is not repainted. Admin navigation gives immediate selection feedback and
shows a spinner only if the request takes longer than 120 ms. Its scrollbar
uses neutral grey. These reduce unnecessary work, not gateway/network latency.

Validation commands:

    node test-session-policy.js
    node test-session-navigation.js
    node test-admin-session.js
    node test-member-audit.js
    node test-member-audit.js --built
    node test-admin-smoke.js
    node build-core.js
    node build-admin.js

The member audit scopes its existing Mobile Money instruction check to that
panel, because newer Card/USDT panels each have their own instructions.
