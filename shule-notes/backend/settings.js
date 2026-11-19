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
  aiModel: '',       // '' = use the AI_MODEL environment value
  anthropicKey: '',  // the Claude API key, entered in the admin panel (never sent back to it)
};

// The models the owner may pick in the panel (cheapest first).
const AI_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5: cheapest and fastest' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5: balanced (recommended)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5: best answers, most expensive' },
];
const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const isRealKey = (k) => typeof k === 'string' && KEY_PATTERN.test(k);

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
  if (patch.aiModel !== undefined) {
    const v = text(patch.aiModel, 60);
    if (v && !AI_MODELS.some((m) => m.id === v)) return { ok: false, message: 'Choose one of the listed AI models' };
    next.aiModel = v;
  }
  const unset = {};
  if (patch.clearAnthropicKey) unset.anthropicKey = '';
  else if (typeof patch.anthropicKey === 'string' && patch.anthropicKey.trim()) {
    const v = patch.anthropicKey.trim();
    if (!isRealKey(v)) return { ok: false, message: 'That does not look like a Claude API key. It starts with sk-ant- and is one long line with no spaces.' };
    next.anthropicKey = v;
  }

  const update = {};
  if (Object.keys(next).length) update.$set = next;
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(update).length) await getDb().collection('settings').updateOne({ _id: 'app' }, update, { upsert: true });
  clearSettingsCache();
  return { ok: true, settings: await getSettings() };
}

// What the admin panel sees: everything EXCEPT the key itself, only whether one is saved.
function adminView(s) {
  const { anthropicKey, ...rest } = s;
  return { ...rest, anthropicKeySet: isRealKey(anthropicKey), anthropicKeyHint: isRealKey(anthropicKey) ? '…' + anthropicKey.slice(-4) : '' };
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

module.exports = { getSettings, saveSettings, publicConfig, adminView, clearSettingsCache, DEFAULTS, AI_MODELS, isRealKey };
