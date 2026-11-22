// An activity log of what was done in the admin panel (who gave access, banned, deleted, changed settings, and when),
// so the owner can always see what happened. Secrets and passwords are never written to it.
'use strict';
const { getDb } = require('./db');

const SAFE_KEYS = ['id', 'planId', 'minutes', 'status', 'name', 'title', 'classLevel', 'scope', 'free', 'active', 'kind', 'direction', 'paymentsEnabled', 'signupsOpen', 'trialMinutes'];
const READ_ONLY = /\/(list|get|stats|check-key|detail|export|activity)/;

const LABELS = {
  '/admin/users/grant': 'Gave access', '/admin/users/grant-bulk': 'Gave access to many students', '/admin/users/revoke': 'Removed access',
  '/admin/users/status': 'Changed a student\'s status', '/admin/users/reset-password': 'Reset a password', '/admin/users/delete': 'Deleted a student',
  '/admin/users/update': 'Edited a student', '/admin/settings/save': 'Changed settings', '/admin/notes/update': 'Edited a note', '/admin/notes/delete': 'Deleted a note',
  '/admin/notes/upload': 'Uploaded a note', '/admin/subjects/save': 'Saved a subject', '/admin/subjects/delete': 'Deleted a subject',
  '/admin/announcements/save': 'Saved an announcement', '/admin/announcements/delete': 'Deleted an announcement', '/admin/payments/recheck': 'Checked a payment again',
  '/admin/onboarding/save': 'Saved an intro slide', '/admin/onboarding/delete': 'Deleted an intro slide',
};

function middleware() {
  return (req, res, next) => {
    res.on('finish', () => {
      const full = req.originalUrl.split('?')[0];
      if (req.method !== 'POST' || res.statusCode >= 400 || READ_ONLY.test(full) || !LABELS[full]) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const detail = {};
      for (const k of SAFE_KEYS) if (body[k] !== undefined && typeof body[k] !== 'object') detail[k] = String(body[k]).slice(0, 80);
      (async () => {
        // Say WHO it was done to, by name (not just an id).
        if (detail.id && /\/admin\/users\//.test(full)) {
          try { const u = await getDb().collection('users').findOne({ _id: new (require('mongodb').ObjectId)(detail.id) }); if (u) detail.student = u.name; } catch (_) { /* a deleted student has no name any more */ }
        }
        await record(LABELS[full], detail, req.ip);
      })().catch(() => {});
    });
    next();
  };
}

async function record(action, detail, ip) {
  await getDb().collection('auditLog').insertOne({ at: new Date(), action, detail: detail || {}, ip: ip || '' });
}

async function list({ page, pageSize } = {}) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const col = getDb().collection('auditLog');
  const total = await col.countDocuments({});
  const rows = await col.find({}).sort({ at: -1 }).skip((current - 1) * size).limit(size).toArray();
  return { total, page: current, pageSize: size, events: rows.map((r) => ({ at: r.at, action: r.action, detail: r.detail || {}, ip: r.ip || '' })) };
}

module.exports = { middleware, record, list };
