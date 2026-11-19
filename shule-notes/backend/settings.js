// Settings the owner changes from the admin panel without touching the
// server: the AI helper's on/off switch and daily limit, and the support
// contacts the app shows ("Forgot your password?", Help). One document.
'use strict';
const { getDb } = require('./db');

const DEFAULTS = {
  aiEnabled: true,
  aiDailyLimit: null, // null: use the AI_DAILY_LIMIT environment value
  supportPhone: '',
  supportWhatsapp: '',
  supportEmail: '',
  supportHours: '',
};

const TTL_MS = 15 * 1000;
let cached = null;
let cachedAt = 0;

async function getSettings() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const doc = await getDb().collection('settings').findOne({ _id: 'app' });
  cached = { ...DEFAULTS, ...(doc || {}) };
  delete cached._id;
  cachedAt = Date.now();
  return cached;
}

function clearSettingsCache() {
  cached = null;
  cachedAt = 0;
}

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Only the fields that are present are changed. Returns { ok, message?, settings? }.
async function saveSettings(patch) {
  const next = {};
  if (patch.aiEnabled !== undefined) next.aiEnabled = !!patch.aiEnabled;
  if (patch.aiDailyLimit !== undefined) {
    if (patch.aiDailyLimit === null || patch.aiDailyLimit === '') {
      next.aiDailyLimit = null;
    } else {
      const n = Number(patch.aiDailyLimit);
      if (!Number.isInteger(n) || n < 1 || n > 500) return { ok: false, message: 'The daily limit must be a whole number from 1 to 500' };
      next.aiDailyLimit = n;
    }
  }
  for (const key of ['supportPhone', 'supportWhatsapp']) {
    if (patch[key] !== undefined) {
      const v = text(patch[key], 20);
      if (v && !/^\+?[\d\s-]{7,20}$/.test(v)) return { ok: false, message: 'Phone numbers can only contain digits, spaces and a leading +' };
      next[key] = v;
    }
  }
  if (patch.supportEmail !== undefined) {
    const v = text(patch.supportEmail, 120);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, message: 'That email address does not look right' };
    next.supportEmail = v;
  }
  if (patch.supportHours !== undefined) next.supportHours = text(patch.supportHours, 80);

  await getDb().collection('settings').updateOne({ _id: 'app' }, { $set: next }, { upsert: true });
  clearSettingsCache();
  return { ok: true, settings: await getSettings() };
}

// What the app and the public pages may see.
function publicConfig(s) {
  return {
    aiEnabled: s.aiEnabled !== false,
    supportPhone: s.supportPhone || '',
    supportWhatsapp: s.supportWhatsapp || '',
    supportEmail: s.supportEmail || '',
    supportHours: s.supportHours || '',
  };
}

module.exports = { getSettings, saveSettings, publicConfig, clearSettingsCache, DEFAULTS };
