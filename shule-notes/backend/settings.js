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
  // App updates. 0 = not set; the newest build is then read from the download page.
  latestVersionCode: 0,
  minVersionCode: 0,   // apps older than this must update before they can be used
  updateUrl: '',       // where "Update" goes (Google Play link later); '' = the download page
  updateNote: '',      // one line shown with the update prompt
  anthropicKey: '',  // the Claude API key, entered in the admin panel (never sent back to it)
  firebaseServiceAccount: null, // { project_id, client_email, private_key } for push notifications (never sent back)
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
  for (const key of ['latestVersionCode', 'minVersionCode']) {
    if (patch[key] !== undefined) {
      if (patch[key] === null || patch[key] === '') { next[key] = 0; continue; }
      const n = Number(patch[key]);
      if (!Number.isInteger(n) || n < 0 || n > 9999999) return { ok: false, message: 'Version numbers are whole numbers, for example 12' };
      next[key] = n;
    }
  }
  if (patch.updateUrl !== undefined) {
    const v = text(patch.updateUrl, 300);
    if (v && !/^https:\/\/[^\s]+$/.test(v)) return { ok: false, message: 'The update link must start with https://' };
    next.updateUrl = v;
  }
  if (patch.updateNote !== undefined) next.updateNote = text(patch.updateNote, 140);
  if (patch.aiModel !== undefined) {
    const v = text(patch.aiModel, 60);
    if (v && !AI_MODELS.some((m) => m.id === v)) return { ok: false, message: 'Choose one of the listed AI models' };
    next.aiModel = v;
  }
  const unset = {};
  if (patch.clearFirebase) unset.firebaseServiceAccount = '';
  else if (typeof patch.firebaseServiceAccount === 'string' && patch.firebaseServiceAccount.trim()) {
    let parsed;
    try { parsed = JSON.parse(patch.firebaseServiceAccount); } catch (_) { return { ok: false, message: 'That is not the Firebase key file. Paste the whole contents of the .json file you downloaded.' }; }
    if (!parsed || parsed.type !== 'service_account' || !parsed.project_id || !parsed.client_email || !/BEGIN PRIVATE KEY/.test(String(parsed.private_key || ''))) {
      return { ok: false, message: 'That file is not a Firebase service account key. In Firebase: Project settings, Service accounts, Generate new private key.' };
    }
    next.firebaseServiceAccount = { project_id: String(parsed.project_id), client_email: String(parsed.client_email), private_key: String(parsed.private_key) };
  }
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
  const { anthropicKey, firebaseServiceAccount, ...rest } = s;
  const account = firebaseServiceAccount && firebaseServiceAccount.project_id ? firebaseServiceAccount : null;
  return { ...rest, firebaseSet: !!account, firebaseProject: account ? account.project_id : '', anthropicKeySet: isRealKey(anthropicKey), anthropicKeyHint: isRealKey(anthropicKey) ? '…' + anthropicKey.slice(-4) : '' };
}

// What the app and the public pages may see.
function publicConfig(s) {
  return {
    aiEnabled: s.aiEnabled !== false,
    supportPhone: s.supportPhone || '',
    supportWhatsapp: s.supportWhatsapp || '',
    supportEmail: s.supportEmail || '',
    supportHours: s.supportHours || '',
    // The app compares these with its own version number.
    latestVersion: Number(s.latestVersionCode) || 0,
    minVersion: Number(s.minVersionCode) || 0,
    updateUrl: s.updateUrl || '',
    updateNote: s.updateNote || '',
  };
}

module.exports = { getSettings, saveSettings, publicConfig, adminView, clearSettingsCache, DEFAULTS, AI_MODELS, isRealKey };
