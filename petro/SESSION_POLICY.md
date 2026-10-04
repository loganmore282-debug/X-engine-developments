# Browser session and navigation update

The member panel signs out after 1 hour without real interaction; the admin
panel retains its 15-minute inactivity timeout. Both retain an 8-hour maximum
session. Keyboard, touch, pointer and wheel input count as
activity. Polling, visibility changes and simply leaving a tab open do not.
Expiry is checked again when a suspended tab returns, before new activity
can renew it. Old sessions without the new metadata require a fresh login.

Member Firebase persistence and the personal account snapshot use tab session
storage. Static images and application assets retain their normal caches.
Silent stored-password login is disabled; autofill can still help the user
enter credentials. Deliberate logout suppresses autofill auto-submit; idle
expiry retains the existing picker-assisted re-authentication behaviour.

The server checks member sessions by Firebase uid/auth_time, so token refresh
does not reset the maximum lifetime. Activity heartbeats renew only unexpired
sessions. Logout revokes that login's record. Owner browser login now issues an
opaque expiring token, like staff login. Existing non-browser master-key API
integration remains supported. No payment transaction is cancelled by logout;
provider callbacks and reconciliation still run server-side.

`session-policy.js` exports `IDLE_MS` (1 hour) for members and `ADMIN_IDLE_MS`
(15 minutes) for admins. Admin validation and activity updates explicitly use
the admin limit; `MAX_MS` remains 8 hours for both. Each panel's inline idle
controller matches its server limit. Changing the member limit does not reset
the original login time or revive a revoked session.

The member page preconnects to its existing Firebase sign-in endpoint and
Petro API while the login screen loads. These browser connection hints can
reduce connection setup delay; Firebase sign-in, persistence, token/revocation
checks and all session validation remain unchanged. The actual speed benefit
depends on browser connection reuse and network conditions.

Navigation improvements: concurrent GET requests share in-flight work (never
payment writes); repeated current-tab taps keep the page; unchanged asset data
is not repainted. Admin navigation gives immediate selection feedback and
shows a spinner only if the request takes longer than 120 ms. Its scrollbar
uses neutral grey. These reduce unnecessary work, not gateway/network latency.

Validation commands:

    node test-session-policy.js
    node test-session-policy.js --built
    node test-session-navigation.js
    node test-admin-session.js
    node test-member-audit.js
    node test-member-audit.js --built
    node test-admin-smoke.js
    node build-core.js
    node build-admin.js

The member audit scopes its existing Mobile Money instruction check to that
panel, because newer Card/USDT panels each have their own instructions.

Member login recovery: the browser tolerates Firebase login timestamps up to
60 seconds ahead of its clock, matching the backend tolerance. It clamps only
new local session timestamps to local now, never extends an existing session,
and leaves server enforcement unchanged. Larger clock errors still reject.
Automatic sign-out retains the phone, clears the password before asynchronous
cleanup, and explains session rejection. A manual login waits for pending
logout and account initialization; failed initialization remains retryable.
Autofill waits for a valid complete phone and password before submitting.
