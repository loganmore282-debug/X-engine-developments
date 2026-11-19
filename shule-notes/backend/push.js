// Push notifications through Firebase Cloud Messaging, sent from this server with
// the Firebase "service account" key the owner pastes into the admin panel
// (Settings, Push notifications). No Firebase library: a signed token request
// and one HTTPS call, both with Node's own crypto and fetch.
'use strict';
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const base64url = (data) => Buffer.from(data).toString('base64url');

// A signed request, valid for an hour, that Google trades for an access token.
function signJwt(account, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

let cached = { token: null, expires: 0, who: '' };
function clearTokenCache() { cached = { token: null, expires: 0, who: '' }; }

async function accessToken(account, fetchFn) {
  if (cached.who === account.client_email && cached.token && Date.now() < cached.expires - 60 * 1000) return cached.token;
  const response = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(account) }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error('Google did not accept the key' + (data.error_description ? ': ' + data.error_description : ''));
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000, who: account.client_email };
  return cached.token;
}

// "Senior 2" -> "class_senior_2". The app subscribes to the same name for the student's class.
function topicFor(classLevel) {
  if (!classLevel) return 'all';
  return 'class_' + String(classLevel).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Sends one notification to everyone (or to one class). Never throws: the caller gets { ok, message }.
async function sendPush({ account, title, body, classLevel, announcementId, fetchFn = fetch }) {
  if (!account) return { ok: false, skipped: true, message: 'Push notifications are not set up yet' };
  try {
    const token = await accessToken(account, fetchFn);
    const response = await fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          topic: topicFor(classLevel),
          notification: { title: String(title || 'Shule Notes').slice(0, 65), body: String(body || '').slice(0, 178) },
          data: { announcementId: String(announcementId || '') },
          android: { priority: 'HIGH', notification: { channel_id: 'announcements' } },
        },
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 160) : 'status ' + response.status;
      return { ok: false, message: 'Firebase said: ' + detail };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { sendPush, signJwt, topicFor, clearTokenCache };
