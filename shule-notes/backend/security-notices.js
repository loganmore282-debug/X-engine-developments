// Sign-in alerts for students: a short, human description of the device ("Shule Notes app on Samsung SM-A155F",
// "Chrome on Windows") and a personal notice in the student's bell when their account is opened on a DIFFERENT
// device than last time (not on every sign-in, which would only teach students to ignore it). Kept 90 days.
'use strict';
const { getDb } = require('./db');

const NOTICE_DAYS = 90;

function clean(s, max) { return String(s || '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, max); }

function describeDevice(userAgent) {
  const ua = clean(userAgent, 300);
  // Our own app sends: ShuleNotes/<version> (Android <release>; <maker> <model>)
  const app = ua.match(/^ShuleNotes\/[\w.\-]+ \(Android [\w.]+; ([^)]+)\)/);
  if (app) return `Shule Notes app on ${clean(app[1], 60)}`;
  if (/okhttp/i.test(ua)) return 'the Shule Notes app';
  if (!ua) return 'an unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'an unknown device';
}

// Called after a successful sign-in. `previousDevice` is what the account last signed in on; `signedOut` says whether an
// older device was signed out by this sign-in (one device at a time).
async function recordSignIn({ userId, device, previousDevice, signedOut, sessionId }) {
  if (!previousDevice || previousDevice === device) return null;
  const now = new Date();
  const doc = {
    userId: String(userId), kind: 'security', title: 'New sign-in',
    message: `Your account was opened on ${device}` + (signedOut ? `, and ${previousDevice} was signed out.` : '.') + ' Not you? Contact support right away.',
    device, sessionId: sessionId ? String(sessionId) : null, createdAt: now, expiresAt: new Date(now.getTime() + NOTICE_DAYS * 86400000),
  };
  await getDb().collection('notices').insertOne(doc);
  require('./live').publish('user:' + String(userId), 'notice', { title: doc.title });
  return doc;
}

async function listNotices(userId, currentSessionId) {
  const rows = await getDb().collection('notices').find({ userId: String(userId) }).sort({ createdAt: -1 }).limit(30).toArray();
  const now = Date.now();
  return rows.filter((n) => !n.expiresAt || new Date(n.expiresAt).getTime() > now).map((n) => ({
    id: String(n._id), kind: n.kind || 'security', title: n.title, message: n.message, createdAt: n.createdAt,
    // The sign-in that made this notice was THIS device: shown as "This device", never counted as unread.
    own: !!(currentSessionId && n.sessionId && n.sessionId === String(currentSessionId)),
  }));
}

module.exports = { describeDevice, recordSignIn, listNotices };
