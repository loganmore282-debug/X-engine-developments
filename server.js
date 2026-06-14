const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.set('trust proxy', true);

// ── ANTI-SCRAPING / ABUSE PROTECTION ──
// Payment-provider (MarzPay) server-to-server callbacks must bypass every
// guard below: they arrive with non-browser User-Agents, carry no Origin
// header, and must never be rate-limited — otherwise deposits/withdrawals
// would silently fail to confirm. They are validated inside their handlers
// by transaction reference instead.
const GUARD_EXEMPT = new Set([
  '/', '/health',
  '/callback', '/deposit/callback', '/withdraw/callback',
  '/sms/incoming',   // phone SMS-forwarder: non-browser UA, no Origin, secret-authed
]);
function guardExempt(req) {
  if (req.method === 'OPTIONS') return true;     // CORS preflight
  return GUARD_EXEMPT.has(req.path);
}

// 1. Block obvious scraping tools by User-Agent.
const SCRAPER_UA = /(curl|wget|python-requests|python-urllib|scrapy|httpclient|go-http-client|libwww|java\/|okhttp|node-fetch|axios\/|aiohttp|httpx|headlesschrome|phantomjs|puppeteer|playwright|selenium|bot|spider|crawler|scrape)/i;
app.use((req, res, next) => {
  if (guardExempt(req)) return next();
  const ua = req.headers['user-agent'] || '';
  if (!ua || SCRAPER_UA.test(ua)) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  next();
});

// 2. Origin lock — a cloned/phishing copy of the site served from any other
//    domain cannot use this API, even if it strips the client-side guard
//    (the cloner controls their HTML, but never this server). Browsers always
//    send Origin on cross-origin fetches; a missing header is allowed so
//    native/PWA/webview clients are never broken — only a present, foreign
//    Origin/Referer is blocked.
function originHostOk(req) {
  const src = req.headers['origin'] || req.headers['referer'] || '';
  if (!src) return true;                          // no header → don't block
  let host;
  try { host = new URL(src).hostname.toLowerCase(); } catch (e) { return true; }
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return host === 'x-engine.site' || host.endsWith('.x-engine.site');
}
app.use((req, res, next) => {
  if (guardExempt(req)) return next();
  if (!originHostOk(req)) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  next();
});

// 3. Lightweight in-memory per-IP rate limiter (sliding window).
const RL_WINDOW_MS = 60 * 1000;   // 1 minute
// High ceiling on purpose: mobile carriers (MTN/Airtel) use CGNAT, so many
// real users share one public IP. Only genuinely abusive automated traffic
// (which hammers thousands/min) should ever trip this.
const RL_MAX = 600;               // requests per window per IP
const _rlHits = new Map();
setInterval(() => {                // periodic cleanup of stale IPs
  const cutoff = Date.now() - RL_WINDOW_MS;
  for (const [ip, arr] of _rlHits) {
    const kept = arr.filter(t => t > cutoff);
    if (kept.length) _rlHits.set(ip, kept); else _rlHits.delete(ip);
  }
}, RL_WINDOW_MS).unref();
app.use((req, res, next) => {
  if (guardExempt(req)) return next();
  const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
  const now = Date.now();
  const arr = (_rlHits.get(ip) || []).filter(t => t > now - RL_WINDOW_MS);
  arr.push(now);
  _rlHits.set(ip, arr);
  if (arr.length > RL_MAX) {
    return res.status(429).json({ status: 'error', message: 'Too many requests. Please slow down.' });
  }
  next();
});

// ── FIREBASE ADMIN ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('❌ Invalid FIREBASE_SERVICE_ACCOUNT:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── CONFIG ──
const MARZ_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZ_AUTH = process.env.MARZ_AUTH || process.env.MARZ_API_KEY || Buffer.from('marz_aueGdHOscrkRHVeO:xZ2vxvSE4KB0hSmTfTNdO3pZsBhpm6eU').toString('base64');
const RAILWAY_URL = (process.env.RAILWAY_URL || 'https://x-engine-server-production.up.railway.app').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY || 'xengine_admin_2026';

// ── MarzSMS ──
const MARZ_SMS_KEY    = 'sk_U70q1IJmxVdiSOX0RvgvOABD6fXbPGWx';
const MARZ_SMS_SECRET = 'Moj74ZHoMJunnBgNScgFupMjVvSbjHipZsFnY9enkWO1TV3mOwN21arBHG8MTUdX';
async function marzSMS(phone, message) {
  const creds = Buffer.from(`${MARZ_SMS_KEY}:${MARZ_SMS_SECRET}`).toString('base64');
  try {
    const r = await fetch('https://sms.wearemarz.com/api/v1/sms/send', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: phone, message })
    });
    const data = await r.json();
    console.log(`📱 SMS → ${phone}: ${data.success ? '✅ sent' : '❌ ' + data.message}`);
    return data;
  } catch(e) {
    console.error('MarzSMS error:', e.message);
    return { success: false, message: e.message };
  }
}

// ── HELPERS ──
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.randomBytes(1)[0] & 15;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function fmtUGX(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function hashPin(pin) { return crypto.createHash('sha256').update(String(pin) + 'xengine_salt_2026').digest('hex'); }
function eatNow() {
  // Railway runs UTC — always shift +3h for Uganda EAT
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}
function nowStr() {
  const d = eatNow();
  const pad = n => String(n).padStart(2,'0');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const date = days[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const hh   = d.getUTCHours();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12  = hh % 12 || 12;
  const time = pad(h12) + ':' + pad(d.getUTCMinutes()) + ' ' + ampm;
  return { date, time, iso: new Date().toISOString() };
}
async function generateUniqueReferralCode(userId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    const seed = userId + Date.now() + attempt;
    const hash = crypto.createHash('sha256').update(seed).digest();
    for (let i = 0; i < 6; i++) code += chars[hash[i] % chars.length];
    const existing = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (existing.empty) return code;
  }
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

function cleanPhone(phone) {
  const s = String(phone || '').replace(/\s+/g, '').replace(/^\+/, '');
  if (s.startsWith('256')) return '+' + s;
  if (s.startsWith('0')) return '+256' + s.slice(1);
  if (s.length === 9) return '+256' + s;
  return '+' + s;
}
function makeEmail(phone) { return cleanPhone(phone).slice(-9) + '@xengine.app'; }

// ── MARZIPAY API CALLS ──
async function marzCollect({ amount, phone, reference, description, callbackUrl }) {
  const payload = {
    amount: Number(amount),
    phone_number: cleanPhone(phone),
    country: 'UG',
    reference,
    description: description || 'X-Engine Deposit',
  };
  if (callbackUrl) payload.callback_url = callbackUrl;
  console.log('📤 marzCollect payload:', JSON.stringify({ ...payload, phone_number: '***' }));
  const resp = await axios.post(`${MARZ_BASE}/collect-money`, payload, {
    headers: { 'Authorization': `Basic ${MARZ_AUTH}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });
  return resp.data;
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl }) {
  const payload = {
    amount: Number(amount),
    phone_number: cleanPhone(phone),
    country: 'UG',
    reference,
    description: description || 'X-Engine Withdrawal',
  };
  if (callbackUrl) payload.callback_url = callbackUrl;
  console.log('📤 marzSendMoney payload:', JSON.stringify({ ...payload, phone_number: '***' }));
  const resp = await axios.post(`${MARZ_BASE}/send-money`, payload, {
    headers: { 'Authorization': `Basic ${MARZ_AUTH}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });
  return resp.data;
}
// Fetch the REAL transaction status from MarzPay — used to verify webhook
// callbacks server-side so a forged callback can never move money.
// Docs: GET /transactions/{id} accepts UUID/reference and returns the
// same shape as webhook payloads.
async function marzGetTransaction(idOrRef) {
  const resp = await axios.get(`${MARZ_BASE}/transactions/${idOrRef}`, {
    headers: { 'Authorization': `Basic ${MARZ_AUTH}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return resp.data;
}
// Returns 'completed' | 'failed' | 'pending' | ... or '' if unverifiable
// (network error). Empty string means "couldn't check" — callers treat a
// CONTRADICTING status as fraud but allow '' so a MarzPay API blip doesn't
// freeze genuine payments (a forger can't cause our verify call to fail).
async function marzVerifyStatus(idOrRef) {
  try {
    const v = await marzGetTransaction(idOrRef);
    return String(
      v?.transaction?.status || v?.data?.transaction?.status || v?.status || ''
    ).toLowerCase();
  } catch (e) {
    console.warn('⚠️ MarzPay status verify unreachable for', idOrRef, '—', e.message);
    return '';
  }
}
async function marzVerifyPhone(phone) {
  const resp = await axios.post(`${MARZ_BASE}/phone-verification/verify`,
    { phone_number: cleanPhone(phone).replace('+', '') },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${MARZ_AUTH}` }, timeout: 15000 }
  );
  return resp.data;
}

// ── PUSH (FCM) HELPER ──
// Sends a phone push to all of a user's registered devices. Cleans up any
// tokens Firebase reports as dead. Never throws — push failure must never
// break the in-app notification or the surrounding transaction.
async function sendPush(userId, title, body, data = {}) {
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return;
    const tokens = (snap.data().fcmTokens || []).filter(Boolean);
    if (!tokens.length) return;

    const strData = {};
    for (const k of Object.keys(data)) strData[k] = String(data[k] ?? '');

    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: String(title || 'X-Engine'), body: String(body || '') },
      data: { title: String(title || ''), message: String(body || ''), ...strData },
      webpush: {
        notification: { icon: '/icon-192.png', badge: '/notification-badge.png' },
        fcmOptions: { link: data.url || 'https://www.x-engine.site/' }
      },
      android: { priority: 'high' }
    });

    // Prune dead tokens
    const dead = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (code.includes('registration-token-not-registered') ||
            code.includes('invalid-registration-token') ||
            code.includes('invalid-argument')) dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await db.collection('users').doc(userId).update({
        fcmTokens: FieldValue.arrayRemove(...dead)
      });
    }
  } catch (e) {
    console.error('sendPush error:', e.message);
  }
}

// ── NOTIFICATION HELPER ──
async function notify(userId, title, message, type, extras = {}) {
  const { date, time } = nowStr();
  await db.collection('notifications').add({
    userId, title, message, type,
    readBy: [], details: { ...extras, date, time },
    date, time, createdAt: FieldValue.serverTimestamp()
  });
  // Fire a phone push too (best-effort, never blocks)
  sendPush(userId, title, message, { type, url: 'https://www.x-engine.site/' });
}

// ── UNLOCK LOCKED CASHBACK ──
// Called when a user makes their first real deposit.
// Finds all investments bought with reg-bonus only (lockedCashback=true),
// flips the lock off and credits any accumulated pendingCashback immediately.
async function unlockLockedCashback(userId) {
  try {
    const lockedSnap = await db.collection('investments')
      .where('userId', '==', userId)
      .where('lockedCashback', '==', true)
      .get();
    if (lockedSnap.empty) return;
    const { date, time } = nowStr();
    for (const invDoc of lockedSnap.docs) {
      const inv = invDoc.data();
      const pendingAmt = inv.pendingCashback || 0;
      const batch = db.batch();
      // Unlock the investment — future daily cashback credits normally
      batch.update(invDoc.ref, { lockedCashback: false, unlockedAt: FieldValue.serverTimestamp() });
      if (pendingAmt > 0) {
        // Credit ALL accumulated locked cashback to cumulativeBalance right now
        batch.update(db.collection('users').doc(userId), {
          walletBalance:     FieldValue.increment(pendingAmt),
          cumulativeBalance: FieldValue.increment(pendingAmt),
          totalEarned:       FieldValue.increment(pendingAmt)
        });
        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
          userId, type: 'daily_cashback',
          description: `🔓 Cashback unlocked — ${inv.productName || 'Investment'} (${pendingAmt > 0 ? fmtUGX(pendingAmt) + ' released' : 'now active'})`,
          amount: pendingAmt, status: 'success', date, time,
          investmentId: invDoc.id, createdAt: FieldValue.serverTimestamp()
        });
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId, title: '🔓 Cashback Unlocked!',
          message: `Your deposit has unlocked ${fmtUGX(pendingAmt)} in accumulated cashback from your ${inv.productName || 'investment'}!\n\n💰 Credited to your Cumulative Wallet.\n📅 ${date} ⏰ ${time}\n\nFrom now on, daily cashback is paid directly to your wallet every day! 🌱`,
          type: 'daily_cashback', amount: pendingAmt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      } else {
        // No pending amount — just notify that future cashback is now live
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId, title: '🔓 Daily Cashback Activated!',
          message: `Your ${inv.productName || 'investment'} daily cashback is now active and will be credited to your Cumulative Wallet every day! 🌱\n\n📅 ${date} ⏰ ${time}`,
          type: 'daily_cashback', amount: 0, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      }
      await batch.commit();
    }
    console.log(`🔓 Unlocked ${lockedSnap.size} locked investment(s) for ${userId}`);
  } catch (e) { console.error('Unlock locked cashback error:', e.message); }
}

// ═══════════════════════════════════════════
// AUTH MIDDLEWARE — verify Firebase ID token owns the userId in the body
// ═══════════════════════════════════════════
// Rollout: if a Bearer token is present it is verified and MUST match
// req.body.userId. Requests without a token are allowed until
// REQUIRE_AUTH=true is set in the environment (so old cached clients
// keep working during deploy), then they are rejected.
async function verifyUser(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.authUid = decoded.uid;
      if (req.body?.userId && req.body.userId !== decoded.uid) {
        console.warn(`🚨 userId mismatch: token=${decoded.uid} body=${req.body.userId} path=${req.path}`);
        return res.status(403).json({ status: 'error', message: 'Unauthorized — account mismatch' });
      }
      return next();
    } catch (e) {
      return res.status(401).json({ status: 'error', message: 'Session expired — please log in again' });
    }
  }
  if (process.env.REQUIRE_AUTH === 'true') {
    return res.status(401).json({ status: 'error', message: 'Authentication required — please update the app' });
  }
  console.warn(`⚠️ Unauthenticated request to ${req.path} (legacy mode)`);
  return next();
}

// ═══════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════
app.get('/', (req, res) => res.json({
  status: '🌱 X-Engine Server',
  time: new Date().toISOString(),
  version: '2.1',
  endpoints: {
    deposit: 'POST /collect',
    depositCallback: 'POST /callback  (alias: POST /deposit/callback)',
    depositCheck: 'GET /check/:reference',
    withdrawal: 'POST /withdraw/request',
    withdrawApprove: 'POST /withdraw/approve',
    withdrawCallback: 'POST /withdraw/callback'
  }
}));

// ═══════════════════════════════════════════
// PHONE VERIFICATION
// ═══════════════════════════════════════════
app.post('/verify-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });
  try {
    const data = await marzVerifyPhone(phone);
    const name = data.data?.full_name || '';
    if (data.success && name) {
      return res.json({ success: true, name, phone: data.data?.phone_number || phone });
    }
    return res.json({ success: false, message: data.message || 'Number not found in network database' });
  } catch (e) {
    return res.json({ success: false, message: e.response?.data?.message || e.message });
  }
});

// ═══════════════════════════════════════════
// PUSH NOTIFICATIONS — register device token
// ═══════════════════════════════════════════
app.post('/fcm/register', verifyUser, async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ status: 'error', message: 'userId and token required' });
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    // arrayUnion dedupes automatically; cap implicitly by pruning dead ones on send
    await ref.update({ fcmTokens: FieldValue.arrayUnion(token), fcmUpdatedAt: FieldValue.serverTimestamp() });
    return res.json({ status: 'success', message: 'Push enabled' });
  } catch (e) {
    console.error('fcm/register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// REFERRAL TREE — nested L1 → L2 → L3 downline
// ═══════════════════════════════════════════
app.post('/team/tree', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    // Pull a user's direct referrals (one level)
    const childrenOf = async (uid) => {
      const snap = await db.collection('referrals')
        .where('referrerId', '==', uid).limit(200).get();
      return snap.docs.map(d => {
        const r = d.data();
        return {
          uid: r.referredUserId,
          name: (r.referredName || 'Member').replace('+256', '0'),
          active: !!r.paid
        };
      });
    };

    const l1 = await childrenOf(userId);
    let activeCount = 0, totalCount = 0;

    for (const a of l1) {
      totalCount++; if (a.active) activeCount++;
      a.children = await childrenOf(a.uid);           // L2
      for (const b of a.children) {
        totalCount++; if (b.active) activeCount++;
        b.children = await childrenOf(b.uid);         // L3
        for (const c of b.children) { totalCount++; if (c.active) activeCount++; }
      }
    }

    return res.json({
      status: 'success',
      tree: l1,
      summary: {
        l1: l1.length,
        l2: l1.reduce((s, a) => s + a.children.length, 0),
        l3: l1.reduce((s, a) => s + a.children.reduce((s2, b) => s2 + b.children.length, 0), 0),
        totalMembers: totalCount,
        activeMembers: activeCount
      }
    });
  } catch (e) {
    console.error('team/tree error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// PUSH NOTIFICATIONS — register device token
// ═══════════════════════════════════════════
app.post('/fcm/register', verifyUser, async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin || String(pin).length !== 4 || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ status: 'error', message: 'Valid 4-digit PIN required' });
  }
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await db.collection('users').doc(userId).update({ withdrawalPin: hashPin(pin), pinSetAt: FieldValue.serverTimestamp(), pinResetByAdmin: false });
    return res.json({ status: 'success', message: 'PIN set successfully' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// ── Check if user has PIN set ──
app.post('/pin/status', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.json({ hasPin: false });
    const hasPin = !!(snap.data().withdrawalPin);
    const pinLockUntil = snap.data().pinLockUntil?.toDate?.() || null;
    const locked = !!(pinLockUntil && pinLockUntil > new Date());
    return res.json({ hasPin, locked, attempts: snap.data().pinAttempts || 0 });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── User requests PIN reset (notifies admin) ──
app.post('/pin/request-reset', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    const user = snap.data() || {};
    // Log request in Firestore for admin to see
    await db.collection('adminRequests').add({
      type: 'pin_reset',
      userId,
      userName: user.name || user.phone || userId,
      userPhone: user.phone || '',
      message: `User ${user.phone || userId} has requested a withdrawal PIN reset.`,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', message: 'Reset request submitted' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/password/request-reset', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = snap.data() || {};
    const existing = await db.collection('adminRequests')
      .where('userId', '==', userId).where('type', '==', 'password_reset').where('status', '==', 'pending').limit(1).get();
    if (!existing.empty) return res.json({ status: 'success', message: 'Request already pending' });
    await db.collection('adminRequests').add({
      type: 'password_reset', userId,
      userName: user.name || user.phone || userId,
      userPhone: user.phone || '',
      status: 'pending', createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', message: 'Password reset request submitted' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/withdraw/request-phone-change', verifyUser, async (req, res) => {
  const { userId, newPhone } = req.body;
  if (!userId || !newPhone) return res.status(400).json({ status: 'error', message: 'userId and newPhone required' });
  const cleanedNew = cleanPhone(newPhone);
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = snap.data() || {};
    const existing = await db.collection('adminRequests')
      .where('userId', '==', userId).where('type', '==', 'withdrawal_number').where('status', '==', 'pending').limit(1).get();
    if (!existing.empty) return res.json({ status: 'success', message: 'Request already pending' });
    await db.collection('adminRequests').add({
      type: 'withdrawal_number', userId,
      userName: user.name || user.phone || userId,
      userPhone: user.phone || '',
      requestedPhone: cleanedNew,
      status: 'pending', createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', message: 'Phone change request submitted. Admin will review shortly.' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/approve-phone-change', async (req, res) => {
  const { requestId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!requestId) return res.status(400).json({ status: 'error', message: 'requestId required' });
  try {
    const reqSnap = await db.collection('adminRequests').doc(requestId).get();
    if (!reqSnap.exists) return res.status(404).json({ status: 'error', message: 'Request not found' });
    const reqData = reqSnap.data();
    if (reqData.type !== 'withdrawal_number') return res.status(400).json({ status: 'error', message: 'Not a phone change request' });
    const { userId, requestedPhone, userName } = reqData;
    // Update all activated bank accounts for this user — or add as a new one
    // For simplicity: update user profile phone as withdrawal number
    await db.collection('users').doc(userId).update({ withdrawalPhone: requestedPhone });
    // Update the bankAccount if one matches the old phone, or add new one
    const bankSnap = await db.collection('bankAccounts').where('userId','==',userId).where('status','==','activated').limit(1).get();
    if (!bankSnap.empty) {
      await bankSnap.docs[0].ref.update({ phone: requestedPhone });
    } else {
      await db.collection('bankAccounts').add({
        userId, phone: requestedPhone, name: userName || '',
        network: 'MTN', status: 'activated', createdAt: FieldValue.serverTimestamp()
      });
    }
    await db.collection('adminRequests').doc(requestId).update({ status: 'done', handledAt: FieldValue.serverTimestamp() });
    const { date, time } = nowStr();
    await notify(userId, '✅ Phone Change Approved',
      `Your withdrawal phone number has been updated to ${requestedPhone}.\n\n📅 ${date} ⏰ ${time}\n\nYou can now withdraw to this number.`,
      'info', {});
    return res.json({ status: 'success', message: 'Phone change approved' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});



app.post('/pin/verify', verifyUser, async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin) return res.status(400).json({ status: 'error', valid: false });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', valid: false });
    const stored = userSnap.data().withdrawalPin;
    if (!stored) return res.json({ status: 'no_pin', valid: false, needsSetup: true });
    const valid = stored === hashPin(pin);
    return res.json({ status: valid ? 'success' : 'error', valid });
  } catch (e) { return res.status(500).json({ status: 'error', valid: false }); }
});

// ═══════════════════════════════════════════
// DEPOSITS
// ═══════════════════════════════════════════
app.post('/collect', verifyUser, async (req, res) => {
  const { userId, amount, phone } = req.body;
  if (!userId || !amount || !phone) return res.status(400).json({ status: 'error', message: 'userId, amount, phone required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 30000 || amt > 200000) return res.status(400).json({ status: 'error', message: 'Amount must be 30,000–200,000 UGX' });
  const fullPhone = cleanPhone(phone);
  const reference = uuidv4();
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    // Save to Firestore BEFORE calling Marzipay
    const depRef = db.collection('deposits').doc();
    const pendingRef = db.collection('pendingPayments').doc(reference);
    const batch = db.batch();
    batch.set(depRef, {
      userId, amount: amt, phone: fullPhone, reference,
      status: 'pending', type: 'mobile_money',
      createdAt: FieldValue.serverTimestamp()
    });
    batch.set(pendingRef, {
      userId, amount: amt, phone: fullPhone,
      depositId: depRef.id, status: 'pending',
      createdAt: FieldValue.serverTimestamp()
    });
    await batch.commit();
    // Call Marzipay — callback URL = /callback (also aliased as /deposit/callback)
    let marzData;
    try {
      marzData = await marzCollect({
        amount: amt, phone: fullPhone, reference,
        callbackUrl: `${RAILWAY_URL}/callback`
      });
    } catch (marzErr) {
      const errBody = marzErr.response?.data;
      const errMsg = errBody?.message || marzErr.message;
      console.error('❌ Marzipay collect error:', JSON.stringify(errBody || marzErr.message));
      await Promise.all([
        depRef.update({ status: 'marz_error', error: errMsg }),
        pendingRef.update({ status: 'failed', failReason: 'Payment gateway error: ' + errMsg })
      ]);
      return res.status(502).json({ status: 'error', message: 'Payment gateway: ' + errMsg });
    }
    const marzUuid = marzData?.data?.transaction?.uuid || marzData?.data?.uuid || '';
    await Promise.all([
      depRef.update({ marzTxId: marzUuid, marzRef: reference, status: 'processing' }),
      pendingRef.update({ marzTxId: marzUuid, status: 'processing' })
    ]);
    console.log(`📤 Collection initiated: ${reference} | ${fmtUGX(amt)} | ${fullPhone}`);
    return res.json({ status: 'success', reference, depositId: depRef.id, marz: marzData });
  } catch (e) {
    console.error('Collect error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── DEPOSIT CALLBACK HANDLER (shared) ──
async function handleDepositCallback(req, res) {
  const payload = req.body;
  console.log('📩 Deposit callback:', JSON.stringify(payload));
  res.status(200).json({ received: true }); // Always ack Marzpay immediately
  setImmediate(async () => {
    try {
      // ── MarzPay sends: { event_type, transaction: { reference, status, ... }, collection: { ... } }
      // No "data" wrapper — fix: read from payload.transaction directly
      const reference =
        payload.reference ||
        payload.transaction?.reference ||           // ← actual MarzPay structure
        payload.data?.transaction?.reference ||
        payload.merchant_reference ||
        payload.external_reference;

      // Status: check transaction.status first, then fall back to event_type
      const rawStatus = (() => {
        const s = (
          payload.status ||
          payload.transaction?.status ||            // ← actual MarzPay structure
          payload.data?.transaction?.status ||
          ''
        ).toLowerCase();
        if (s) return s;
        // MarzPay collection event types (from docs): completed / failed / pending / cancelled
        if (payload.event_type === 'collection.completed') return 'completed';
        if (payload.event_type === 'collection.successful') return 'successful';
        if (payload.event_type === 'collection.failed') return 'failed';
        if (payload.event_type === 'collection.cancelled') return 'cancelled';
        return '';
      })();

      const isSuccess = ['successful', 'success', 'completed', 'paid'].includes(rawStatus);
      const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);

      const callbackAmount = parseFloat(
        payload.amount ||
        payload.collection?.amount?.raw ||          // ← actual MarzPay structure
        payload.transaction?.amount?.raw ||         // ← docs: amount also on transaction object
        payload.data?.collection?.amount?.raw ||
        payload.charged_amount || 0
      );
      const phone =
        payload.phone_number ||
        payload.transaction?.phone_number ||        // ← actual MarzPay structure
        payload.collection?.phone_number ||         // ← actual MarzPay structure
        payload.data?.collection?.phone_number ||
        payload.msisdn || null;
      const txId =
        payload.transaction?.uuid ||               // ← actual MarzPay structure
        payload.data?.transaction?.uuid ||
        payload.transaction_id || payload.id || '';
      // Docs: MTN/Airtel txn ID arrives as collection.provider_transaction_id
      const providerTxId = payload.collection?.provider_transaction_id || '';
      const provider =
        payload.collection?.provider ||            // ← actual MarzPay structure
        payload.data?.collection?.provider ||
        payload.provider || 'Mobile Money';
      if (!reference) { console.log('❌ No reference in callback'); return; }
      const pendingSnap = await db.collection('pendingPayments').doc(reference).get();
      if (!pendingSnap.exists) { console.log('❌ No pending payment for ref:', reference); return; }
      const pending = pendingSnap.data();
      if (pending.status === 'success') { console.log('⚠️ Already processed:', reference); return; }
      const userId = pending.userId;
      const expectedAmount = pending.amount;
      // SECURITY: Never credit more than expected
      const creditAmount = (callbackAmount > 0 && callbackAmount <= expectedAmount * 1.01)
        ? callbackAmount : expectedAmount;
      // ── ANTI-FRAUD: callbacks are unauthenticated, so confirm the status
      // with MarzPay directly before crediting. A forged "completed"
      // callback fails here because MarzPay reports the real status.
      if (isSuccess && pending.marzTxId) {
        const realStatus = await marzVerifyStatus(pending.marzTxId);
        if (realStatus && !['completed', 'successful', 'success', 'paid'].includes(realStatus)) {
          console.warn(`🚨 FRAUD BLOCK: callback claims success but MarzPay says '${realStatus}' for ${reference} — NOT crediting`);
          return;
        }
      }
      if (isSuccess) {
        const { date, time } = nowStr();
        let alreadyProcessed = false;
        try {
          await db.runTransaction(async (t) => {
            // Re-read pendingPayments inside transaction for true idempotency
            const pendingRef2 = db.collection('pendingPayments').doc(reference);
            const freshPending = await t.get(pendingRef2);
            if (freshPending.data()?.status === 'success') throw new Error('ALREADY_PROCESSED');
            const userRef = db.collection('users').doc(userId);
            const userSnap = await t.get(userRef);
            if (!userSnap.exists) throw new Error('User not found: ' + userId);
            t.update(userRef, { walletBalance: FieldValue.increment(creditAmount), depositBalance: FieldValue.increment(creditAmount), depositCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
            if (pending.depositId) {
              t.update(db.collection('deposits').doc(pending.depositId), {
                status: 'success', amountCredited: creditAmount, marzTxId: txId,
                providerTxId, phone: phone || pending.phone, provider, paidAt: FieldValue.serverTimestamp()
              });
            }
            t.update(pendingRef2, {
              status: 'success', amountCredited: creditAmount, processedAt: FieldValue.serverTimestamp()
            });
            const txRef = db.collection('transactions').doc();
            t.set(txRef, {
              userId, type: 'deposit', description: `Deposit via ${provider}`,
              amount: creditAmount, phone: phone || pending.phone || '', reference,
              marzTxId: txId, provider, status: 'success', date, time,
              createdAt: FieldValue.serverTimestamp()
            });
            const notifRef = db.collection('notifications').doc();
            t.set(notifRef, {
              userId, title: '⚡ Funds Received!',
              message: `${fmtUGX(creditAmount)} has been credited to your wallet.\n\n📅 Date: ${date}\n⏰ Time: ${time}\n📱 Phone: ${phone || pending.phone || 'N/A'}\n🔖 Reference: ${reference}\n💳 Provider: ${provider}\n\nThank you for investing with X-Engine! ⚙️`,
              type: 'deposit', amount: creditAmount, reference, provider,
              phone: phone || pending.phone || '', date, time,
              readBy: [], createdAt: FieldValue.serverTimestamp()
            });
          });
        } catch (txErr) {
          if (txErr.message === 'ALREADY_PROCESSED') { console.log('⚠️ Idempotency: already processed:', reference); alreadyProcessed = true; }
          else throw txErr;
        }
        if (!alreadyProcessed) {
          console.log(`✅ Credited ${fmtUGX(creditAmount)} to user ${userId}`);
          await checkAndPayReferral(userId, creditAmount);
          // Unlock any investments bought with reg-bonus only — now they've deposited real funds
          await unlockLockedCashback(userId);
        }
      } else if (isFailed) {
        const failReason =
          payload.transaction?.description ||
          payload.data?.transaction?.description ||
          payload.description || rawStatus || 'Payment declined';
        const batch = db.batch();
        batch.update(db.collection('pendingPayments').doc(reference), {
          status: 'failed', failReason, failedAt: FieldValue.serverTimestamp()
        });
        if (pending.depositId) {
          batch.update(db.collection('deposits').doc(pending.depositId), {
            status: 'failed', failReason
          });
        }
        await batch.commit();
        console.log(`❌ Deposit failed [${reference}]: ${failReason}`);
        await notify(userId, '❌ Deposit Failed',
          `Your deposit of ${fmtUGX(expectedAmount)} could not be processed.

Reason: ${failReason}

If any funds were deducted, they will be refunded within 24 hours. Reference: ${reference}`,
          'deposit_failed', { reference, amount: expectedAmount, failReason });
      }
    } catch (e) { console.error('❌ Callback error:', e.message, e.stack); }
  });
}

// Both routes point to the same handler
// /callback        — what server registers with Marzpay in /collect
// /deposit/callback — what user app's MARZ_CALLBACK_URL points to (backward compat)
app.post('/callback', handleDepositCallback);
app.post('/deposit/callback', handleDepositCallback);

// ════════════════════════════════════════════════════════════
// SMS-BASED DEPOSITS  (collect Mobile Money on your own SIM)
// Fully OPT-IN: inert unless SMS_DEPOSITS_ENABLED=true AND both
// SMS_WEBHOOK_SECRET (>=16 chars) and MOMO_RECEIVE_NUMBER are set.
// Runs alongside MarzPay without touching it. Withdrawals are NOT
// automated here — keep those manual via the admin panel.
// ════════════════════════════════════════════════════════════
const SMS_DEPOSITS_ENABLED = (process.env.SMS_DEPOSITS_ENABLED || 'false') === 'true';
const SMS_WEBHOOK_SECRET   = process.env.SMS_WEBHOOK_SECRET || '';
const MOMO_RECEIVE_NUMBER  = process.env.MOMO_RECEIVE_NUMBER || '';
const SMS_WINDOW_MS        = 30 * 60 * 1000;   // a pending SMS deposit stays valid 30 min
const SMS_SUFFIX_MAX       = 999;              // unique shilling tag added to the base amount

function smsConfigured() {
  return SMS_DEPOSITS_ENABLED && SMS_WEBHOOK_SECRET.length >= 16 && !!MOMO_RECEIVE_NUMBER;
}

// Parse an MTN / Airtel Uganda "you have received" SMS.
// Returns { amount, txId, sender, raw } or null if it isn't incoming money.
function parseMoMoSms(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ').trim();
  const isReceive  = /(received|you have received|received from|deposit of)/i.test(t);
  const isOutgoing = /(sent to|you have sent|withdrawn|paid to|airtime|bundle|data)/i.test(t);
  if (!isReceive || isOutgoing) return null;
  // Amount: "UGX 30,047" / "Ugx 30047" / "30,047 UGX"
  const m = t.match(/(?:ugx|ush|shs?)\s*([\d,]+(?:\.\d+)?)/i) ||
            t.match(/([\d,]+(?:\.\d+)?)\s*(?:ugx|ush|shs?)/i);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, ''));
  if (!amount || isNaN(amount)) return null;
  // Transaction id (for idempotency)
  let txId = '';
  const idm = t.match(/(?:txn\s*id|transaction\s*id|trans\.?\s*id|ref(?:erence)?|financial transaction id)[:\s#]*([A-Za-z0-9.\-]{6,})/i);
  if (idm) txId = idm[1].replace(/\.$/, '');
  // Sender phone (best effort)
  let sender = '';
  const sm = t.match(/from\s+([+]?\d[\d\s\-]{7,15})/i);
  if (sm) sender = sm[1].replace(/[\s\-]/g, '');
  return { amount, txId, sender, raw: t };
}

// Credit a matched SMS deposit using the SAME wallet logic as the MarzPay path.
async function creditSmsDeposit(pendingRef, pending, smsInfo) {
  const userId = pending.userId;
  const creditAmount = pending.baseAmount;     // credit the base; the tag shillings are a fee
  const { date, time } = nowStr();
  let done = false;
  await db.runTransaction(async (t) => {
    const fresh = await t.get(pendingRef);
    if (!fresh.exists || fresh.data().status === 'success') throw new Error('ALREADY_PROCESSED');
    const userRef = db.collection('users').doc(userId);
    const userSnap = await t.get(userRef);
    if (!userSnap.exists) throw new Error('User not found: ' + userId);
    t.update(userRef, {
      walletBalance: FieldValue.increment(creditAmount),
      depositBalance: FieldValue.increment(creditAmount),
      depositCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    if (pending.depositId) {
      t.update(db.collection('deposits').doc(pending.depositId), {
        status: 'success', amountCredited: creditAmount,
        smsTxId: smsInfo.txId || '', smsSender: smsInfo.sender || '',
        provider: 'Mobile Money (SIM)', paidAt: FieldValue.serverTimestamp()
      });
    }
    t.update(pendingRef, {
      status: 'success', amountCredited: creditAmount,
      smsTxId: smsInfo.txId || '', processedAt: FieldValue.serverTimestamp()
    });
    t.set(db.collection('transactions').doc(), {
      userId, type: 'deposit', description: 'Deposit via Mobile Money',
      amount: creditAmount, phone: smsInfo.sender || pending.phone || '',
      reference: pending.reference, provider: 'Mobile Money (SIM)',
      status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
    t.set(db.collection('notifications').doc(), {
      userId, title: '⚡ Funds Received!',
      message: `${fmtUGX(creditAmount)} has been credited to your wallet.\n\n📅 Date: ${date}\n⏰ Time: ${time}\n🔖 Reference: ${pending.reference}\n\nThank you for investing with X-Engine! ⚙️`,
      type: 'deposit', amount: creditAmount, reference: pending.reference,
      date, time, readBy: [], createdAt: FieldValue.serverTimestamp()
    });
    done = true;
  });
  if (done) {
    console.log(`✅ SMS deposit credited ${fmtUGX(creditAmount)} to ${userId}`);
    await checkAndPayReferral(userId, creditAmount);
    await unlockLockedCashback(userId);
  }
}

// 1. App asks for an SMS deposit → server returns a UNIQUE amount + the number.
app.post('/deposit/sms/init', verifyUser, async (req, res) => {
  if (!smsConfigured()) return res.status(503).json({ status: 'error', message: 'SMS deposits are not enabled.' });
  const { userId, amount, phone } = req.body;
  const base = parseFloat(amount);
  if (!userId || isNaN(base) || base < 30000 || base > 200000)
    return res.status(400).json({ status: 'error', message: 'Amount must be 30,000–200,000 UGX' });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const now = Date.now();
    // pick a tagged amount not currently used by another active pending SMS deposit
    let uniqueAmount = null;
    for (let i = 0; i < 25; i++) {
      const candidate = base + 1 + Math.floor(Math.random() * SMS_SUFFIX_MAX);
      const clash = await db.collection('pendingPayments').where('uniqueAmount', '==', candidate).limit(10).get();
      const active = clash.docs.some(d => { const x = d.data(); return x.status === 'pending' && (x.expiresAt || 0) > now; });
      if (!active) { uniqueAmount = candidate; break; }
    }
    if (!uniqueAmount) return res.status(503).json({ status: 'error', message: 'Too many pending deposits, please try again shortly.' });
    const reference = uuidv4();
    const depRef = db.collection('deposits').doc();
    const pendingRef = db.collection('pendingPayments').doc(reference);
    const expiresAt = now + SMS_WINDOW_MS;
    const batch = db.batch();
    batch.set(depRef, {
      userId, amount: base, phone: phone ? cleanPhone(phone) : '', reference,
      status: 'pending', type: 'sms_mobile_money', createdAt: FieldValue.serverTimestamp()
    });
    batch.set(pendingRef, {
      userId, method: 'sms', baseAmount: base, uniqueAmount,
      phone: phone ? cleanPhone(phone) : '', depositId: depRef.id,
      status: 'pending', expiresAt, createdAt: FieldValue.serverTimestamp()
    });
    await batch.commit();
    return res.json({
      status: 'success', reference, depositId: depRef.id,
      amountToSend: uniqueAmount, momoNumber: MOMO_RECEIVE_NUMBER, expiresAt,
      instructions: `Send EXACTLY ${fmtUGX(uniqueAmount)} to ${MOMO_RECEIVE_NUMBER}. The few extra shillings identify your payment — you are credited ${fmtUGX(base)}.`
    });
  } catch (e) {
    console.error('sms init error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// 2. The phone SMS-forwarder POSTs every incoming SMS here (shared-secret auth).
app.post('/sms/incoming', async (req, res) => {
  if (!smsConfigured()) return res.status(503).json({ status: 'error', message: 'disabled' });
  const provided = String(req.headers['x-sms-secret'] || (req.body && req.body.secret) || '');
  const expected = SMS_WEBHOOK_SECRET;
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return res.status(403).json({ status: 'error', message: 'Forbidden' });

  const text = (req.body && (req.body.message || req.body.text || req.body.sms || req.body.body)) || '';
  const info = parseMoMoSms(text);
  if (!info) return res.json({ status: 'ignored', reason: 'not an incoming-money SMS' });
  try {
    // idempotency: MoMo transaction id, or a hash of the raw text as fallback
    const tid = info.txId || crypto.createHash('sha256').update(info.raw).digest('hex').slice(0, 24);
    const seenRef = db.collection('smsTxns').doc(tid);
    if ((await seenRef.get()).exists) return res.json({ status: 'duplicate' });
    await seenRef.set({ amount: info.amount, sender: info.sender || '', raw: info.raw, at: FieldValue.serverTimestamp() });

    const now = Date.now();
    const snap = await db.collection('pendingPayments').where('uniqueAmount', '==', info.amount).limit(10).get();
    const match = snap.docs.find(d => { const x = d.data(); return x.method === 'sms' && x.status === 'pending' && (x.expiresAt || 0) > now; });
    if (!match) {
      await seenRef.update({ matched: false });
      console.warn(`⚠️ SMS deposit unmatched: ${fmtUGX(info.amount)} (no active request)`);
      return res.json({ status: 'unmatched', amount: info.amount });
    }
    await creditSmsDeposit(match.ref, match.data(), info);
    await seenRef.update({ matched: true, reference: match.data().reference });
    return res.json({ status: 'credited', reference: match.data().reference });
  } catch (e) {
    if (e.message === 'ALREADY_PROCESSED') return res.json({ status: 'duplicate' });
    console.error('sms incoming error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// REGISTRATION BONUS
// Called by frontend immediately after new user is created in Firestore
// ═══════════════════════════════════════════
// Internal: credit the welcome bonus + update L2/L3 counts. Idempotent.
async function creditRegistrationBonus(userId) {
  const userRef  = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { status: 'error', message: 'User not found' };
  const user = userSnap.data();

  if (user.regBonusPaid) return { status: 'already_paid', message: 'Registration bonus already credited' };

  const settSnap = await db.collection('settings').doc('main').get();
  const bonus = settSnap.exists ? (settSnap.data().registrationBonus || 50000) : 50000;
  const { date, time } = nowStr();

  let referralCode = user.referralCode;
  if (!referralCode) referralCode = await generateUniqueReferralCode(userId);

  try {
    await db.runTransaction(async (t) => {
      const freshSnap = await t.get(userRef);
      if (freshSnap.data().regBonusPaid) throw new Error('ALREADY_PAID');
      t.update(userRef, {
        walletBalance: FieldValue.increment(bonus),
        depositBalance: FieldValue.increment(bonus),
        regBonusPaid: true,
        regBonusPaidAt: FieldValue.serverTimestamp(),
        referralCode
      });
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId, type: 'registration_bonus',
        description: 'Welcome bonus — Thanks for joining X-Engine! 🌱',
        amount: bonus, status: 'success', date, time,
        createdAt: FieldValue.serverTimestamp()
      });
      const notifRef = db.collection('notifications').doc();
      t.set(notifRef, {
        userId,
        title: '🚀 Account Activated!',
        message: `Welcome to X-Engine! ⚙️\n\nYou've received a ${fmtUGX(bonus)} activation bonus as our gift to you!\n\n📅 Date: ${date}\n⏰ Time: ${time}\n\nStart investing and watch your money grow! 📈`,
        type: 'registration_bonus', amount: bonus, date, time,
        readBy: [], createdAt: FieldValue.serverTimestamp()
      });
    });
  } catch (e) {
    if (e.message === 'ALREADY_PAID') return { status: 'already_paid', message: 'Registration bonus already credited' };
    throw e;
  }

  console.log(`🎁 Registration bonus: ${fmtUGX(bonus)} → ${userId}`);

  // ── Update L2/L3 referral counts up the chain ──
  try {
    const l1Uid = user.referredBy;
    if (l1Uid) {
      const l1Snap = await db.collection('users').doc(l1Uid).get();
      const l2Uid = l1Snap.exists ? l1Snap.data().referredBy : null;
      if (l2Uid) {
        await db.collection('users').doc(l2Uid).update({ l2ReferralCount: FieldValue.increment(1) });
        const l2Snap = await db.collection('users').doc(l2Uid).get();
        const l3Uid = l2Snap.exists ? l2Snap.data().referredBy : null;
        if (l3Uid) await db.collection('users').doc(l3Uid).update({ l3ReferralCount: FieldValue.increment(1) });
      }
    }
  } catch (e2) { console.error('L2/L3 count error:', e2.message); }

  return { status: 'success', bonus, message: `${fmtUGX(bonus)} welcome bonus credited!` };
}

// ── Secure registration: client creates the Firebase Auth user, then calls this.
//    Server creates the user doc with VALIDATED zero balances, resolves the
//    referral code, creates the referral doc, and credits the welcome bonus.
//    No money fields ever touched by the client. ──
app.post('/register', verifyUser, async (req, res) => {
  const { userId, phone, referralCode } = req.body;
  if (!userId || !phone) return res.status(400).json({ status: 'error', message: 'userId and phone required' });
  try {
    const userRef  = db.collection('users').doc(userId);
    const existing = await userRef.get();
    if (existing.exists) {
      // Already created (idempotent retry) — just ensure bonus is credited
      await creditRegistrationBonus(userId).catch(() => {});
      return res.json({ status: 'success', message: 'Already registered' });
    }

    const formattedPhone = cleanPhone(phone);

    // Resolve referral code → referrer uid (server-side, trusted)
    let referredBy = '';
    const ref = String(referralCode || '').trim().toUpperCase();
    if (ref && ref.startsWith('XE-')) {
      const rSnap = await db.collection('users').where('referralCode', '==', ref).limit(1).get();
      if (!rSnap.empty && rSnap.docs[0].id !== userId) referredBy = rSnap.docs[0].id;
    }

    const myCode = 'XE-' + userId.slice(0, 6).toUpperCase();

    await userRef.set({
      phone: formattedPhone, name: formattedPhone, email: makeEmail(phone),
      depositBalance: 0, cumulativeBalance: 0, walletBalance: 0,
      totalWithdrawn: 0, totalInvested: 0, totalEarned: 0,
      referralBalance: 0, refEarned: 0,
      referralCode: myCode, referredBy,
      checkinStreak: 0, checkinDays: 0, checkinEarned: 0,
      depositCount: 0, withdrawalCount: 0,
      regBonusPaid: false,
      status: 'active', createdAt: FieldValue.serverTimestamp()
    });

    if (referredBy) {
      await db.collection('referrals').add({
        referrerId: referredBy, referredUserId: userId,
        referredName: formattedPhone, referredEmail: makeEmail(phone),
        referralCode: ref, paid: false, createdAt: FieldValue.serverTimestamp()
      });
    }

    await creditRegistrationBonus(userId);

    return res.json({ status: 'success', referralCode: myCode, message: 'Registered successfully' });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// Legacy endpoint kept for backward compatibility (old cached clients)
app.post('/register/bonus', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const result = await creditRegistrationBonus(userId);
    const code = result.status === 'error' ? 404 : 200;
    return res.status(code).json(result);
  } catch (e) {
    console.error('Register bonus error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// REFERRAL SYSTEM
// Level 1: UGX 20,000 flat when referred user makes FIRST deposit
// Level 2: UGX 2,000 flat on every SUBSEQUENT deposit by referred user
// Level 3: UGX 200 flat on every deposit by referred user's referral
// ═══════════════════════════════════════════
async function checkAndPayReferral(userId, depositAmount) {
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return;
    const user = userSnap.data();
    const referredBy = user.referredBy;
    if (!referredBy || referredBy === userId) return;

    const settSnap = await db.collection('settings').doc('main').get();
    const settings = settSnap.exists ? settSnap.data() : {};
    const firstDepBonus = settings.refL1 || 20000;
    const ongoingFlat   = settings.refL2 || 2000;
    const l3Flat        = settings.refL3 || 200;

    const { date, time } = nowStr();

    // ── Check referral doc state directly (no depositCount dependency) ──
    const unpaidSnap = await db.collection('referrals')
      .where('referredUserId', '==', userId)
      .where('paid', '==', false)
      .limit(1).get();

    if (!unpaidSnap.empty) {
      // ── L1: First-deposit flat bonus — referral exists but not yet paid ──
      const refDoc = unpaidSnap.docs[0];
      await db.runTransaction(async (t) => {
        const referrerRef  = db.collection('users').doc(referredBy);
        const referrerSnap = await t.get(referrerRef);
        if (!referrerSnap.exists) return;
        t.update(referrerRef, {
          walletBalance:     FieldValue.increment(firstDepBonus),
          cumulativeBalance: FieldValue.increment(firstDepBonus),
          referralBalance:   FieldValue.increment(firstDepBonus),
          referralCount:     FieldValue.increment(1),
          refEarned:         FieldValue.increment(firstDepBonus)
        });
        t.update(refDoc.ref, {
          paid: true, paidAt: FieldValue.serverTimestamp(), paidBonus: firstDepBonus
        });
        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: referredBy, type: 'referral',
          description: `Referral bonus — ${user.name || 'friend'} made first deposit!`,
          amount: firstDepBonus, status: 'success', date, time,
          referredUserId: userId, createdAt: FieldValue.serverTimestamp()
        });
        const notifRef = db.collection('notifications').doc();
        t.set(notifRef, {
          userId: referredBy,
          title: '🔗 Team Earnings!',
          message: `${user.name || 'Your referral'} just made their first deposit!\n\nYou earned ${fmtUGX(firstDepBonus)} team bonus. 💰\n\n📅 Date: ${date}\n⏰ Time: ${time}`,
          type: 'referral', amount: firstDepBonus, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`✅ Referral L1 paid: ${fmtUGX(firstDepBonus)} → ${referredBy} (triggered by ${userId})`);
      sendPush(referredBy, '🔗 Team Earnings!', `${user.name || 'Your referral'} made their first deposit — you earned ${fmtUGX(firstDepBonus)}! 💰`, { type: 'referral' });

      // ── Also pay L2 & L3 parents on this first deposit ──
      try {
        const l1Snap = await db.collection('users').doc(referredBy).get();
        const l2Uid  = l1Snap.exists ? l1Snap.data().referredBy : null;
        if (l2Uid && l2Uid !== referredBy) {
          await db.runTransaction(async (t) => {
            const l2Ref  = db.collection('users').doc(l2Uid);
            const l2Snap = await t.get(l2Ref);
            if (!l2Snap.exists) return;
            t.update(l2Ref, {
              walletBalance:     FieldValue.increment(ongoingFlat),
              cumulativeBalance: FieldValue.increment(ongoingFlat),
              referralBalance:   FieldValue.increment(ongoingFlat),
              refEarned:         FieldValue.increment(ongoingFlat)
            });
            const txRef = db.collection('transactions').doc();
            t.set(txRef, {
              userId: l2Uid, type: 'referral_l2',
              description: `L2 team bonus — ${user.name || 'network'} made first deposit`,
              amount: ongoingFlat, status: 'success', date, time,
              referredUserId: userId, createdAt: FieldValue.serverTimestamp()
            });
            const notifRef = db.collection('notifications').doc();
            t.set(notifRef, {
              userId: l2Uid, title: '🌐 L2 Team Bonus!',
              message: `Your Level 2 network is growing!\n\n${user.name || 'A member'} made their first deposit.\n\nYou earned ${fmtUGX(ongoingFlat)} 🎯\n\n📅 Date: ${date}\n⏰ Time: ${time}`,
              type: 'referral_l2', amount: ongoingFlat, date, time,
              readBy: [], createdAt: FieldValue.serverTimestamp()
            });
          });
          console.log(`✅ Referral L2 paid: ${fmtUGX(ongoingFlat)} → ${l2Uid}`);
          sendPush(l2Uid, '🌐 L2 Team Bonus!', `Your Level 2 network grew — you earned ${fmtUGX(ongoingFlat)}! 🎯`, { type: 'referral_l2' });

          const l2Doc  = await db.collection('users').doc(l2Uid).get();
          const l3Uid  = l2Doc.exists ? l2Doc.data().referredBy : null;
          if (l3Uid && l3Uid !== l2Uid) {
            await db.runTransaction(async (t) => {
              const l3Ref  = db.collection('users').doc(l3Uid);
              const l3Snap = await t.get(l3Ref);
              if (!l3Snap.exists) return;
              t.update(l3Ref, {
                walletBalance:     FieldValue.increment(l3Flat),
                cumulativeBalance: FieldValue.increment(l3Flat),
                referralBalance:   FieldValue.increment(l3Flat),
                refEarned:         FieldValue.increment(l3Flat)
              });
              const txRef = db.collection('transactions').doc();
              t.set(txRef, {
                userId: l3Uid, type: 'referral_l3',
                description: `L3 team bonus — ${user.name || 'network'} made first deposit`,
                amount: l3Flat, status: 'success', date, time,
                referredUserId: userId, createdAt: FieldValue.serverTimestamp()
              });
              const notifRef = db.collection('notifications').doc();
              t.set(notifRef, {
                userId: l3Uid, title: '🌍 L3 Team Bonus!',
                message: `Your Level 3 network is active!\n\n${user.name || 'A member'} made their first deposit.\n\nYou earned ${fmtUGX(l3Flat)} 🎯\n\n📅 Date: ${date}\n⏰ Time: ${time}`,
                type: 'referral_l3', amount: l3Flat, date, time,
                readBy: [], createdAt: FieldValue.serverTimestamp()
              });
            });
            console.log(`✅ Referral L3 paid: ${fmtUGX(l3Flat)} → ${l3Uid}`);
            sendPush(l3Uid, '💎 L3 Team Bonus!', `Your network is active — you earned ${fmtUGX(l3Flat)}! 🎯`, { type: 'referral_l3' });
          }
        }
      } catch (e2) { console.error('L2/L3 first-dep error:', e2.message); }
      return;
    }

    // ── L2: Ongoing % reward — L1 already paid, this is a subsequent deposit ──
    if (depositAmount > 0) {
      const paidSnap = await db.collection('referrals')
        .where('referredUserId', '==', userId)
        .where('paid', '==', true)
        .limit(1).get();
      if (paidSnap.empty) return;

      const reward = ongoingFlat;

      const refDoc = paidSnap.docs[0];
      await db.runTransaction(async (t) => {
        const referrerRef  = db.collection('users').doc(referredBy);
        const referrerSnap = await t.get(referrerRef);
        if (!referrerSnap.exists) return;
        t.update(referrerRef, {
          walletBalance:     FieldValue.increment(reward),
          cumulativeBalance: FieldValue.increment(reward),
          referralBalance:   FieldValue.increment(reward),
          refEarned:         FieldValue.increment(reward)
        });
        t.update(refDoc.ref, {
          ongoingEarned: FieldValue.increment(reward),
          lastRewardAt:  FieldValue.serverTimestamp()
        });
        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: referredBy, type: 'referral_ongoing',
          description: `Team bonus — ${user.name || 'referral'} deposited ${fmtUGX(depositAmount)}`,
          amount: reward, status: 'success', date, time,
          referredUserId: userId, depositAmount, createdAt: FieldValue.serverTimestamp()
        });
        const notifRef = db.collection('notifications').doc();
        t.set(notifRef, {
          userId: referredBy,
          title: '💎 Ongoing Team Bonus!',
          message: `${user.name || 'Your referral'} deposited ${fmtUGX(depositAmount)}!\n\nYou earned ${fmtUGX(reward)} team bonus 🎯\n\n📅 Date: ${date}\n⏰ Time: ${time}\n\nKeep sharing your link to earn more! ⚙️`,
          type: 'referral_ongoing', amount: reward, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`✅ Referral L2 paid: ${fmtUGX(reward)} (flat) → ${referredBy}`);
      sendPush(referredBy, '💎 Ongoing Team Bonus!', `${user.name || 'Your referral'} deposited — you earned ${fmtUGX(reward)}! 🎯`, { type: 'referral_ongoing' });

      // ── L3: Pay referrer's referrer a flat 200 bonus ──
      try {
        const referrerSnap2 = await db.collection('users').doc(referredBy).get();
        const referredBy2 = referrerSnap2.exists ? referrerSnap2.data().referredBy : null;
        if (referredBy2 && referredBy2 !== referredBy && referredBy2 !== userId) {
          await db.runTransaction(async (t) => {
            const l3Ref  = db.collection('users').doc(referredBy2);
            const l3Snap = await t.get(l3Ref);
            if (!l3Snap.exists) return;
            t.update(l3Ref, {
              walletBalance:     FieldValue.increment(l3Flat),
              cumulativeBalance: FieldValue.increment(l3Flat),
              referralBalance:   FieldValue.increment(l3Flat),
              refEarned:         FieldValue.increment(l3Flat)
            });
            const tx3Ref = db.collection('transactions').doc();
            t.set(tx3Ref, {
              userId: referredBy2, type: 'referral_l3',
              description: `L3 team bonus — ${user.name || 'network'} deposited`,
              amount: l3Flat, status: 'success', date, time,
              referredUserId: userId, createdAt: FieldValue.serverTimestamp()
            });
            const notifRef = db.collection('notifications').doc();
            t.set(notifRef, {
              userId: referredBy2,
              title: '💎 Ongoing Team Bonus!',
              message: `Your team network is active! You earned ${fmtUGX(l3Flat)} L3 bonus 🎯\n\n📅 Date: ${date}\n⏰ Time: ${time}`,
              type: 'referral_ongoing', amount: l3Flat, date, time,
              readBy: [], createdAt: FieldValue.serverTimestamp()
            });
          });
          console.log(`✅ Referral L3 paid: ${fmtUGX(l3Flat)} (flat) → ${referredBy2}`);
          sendPush(referredBy2, '💎 L3 Team Bonus!', `Your team network is active — you earned ${fmtUGX(l3Flat)}! 🎯`, { type: 'referral_l3' });
        }
      } catch (e) { console.error('L3 referral error:', e.message); }
    }
  } catch (e) { console.error('Referral error:', e.message); }
}

// ═══════════════════════════════════════════
// INVEST/NOTIFY — called by frontend the moment an investment
// is created. Triggers referral check so referrer is paid
// immediately when referred user invests (not on next deposit).
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// INVEST BUY — server-side atomic validation
// Prevents investing with reg bonus or negative depositBalance
// ═══════════════════════════════════════════
app.post('/invest/buy', verifyUser, async (req, res) => {
  const { userId, productId, qty } = req.body;
  if (!userId || !productId) return res.status(400).json({ status: 'error', message: 'userId and productId required' });
  const quantity = Math.min(Math.max(parseInt(qty)||1, 1), 3);
  try {
    const [userSnap, productSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('products').doc(productId).get()
    ]);
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (!productSnap.exists) return res.status(404).json({ status: 'error', message: 'Product not found' });
    const product = productSnap.data();
    const price   = product.price || 0;
    const total   = price * quantity;

    // Check max 3 per product
    const existingSnap = await db.collection('investments')
      .where('userId','==',userId)
      .where('productId','==',productId)
      .where('status','in',['active','matured'])
      .get();
    const existing = existingSnap.size;
    if (existing + quantity > 3)
      return res.status(400).json({ status: 'error', message: `You can own max 3 of this product. You have ${existing}.` });

    // Atomic transaction: validate depositBalance and deduct
    const createdIds = [];
    await db.runTransaction(async t => {
      const freshUser = (await t.get(db.collection('users').doc(userId))).data();
      const depBal    = freshUser.depositBalance || 0;
      if (depBal < total)
        throw new Error(`Insufficient Deposit Wallet balance. You have ${fmtUGX(depBal)}, need ${fmtUGX(total)}.`);

      t.update(db.collection('users').doc(userId), {
        walletBalance:  FieldValue.increment(-total),  // keep walletBalance = deposit + cumulative
        depositBalance: FieldValue.increment(-total),
        totalInvested:  FieldValue.increment(total)
      });

      const cycle    = product.cycle || product.term || 30;
      const dailyCb  = product.dailyCashback || Math.round((product.totalReturn - price) / cycle) || 0;
      const depositCount = freshUser.depositCount || 0;

      for (let i = 0; i < quantity; i++) {
        const startDate = new Date();
        const matDate   = new Date(startDate.getTime() + cycle * 86400000);
        const invRef    = db.collection('investments').doc();
        createdIds.push(invRef.id);
        t.set(invRef, {
          userId, productId, productName: product.name,
          productPhoto: product.photoUrl || product.photo || '',
          amount: price, cycle, dailyCashback: dailyCb,
          expectedReturn: product.totalReturn,
          status: 'active', quantity: 1,
          lockedCashback: (price <= 30000) && (depositCount === 0),
          startDate: startDate.toISOString(),
          maturityDate: matDate.toISOString(),
          createdAt: FieldValue.serverTimestamp()
        });
      }
    });

    return res.json({ status: 'success', message: `Bought ${quantity}x ${product.name}!`, investmentIds: createdIds });
  } catch (e) {
    console.error('invest/buy error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/invest/notify', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await checkAndPayReferral(userId, 0); // invest/notify: no deposit amount, just trigger L1 if needed
    return res.json({ status: 'success' });
  } catch (e) {
    console.error('invest/notify error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /check/:reference — poll deposit status (checks pendingPayments)
app.get('/check/:reference', async (req, res) => {
  try {
    const snap = await db.collection('pendingPayments').doc(req.params.reference).get();
    if (!snap.exists) return res.json({ status: 'not_found' });
    const d = snap.data();
    return res.json({
      status: d.status,
      amount: d.amount,
      amountCredited: d.amountCredited || 0,
      phone: d.phone,
      failReason: d.failReason || null
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════
app.post('/withdraw/request', verifyUser, async (req, res) => {
  const { userId, amount, phone, pin } = req.body;
  if (!userId || !amount || !phone || !pin)
    return res.status(400).json({ status: 'error', message: 'userId, amount, phone and PIN required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt > 500000)
    return res.status(400).json({ status: 'error', message: 'Amount must be ≤ 500,000 UGX' });
  const fullPhone = cleanPhone(phone);
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = userSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if (!user.withdrawalPin) return res.status(400).json({ status: 'error', message: 'No PIN set. Please set your withdrawal PIN first.', needsPin: true });

    // ── RATE LIMIT: max 1 withdrawal request per 2 minutes ──
    const lastReqAt = user.lastWithdrawalRequestAt?.toDate?.() || null;
    if (lastReqAt && (Date.now() - lastReqAt.getTime()) < 2 * 60 * 1000) {
      const secLeft = Math.ceil((2 * 60 * 1000 - (Date.now() - lastReqAt.getTime())) / 1000);
      return res.status(429).json({ status: 'error', message: `Please wait ${secLeft} seconds before making another withdrawal request.` });
    }

    // ── PHONE VERIFICATION: must match registered profile phone or an activated bank account ──
    const userProfilePhone = cleanPhone(user.phone || '');
    const bankSnap = await db.collection('bankAccounts')
      .where('userId', '==', userId)
      .where('status', '==', 'activated')
      .get();
    const allowedPhones = [userProfilePhone, ...bankSnap.docs.map(d => cleanPhone(d.data().phone || ''))].filter(Boolean);
    if (!allowedPhones.includes(fullPhone)) {
      return res.status(400).json({ status: 'error', message: 'Withdrawal phone must be your registered profile number or an activated bank account. Please bind and activate your account first.' });
    }
    // ── PER-POT MINIMUM ENFORCEMENT ─────────────────────────────────────────────
    // Two SEPARATE withdrawable pools:
    //   referralBalance  (referral bonuses)        → min UGX 10,000, max = referralBalance
    //   cashbackBalance  (daily investment returns) → min UGX 60,000, max = cumulativeBalance - referralBalance
    // A single withdrawal may combine both pools only if BOTH minimums are already met.
    const currentRefBal  = user.referralBalance  || 0;
    const currentCumBal  = user.cumulativeBalance || 0;
    const cashbackBal    = Math.max(0, currentCumBal - currentRefBal);

    // Pool rules — amount minimum applies per pool used:
    //   referral:   refBal >= 10k AND amount >= 10k AND amount <= refBal
    //   cashback:   cashback >= 60k AND amount >= 60k AND amount <= cashback
    //   combined:   both pools unlocked, any amount >= 10k up to total (referral exhausted first)
    const canUseReferral = currentRefBal >= 10000 && amt >= 10000 && amt <= currentRefBal;
    const canUseCashback = cashbackBal   >= 60000 && amt >= 60000 && amt <= cashbackBal;
    const canUseBoth     = currentRefBal >= 10000 && cashbackBal >= 60000 && amt >= 10000 && amt <= (currentRefBal + cashbackBal);

    if (!canUseReferral && !canUseCashback && !canUseBoth) {
      let msg;
      const refOk  = currentRefBal >= 10000;
      const cashOk = cashbackBal   >= 60000;
      if (!refOk && !cashOk)
        msg = `Referral: ${fmtUGX(currentRefBal)} (need UGX 10,000) | Daily cashback: ${fmtUGX(cashbackBal)} (need UGX 60,000). Keep earning!`;
      else if (refOk && !cashOk && amt < 10000)
        msg = `Minimum referral withdrawal is UGX 10,000. Your referral balance: ${fmtUGX(currentRefBal)}.`;
      else if (refOk && !cashOk && amt > currentRefBal)
        msg = `Amount ${fmtUGX(amt)} exceeds referral balance (${fmtUGX(currentRefBal)}). Daily cashback ${fmtUGX(cashbackBal)} is locked — needs UGX 60,000 minimum.`;
      else if (refOk && !cashOk)
        msg = `Daily cashback ${fmtUGX(cashbackBal)} is locked. Minimum UGX 60,000 required. Withdraw up to ${fmtUGX(currentRefBal)} from your referral balance instead.`;
      else if (!refOk && cashOk && amt < 60000)
        msg = `Minimum daily cashback withdrawal is UGX 60,000. Your cashback: ${fmtUGX(cashbackBal)}.`;
      else if (!refOk && cashOk && amt > cashbackBal)
        msg = `Insufficient cashback balance. Available: ${fmtUGX(cashbackBal)}.`;
      else if (refOk && cashOk && amt < 10000)
        msg = `Minimum withdrawal is UGX 10,000.`;
      else if (refOk && cashOk && amt > (currentRefBal + cashbackBal))
        msg = `Amount exceeds total balance. Max: ${fmtUGX(currentRefBal + cashbackBal)}.`;
      else
        msg = `Insufficient withdrawable balance. Referral: ${fmtUGX(currentRefBal)} | Cashback: ${fmtUGX(cashbackBal)}.`;
      return res.status(400).json({ status: 'error', message: msg });
    }

    // ── BRUTE-FORCE PIN PROTECTION ── 10 attempts → 1-hour lock
    const MAX_PIN_ATTEMPTS = 10;
    const LOCK_DURATION_MS  = 60 * 60 * 1000; // 1 hour
    const pinAttempts = user.pinAttempts || 0;
    const pinLockUntil = user.pinLockUntil?.toDate?.() || null;

    if (pinLockUntil && pinLockUntil > new Date()) {
      const mins = Math.ceil((pinLockUntil - new Date()) / 60000);
      return res.status(429).json({
        status: 'error',
        message: `Account locked after ${MAX_PIN_ATTEMPTS} wrong PIN attempts. Try again in ${mins} minute(s).`,
        lockedMins: mins
      });
    }

    if (user.withdrawalPin !== hashPin(pin)) {
      const newAttempts = pinAttempts + 1;
      const remaining   = MAX_PIN_ATTEMPTS - newAttempts;
      const update      = { pinAttempts: newAttempts };
      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        update.pinLockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        update.pinAttempts  = 0; // reset counter so next window starts fresh
        await db.collection('users').doc(userId).update(update);
        await notify(userId,
          '🔒 Withdrawal PIN Locked',
          `Your withdrawal PIN has been locked for 1 hour after ${MAX_PIN_ATTEMPTS} failed attempts.\n\nIf this was not you, please contact support immediately.`,
          'warning', { date: nowStr().date, time: nowStr().time });
        return res.status(429).json({
          status: 'error',
          message: `Too many wrong PIN attempts. Your account is locked for 1 hour.`,
          lockedMins: 60
        });
      }
      await db.collection('users').doc(userId).update(update);
      return res.status(400).json({
        status: 'error',
        message: `Incorrect PIN. ${remaining} attempt(s) remaining before account is locked.`,
        attemptsLeft: remaining
      });
    }

    // PIN correct — clear any leftover attempt counters
    if (pinAttempts > 0 || pinLockUntil) {
      await db.collection('users').doc(userId).update({ pinAttempts: 0, pinLockUntil: null });
    }

    // cumBal already validated per-pool above; final balance guard uses the combined total
    const cumBal = currentCumBal;
    const refBal = user.refEarned || 0;
    const balance = cumBal;
    if (balance < amt) return res.status(400).json({ status: 'error', message: 'Insufficient withdrawable balance. Available: ' + fmtUGX(cumBal) });

    // ── RULE: deposited funds cannot be withdrawn directly ──────────────
    const investedTotal  = user.totalInvested  || 0;
    const withdrawnTotal = user.totalWithdrawn || 0;
    // Allow if user has invested OR has earned balance in cumulative wallet
    const hasInvested = investedTotal > 0 || cumBal > 0 || refBal > 0;
    if (!hasInvested)
      return res.status(400).json({ status: 'error', message: 'You must invest your deposited funds before withdrawing. Go to Products → choose a plan → invest → wait for maturity → claim → then withdraw.' });

    // ── RULE: claimed/returned earnings cannot be re-invested ───────────
    // totalEarned = sum of all claimed investment returns credited to wallet.
    // Those funds must be WITHDRAWN, not re-invested.
    // We record this on each withdrawal so admin can see the breakdown.
    const totalEarned     = user.totalEarned    || 0;
    const claimedInWallet = Math.max(0, totalEarned - withdrawnTotal);
    const pureBalance     = Math.max(0, balance - claimedInWallet);

    const isTop = user.isTopInvestor || false;
    req._refIdsToExpire = [];

    const witCount  = user.withdrawalCount || 0;
    const witSettSnap = await db.collection('settings').doc('main').get();
    const witFeePct = witSettSnap.exists ? (witSettSnap.data().withdrawalFee || 11) : 11;
    const fee       = Math.round(amt * witFeePct / 100);
    const netAmount = amt - fee;
    const reference = uuidv4();

    const conditionsMet    = true;
    const conditionsDetail = {
      hasInvested,
      totalInvested:         investedTotal,
      totalWithdrawn:        withdrawnTotal,
      totalEarned,
      claimedInWallet,
      pureBalance,
      walletBalance:         balance,
      weekdayOk:             true,
      timeOk:                true,
      pinOk:                 true,
      balanceOk:             true,
      isTopInvestor:         isTop,
      withdrawalPhoneVerified: true,   // phone matched registered account
      noReinvestViolation: claimedInWallet === 0 ? 'clean' : `UGX ${fmtUGX(claimedInWallet)} claimed returns present (withdrawn, not reinvested ✅)`
    };
    let witId;
    let cumPortion = 0, refPortion = 0;
    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(userId);
      const freshSnap = await t.get(userRef);
      const freshData = freshSnap.data();
      const freshBal    = freshData.walletBalance || 0;
      const freshCum    = freshData.cumulativeBalance || 0;
      const freshRefBal = freshData.referralBalance || 0;
      if (freshCum < amt) throw new Error(`Insufficient balance: ${fmtUGX(freshCum)}`);
      // Route deduction to the correct pool(s):
      // referral pot: amt <= freshRefBal → pure referral
      // cashback pot: amt <= (freshCum - freshRefBal) → pure cashback (no touch to referralBalance)
      // both: use referral first, cashback covers the remainder
      const freshCashback = Math.max(0, freshCum - freshRefBal);
      cumPortion = amt;
      const pureRef  = freshRefBal >= 10000 && amt >= 10000 && amt <= freshRefBal;
      const pureCash = freshCashback >= 60000 && amt >= 60000 && amt <= freshCashback;
      if (pureRef) {
        refPortion = amt;             // all from referral
      } else if (pureCash) {
        refPortion = 0;               // all from cashback, don't touch referral
      } else {
        refPortion = freshRefBal;     // combined: drain referral first, rest from cashback
      }
      const balUpdates = {
        walletBalance:     FieldValue.increment(-amt),
        cumulativeBalance: FieldValue.increment(-amt),
        referralBalance:   FieldValue.increment(-refPortion),
        withdrawalCount:   FieldValue.increment(1),
        lastWithdrawalRequestAt: FieldValue.serverTimestamp()
      };
      t.update(userRef, balUpdates);
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      const { date, time } = nowStr();
      t.set(witRef, {
        userId, userName: user.name || '', userPhone: user.phone || '',
        withdrawalPhone: fullPhone, amount: amt, fee, netAmount, reference,
        status: 'pending', withdrawalCount: witCount + 1,
        isTopInvestor: isTop,
        cumPortion, refPortion,   // ← balance breakdown for accurate refund if failed
        conditionsMet,
        conditionsDetail,
        date, time,
        createdAt: FieldValue.serverTimestamp()
      });
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId, type: 'withdrawal',
        description: 'Withdrawal request (pending admin approval)',
        amount: -amt, fee, netAmount, reference, phone: fullPhone,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`📋 Withdrawal ${witId} created — auto-processing via MarzPay…`);

    // Auto-process: send to MarzPay immediately (no admin approval needed)
    const witObj = {
      userId, userName: user.name || '', userPhone: user.phone || '',
      withdrawalPhone: fullPhone, amount: amt, fee, netAmount, reference
    };
    let marzData;
    try {
      marzData = await marzSendMoney({
        amount: netAmount, phone: fullPhone,
        reference,
        description: `X-Engine Withdrawal — ${user.name || 'user'}`,
        callbackUrl: `${RAILWAY_URL}/withdraw/callback`
      });
    } catch (marzErr) {
      const errMsg = marzErr.response?.data?.message || marzErr.message;
      console.error('❌ MarzPay send-money error:', errMsg);
      await processWithdrawalFailure(witId, witObj, 'MarzPay: ' + errMsg);
      return res.status(502).json({ status: 'error', message: 'Payment provider error: ' + errMsg });
    }

    const marzStatus = (marzData?.data?.transaction?.status || marzData?.status || '').toLowerCase();
    const marzTxUuid = marzData?.data?.transaction?.uuid || '';
    const isInstantSuccess = ['success', 'successful', 'completed'].includes(marzStatus);
    const isProcessing = ['processing', 'pending', 'queued'].includes(marzStatus) || marzTxUuid;

    if (!isInstantSuccess && !isProcessing) {
      await processWithdrawalFailure(witId, witObj, 'MarzPay declined: ' + (marzStatus || 'unknown'));
      return res.json({ status: 'failed', message: 'Payment provider declined the request.', marz: marzData });
    }
    if (isInstantSuccess) {
      await processWithdrawalSuccess(witId, witObj, marzData);
      return res.json({ status: 'success', withdrawalId: witId, reference, netAmount, fee, message: 'Withdrawal processed successfully! 💰' });
    }
    // Still processing — update doc, notify user, wait for callback
    await db.collection('withdrawals').doc(witId).update({
      status: 'processing', marzTxUuid, processedAt: FieldValue.serverTimestamp()
    });
    const { date: d2, time: t2 } = nowStr();
    await notify(userId, '⏳ Withdrawal Processing',
      `Your withdrawal of ${fmtUGX(amt)} has been submitted and is processing.\n\n` +
      `💰 You'll receive ${fmtUGX(netAmount)}${fee > 0 ? ` (fee: ${fmtUGX(fee)})` : ''}\n` +
      `📞 Phone: ${fullPhone}\n🔖 Ref: ${reference}\n📅 ${d2} ⏰ ${t2}\n\n` +
      `We'll notify you once MarzPay confirms delivery.`,
      'info', { amount: amt, netAmount, fee, reference, phone: fullPhone, date: d2, time: t2 });
    return res.json({ status: 'success', withdrawalId: witId, reference, netAmount, fee, message: 'Withdrawal submitted — processing now! ⏳' });
  } catch (e) {
    console.error('Withdrawal request error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// POST /withdraw/approve — Admin approves → server sends via Marzpay → callback notifies user
app.post('/withdraw/approve', async (req, res) => {
  const { withdrawalId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();
    if (wit.status !== 'pending')
      return res.status(400).json({ status: 'error', message: `Already ${wit.status}` });
    await db.collection('withdrawals').doc(withdrawalId).update({
      status: 'processing', approvedAt: FieldValue.serverTimestamp()
    });
    let marzData;
    try {
      marzData = await marzSendMoney({
        amount: wit.netAmount, phone: wit.withdrawalPhone,
        reference: wit.reference,
        description: `X-Engine Withdrawal — ${wit.userName || 'user'}`,
        callbackUrl: `${RAILWAY_URL}/withdraw/callback`
      });
    } catch (marzErr) {
      const errMsg = marzErr.response?.data?.message || marzErr.message;
      console.error('❌ Marzipay send-money error:', errMsg);
      await processWithdrawalFailure(withdrawalId, wit, 'Marzipay: ' + errMsg);
      return res.status(502).json({ status: 'error', message: errMsg });
    }
    const marzStatus = (marzData?.data?.transaction?.status || marzData?.status || '').toLowerCase();
    const marzTxUuid = marzData?.data?.transaction?.uuid || '';
    const isInstantSuccess = ['success', 'successful', 'completed'].includes(marzStatus);
    const isProcessing = ['processing', 'pending', 'queued'].includes(marzStatus) || marzTxUuid;
    const isDeclined = !isInstantSuccess && !isProcessing;

    if (isDeclined) {
      await processWithdrawalFailure(withdrawalId, wit, 'Marzipay declined: ' + (marzStatus || 'unknown'));
      return res.json({ status: 'failed', message: 'Marzipay declined', marz: marzData });
    }

    if (isInstantSuccess) {
      // MarzPay confirmed success immediately
      await processWithdrawalSuccess(withdrawalId, wit, marzData);
      return res.json({ status: 'success', message: 'Payout sent', marz: marzData });
    }

    // MarzPay accepted and is processing — keep status as 'processing',
    // wait for /withdraw/callback to confirm final result
    const { date, time } = nowStr();
    await db.collection('withdrawals').doc(withdrawalId).update({
      status: 'processing', marzTxId: marzTxUuid, approvedAt: FieldValue.serverTimestamp()
    });
    const txSnap2 = await db.collection('transactions')
      .where('reference', '==', wit.reference).limit(1).get();
    if (!txSnap2.empty) txSnap2.docs[0].ref.update({ status: 'processing', date, time });
    const feeNote = wit.fee > 0 ? `\n💸 Fee: ${fmtUGX(wit.fee)}` : '';
    await notify(
      wit.userId,
      '⏳ Withdrawal Processing',
      `Your withdrawal of ${fmtUGX(wit.netAmount)} has been approved and is being sent to ${wit.withdrawalPhone}.\n\n📅 Date: ${date}\n⏰ Time: ${time}\n📱 Phone: ${wit.withdrawalPhone}\n💰 Amount: ${fmtUGX(wit.netAmount)}${feeNote}\n🔖 Ref: ${wit.reference}\n\nYou will receive a confirmation once funds are delivered. 🌱`,
      'withdrawal',
      { amount: wit.netAmount, fee: wit.fee, phone: wit.withdrawalPhone, reference: wit.reference, date, time }
    );
    return res.json({ status: 'success', message: 'Payout processing', marz: marzData });
  } catch (e) {
    console.error('Approve error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

async function processWithdrawalSuccess(witId, wit, marzData) {
  const { date, time } = nowStr();

  // marzData shape differs: immediate /approve response uses .data.transaction.uuid
  // but /withdraw/callback payload uses .transaction.uuid directly
  const marzTxId =
    marzData?.transaction?.uuid ||           // ← callback format
    marzData?.data?.transaction?.uuid ||     // ← immediate approve response
    '';

  // Recipient name: MarzPay confirms the actual account name in the callback
  const recipientName =
    marzData?.transaction?.recipient_name ||
    marzData?.disbursement?.recipient_name ||
    wit.userName || 'Customer';

  await db.collection('withdrawals').doc(witId).update({
    status: 'processed',
    marzTxId,
    recipientName,
    processedAt: FieldValue.serverTimestamp()
  });
  // Track totalWithdrawn for invest-before-withdraw rule + accumulate fee revenue
  const updates = { totalWithdrawn: FieldValue.increment(wit.amount) };
  await db.collection('users').doc(wit.userId).update(updates);
  if (wit.fee > 0) {
    await db.collection('settings').doc('stats').set({
      totalFeesCollected: FieldValue.increment(wit.fee),
      lastFeeAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  const txSnap = await db.collection('transactions')
    .where('reference', '==', wit.reference).limit(1).get();
  if (!txSnap.empty) txSnap.docs[0].ref.update({
    status: 'success',
    description: `Withdrawal successful — sent to ${wit.withdrawalPhone}`,
    date, time
  });

  const feeNote = wit.fee > 0 ? `\n💸 Fee deducted: ${fmtUGX(wit.fee)}` : '';
  await notify(
    wit.userId,
    '🏦 Payout Confirmed!',
    `🎉 Your withdrawal has been processed successfully!\n\n` +
    `👤 Account Name: ${recipientName}\n` +
    `📱 Phone: ${wit.withdrawalPhone}\n` +
    `💰 Amount Sent: ${fmtUGX(wit.netAmount)}${feeNote}\n` +
    `📅 Date: ${date}\n` +
    `⏰ Time: ${time}\n` +
    `🔖 Reference: ${wit.reference}\n\n` +
    `Thank you for investing with X-Engine! ⚙️\n` +
    `We appreciate your trust and continued support. 😊`,
    'withdrawal',
    { amount: wit.netAmount, fee: wit.fee, phone: wit.withdrawalPhone, reference: wit.reference, date, time, recipientName }
  );
}

async function processWithdrawalFailure(witId, wit, reason) {
  await db.collection('withdrawals').doc(witId).update({
    status: 'failed', failReason: reason, failedAt: FieldValue.serverTimestamp()
  });
  // Refund exactly what was deducted from each sub-balance
  const refundUpdates = {
    walletBalance: FieldValue.increment(wit.amount),
    withdrawalCount: FieldValue.increment(-1)
  };
  const cp = wit.cumPortion ?? wit.amount; // backward-compat: old docs without split
  const rp = wit.refPortion ?? 0;
  if (cp > 0) refundUpdates.cumulativeBalance = FieldValue.increment(cp);
  if (rp > 0) refundUpdates.refEarned = FieldValue.increment(rp);
  await db.collection('users').doc(wit.userId).update(refundUpdates);
  const txSnap = await db.collection('transactions')
    .where('reference', '==', wit.reference).limit(1).get();
  if (!txSnap.empty) txSnap.docs[0].ref.update({ status: 'failed' });
  await notify(
    wit.userId, '❌ Payout Failed',
    'Your withdrawal of ' + fmtUGX(wit.amount) + ' could not be processed. ' + fmtUGX(wit.amount) + ' has been refunded to your wallet.\n\nReason: ' + reason,
    'withdrawal_failed',
    { amount: wit.amount, reference: wit.reference }
  );
}

// POST /withdraw/callback — Marzipay disbursement webhook
app.post('/withdraw/callback', async (req, res) => {
  console.log('💸 Withdrawal callback:', JSON.stringify(req.body));
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      const payload = req.body;
      console.log('💸 Withdrawal callback parsed:', JSON.stringify(payload).slice(0, 300));
      // MarzPay disbursement webhooks put OUR custom reference in provider_reference,
      // while transaction.reference holds MarzPay's own internal UUID.
      const reference =
        payload.reference ||
        payload.transaction?.provider_reference ||  // ← OUR ref in disbursement callbacks
        payload.transaction?.reference ||            // fallback
        payload.data?.transaction?.reference ||
        payload.merchant_reference;
      const rawStatus = (() => {
        const s = (
          payload.status ||
          payload.transaction?.status ||            // ← actual MarzPay structure
          payload.data?.transaction?.status || ''
        ).toLowerCase();
        if (s) return s;
        // MarzPay disbursement event types (from docs)
        if (payload.event_type === 'disbursement.completed') return 'completed';
        if (payload.event_type === 'disbursement.failed')    return 'failed';
        if (payload.event_type === 'disbursement.cancelled') return 'cancelled';
        return '';
      })();
      if (!reference) { console.log('❌ No reference in withdrawal callback'); return; }
      const witSnap = await db.collection('withdrawals')
        .where('reference', '==', reference).limit(1).get();
      if (witSnap.empty) { console.log('❌ No withdrawal for ref:', reference); return; }
      const witDoc = witSnap.docs[0];
      const wit = witDoc.data();
      // ── ANTI-FRAUD: verify the claimed status with MarzPay before acting.
      // A forged "failed" callback would otherwise refund a withdrawal whose
      // money was actually sent (refund + cash = double payout).
      const realStatus = wit.marzTxId ? await marzVerifyStatus(wit.marzTxId) : '';
      if (['success', 'successful', 'completed'].includes(rawStatus) && wit.status !== 'processed') {
        if (realStatus && !['completed', 'successful', 'success'].includes(realStatus)) {
          console.warn(`🚨 FRAUD BLOCK: callback claims success but MarzPay says '${realStatus}' for ${reference}`);
          return;
        }
        console.log(`✅ Withdrawal confirmed: ${reference}`);
        await processWithdrawalSuccess(witDoc.id, wit, payload);
      }
      if (['failed', 'declined', 'cancelled', 'error'].includes(rawStatus) && !['failed', 'processed'].includes(wit.status)) {
        if (realStatus && !['failed', 'declined', 'cancelled', 'error'].includes(realStatus)) {
          console.warn(`🚨 FRAUD BLOCK: callback claims failure but MarzPay says '${realStatus}' for ${reference} — NOT refunding`);
          return;
        }
        const failReason = payload.transaction?.description || payload.description || rawStatus || 'Provider declined';
        console.log(`❌ Withdrawal failed: ${reference} — ${failReason}`);
        await processWithdrawalFailure(witDoc.id, wit, failReason);
      }
    } catch (e) { console.error('Withdrawal callback error:', e.message); }
  });
});

// GET /withdraw/status/:id
app.get('/withdraw/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('withdrawals').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error' });
    const wit = snap.data();
    // witStatus is the withdrawal doc status (pending/processing/processed/failed)
    return res.json({ status: 'success', witStatus: wit.status, data: { id: snap.id, ...wit } });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════
app.post('/admin/verify', async (req, res) => {
  const { uid, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.json({ isAdmin: false });
  try {
    const snap = await db.collection('admins').doc(uid).get();
    return res.json({ isAdmin: snap.exists && snap.data()?.active !== false });
  } catch (e) { return res.json({ isAdmin: false }); }
});

app.post('/admin/deposit', async (req, res) => {
  const { userId, amount, note, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId || !amount) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  const amt = parseFloat(amount);
  try {
    const { wallet } = req.body; // 'cumulativeBalance' or 'depositBalance'
    const targetWallet = wallet === 'cumulativeBalance' ? 'cumulativeBalance' : 'depositBalance';
    const { date, time } = nowStr();
    await db.runTransaction(async (t) => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      const updateFields = {
        walletBalance: FieldValue.increment(amt),
        updatedAt: FieldValue.serverTimestamp()
      };
      // Always update the target wallet field
      updateFields[targetWallet] = FieldValue.increment(amt);
      // If depositing to depositBalance, also increment depositCount (triggers referral)
      if (targetWallet === 'depositBalance') {
        updateFields.depositCount = FieldValue.increment(1);
      }
      t.update(uRef, updateFields);
      const depRef = db.collection('deposits').doc();
      t.set(depRef, {
        userId, amount: amt, phone: 'admin', status: 'success',
        note: note || 'Admin top-up', createdBy: 'admin',
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId, type: 'admin_deposit', description: note || 'Admin top-up',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    // Trigger referral check + unlock if depositing to deposits wallet
    if (targetWallet === 'depositBalance') {
      try { await checkAndPayReferral(userId, amt); } catch(e) { console.log('Ref check:', e.message); }
      try { await unlockLockedCashback(userId); } catch(e) { console.log('Unlock:', e.message); }
    }
    await notify(userId, '💰 Funds Added',
      `${fmtUGX(amt)} added to your ${targetWallet==='cumulativeBalance'?'Cumulative':'Deposits'} Wallet.\n\n📅 ${date}\n⏰ ${time}\n📝 ${note || 'Admin top-up'}`,
      'deposit', { amount: amt });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(amt)} to ${targetWallet}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Investment maturity auto-check
app.post('/admin/check-maturities', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error' });
  try {
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    let count = 0;
    for (const docSnap of snap.docs) {
      const inv = docSnap.data();
      const matDate = inv.maturityDate;
      if (matDate && matDate.toDate() <= now.toDate()) {
        await docSnap.ref.update({ status: 'matured', maturedAt: FieldValue.serverTimestamp() });
        await notify(inv.userId, '🎉 Investment Matured!',
          `Your ${inv.productName} investment is ready to claim!\n\n💰 Claim: ${fmtUGX(inv.expectedReturn)}\n📅 Matured: ${new Date().toLocaleDateString()}`,
          'investment', { amount: inv.expectedReturn, investmentId: docSnap.id });
        count++;
      }
    }
    return res.json({ status: 'success', matured: count });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — REJECT WITHDRAWAL (refunds wallet)
// ═══════════════════════════════════════════
app.post('/withdraw/reject', async (req, res) => {
  const { withdrawalId, adminKey, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();
    if (['processed','failed'].includes(wit.status))
      return res.status(400).json({ status: 'error', message: 'Already ' + wit.status + ' — cannot reject' });
    const rejectReason = reason || 'Rejected by admin';
    await processWithdrawalFailure(withdrawalId, wit, rejectReason);
    console.log('🚫 Withdrawal rejected: ' + withdrawalId + ' — ' + rejectReason);
    return res.json({ status: 'success', message: 'Rejected and ' + fmtUGX(wit.amount) + ' refunded to user' });
  } catch (e) {
    console.error('Reject error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — BAN / UNBAN USER
// ═══════════════════════════════════════════
app.post('/admin/ban', async (req, res) => {
  const { userId, adminKey, action, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId || !action) return res.status(400).json({ status: 'error', message: 'userId and action (ban|unban) required' });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const isBan = action === 'ban';
    // Disable/enable Firebase Auth account so login is blocked at the Auth level
    await admin.auth().updateUser(userId, { disabled: isBan });
    await db.collection('users').doc(userId).update({
      status: isBan ? 'banned' : 'active',
      banReason: isBan ? (reason || 'Banned by admin') : null,
      bannedAt: isBan ? FieldValue.serverTimestamp() : null
    });
    if (isBan) {
      await notify(userId, '🚫 Account Suspended',
        'Your X-Engine account has been suspended.\n\nReason: ' + (reason || 'Policy violation') + '\n\nContact support if you believe this is an error.',
        'warning', {});
    } else {
      await notify(userId, '✅ Account Restored',
        'Your X-Engine account has been restored. You can now access all features.',
        'info', {});
    }
    return res.json({ status: 'success', message: 'User ' + (isBan ? 'banned' : 'unbanned') + ' successfully' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});


// ── ADMIN: Reset user login password ──
app.post('/admin/reset-password', async (req, res) => {
  const { userId, newPassword, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId || !newPassword || newPassword.length < 6)
    return res.status(400).json({ status: 'error', message: 'userId and newPassword (min 6 chars) required' });
  try {
    await admin.auth().updateUser(userId, { password: newPassword });
    await db.collection('users').doc(userId).update({
      tempPassword: newPassword,
      tempPasswordSetAt: FieldValue.serverTimestamp()
    });
    await db.collection('notifications').add({
      userId, title: '🔐 Password Reset',
      message: `Your login password has been reset by admin.\n\nYour new password is: ${newPassword}\n\nOpen the app → Profile → Change Password to view it. Change it after logging in.`,
      type: 'system', readBy: [], createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', message: 'Password reset successfully' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ADMIN: Reset user withdrawal PIN ──
app.post('/admin/reset-pin', async (req, res) => {
  const { userId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const updateData = { pinAttempts: 0, pinLockUntil: null, pinResetByAdmin: true, pinResetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    updateData.withdrawalPin = FieldValue.delete();
    await db.collection('users').doc(userId).update(updateData);
    await db.collection('notifications').add({
      userId, title: '🔓 Withdrawal PIN Reset',
      message: 'Your withdrawal PIN has been reset by admin. Set a new PIN before withdrawing.',
      readBy: [], createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', message: 'PIN reset — user must set new PIN' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ADMIN: Unlock PIN (reset attempts) ──
app.post('/admin/unlock-pin', async (req, res) => {
  const { userId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    await db.collection('users').doc(userId).update({ pinAttempts: 0, pinLockUntil: null, updatedAt: FieldValue.serverTimestamp() });
    return res.json({ status: 'success', message: 'PIN unlocked — attempts reset to 0' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENT CLAIM (server-side atomic)
// ═══════════════════════════════════════════
app.post('/invest/claim', verifyUser, async (req, res) => {
  const { userId, investmentId } = req.body;
  if (!userId || !investmentId)
    return res.status(400).json({ status: 'error', message: 'userId and investmentId required' });
  try {
    const invRef  = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ status: 'error', message: 'Investment not found' });
    const inv = invSnap.data();
    if (inv.userId !== userId)
      return res.status(403).json({ status: 'error', message: 'Not your investment' });
    if (inv.status !== 'matured')
      return res.status(400).json({ status: 'error', message: 'Cannot claim — status is ' + inv.status });
    const isLocked = inv.lockedCashback === true;
    const payout = isLocked ? (inv.pendingCashback || inv.expectedReturn || 0) : (inv.expectedReturn || 0);
    const { date, time } = nowStr();
    await db.runTransaction(async (t) => {
      // Re-read investment inside the transaction — blocks concurrent
      // double-claims that both passed the outer 'matured' check
      const freshInv = await t.get(invRef);
      if (!freshInv.exists || freshInv.data().status !== 'matured')
        throw new Error('Already claimed or not matured');
      const userRef  = db.collection('users').doc(userId);
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found');
      if (userSnap.data().status === 'banned') throw new Error('Account suspended');
      t.update(userRef, {
        walletBalance: FieldValue.increment(payout),
        cumulativeBalance: FieldValue.increment(payout),
        totalEarned: FieldValue.increment(payout)   // tracks claimed returns for no-reinvest rule
      });
      t.update(invRef,  { status: 'claimed', claimedAt: FieldValue.serverTimestamp() });
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId, type: 'investment',
        description: (inv.productName || 'Investment') + ' return claimed',
        amount: payout, status: 'success', date, time,
        investmentId, createdAt: FieldValue.serverTimestamp()
      });
      const notifRef = db.collection('notifications').doc();
      t.set(notifRef, {
        userId, title: '🎉 Returns Claimed!',
        message: fmtUGX(payout) + ' from your ' + (inv.productName || 'investment') + ' has been credited to your wallet.\n\n📅 Date: ' + date + '\n⏰ Time: ' + time + '\n💰 Amount: ' + fmtUGX(payout) + '\n\nKeep investing to grow more! 🌱',
        type: 'investment', amount: payout, date, time,
        readBy: [], createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log('✅ Investment claimed: ' + investmentId + ' — ' + fmtUGX(payout) + ' to ' + userId);
    return res.json({ status: 'success', payout, message: fmtUGX(payout) + ' credited to wallet' });
  } catch (e) {
    console.error('Claim error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// BANK ACCOUNTS (Bound Mobile Money Accounts)
// ═══════════════════════════════════════════
app.post('/bank-account/add', verifyUser, async (req, res) => {
  const { userId, phone, name, network } = req.body;
  if (!userId || !phone || !name)
    return res.status(400).json({ status: 'error', message: 'userId, phone and name required' });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = userSnap.data();
    if ((user.depositCount || 0) <= 0)
      return res.status(403).json({ status: 'error', message: 'You must make a real deposit first before binding a withdrawal account' });
    const fullPhone = cleanPhone(phone);
    const existing = await db.collection('bankAccounts').where('userId', '==', userId).get();
    if (existing.size >= 2)
      return res.status(400).json({ status: 'error', message: 'Maximum 2 bank accounts allowed' });
    if (existing.docs.find(d => d.data().phone === fullPhone))
      return res.status(400).json({ status: 'error', message: 'This number is already saved' });
    // SECURITY: one phone number can only ever be bound by ONE user across the
    // whole platform — blocks withdrawing through someone else's activated number
    const phoneTaken = await db.collection('bankAccounts').where('phone', '==', fullPhone).limit(5).get();
    if (phoneTaken.docs.some(d => d.data().userId !== userId && d.data().status !== 'invalid')) {
      console.warn(`🚨 Bind attempt on another user's number: ${fullPhone} by ${userId}`);
      return res.status(403).json({ status: 'error', message: 'This number is already bound to another account. Each number can only be linked to one X-Engine account.' });
    }
    const { date, time } = nowStr();
    const docRef = await db.collection('bankAccounts').add({
      userId, phone: fullPhone, name,
      network: network || 'Mobile Money',
      status: 'pending',
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    await notify(userId, '🏦 Account Submitted!',
      `Your account ${fullPhone} (${name}) has been submitted for verification.\n\n⏳ Status: Pending Admin Review\n📅 ${date} ⏰ ${time}\n\nYou'll be notified once it's activated.`,
      'info', { phone: fullPhone, name, date, time });
    return res.json({ status: 'success', accountId: docRef.id, message: 'Account submitted for review' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/bank-account/list', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const snap = await db.collection('bankAccounts').where('userId', '==', userId).get();
    const accounts = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: undefined }));
    return res.json({ status: 'success', accounts });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/bank-account/update', async (req, res) => {
  const { accountId, status, adminKey, note } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!accountId || !['pending', 'activated', 'invalid'].includes(status))
    return res.status(400).json({ status: 'error', message: 'accountId and valid status required' });
  try {
    const snap = await db.collection('bankAccounts').doc(accountId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Account not found' });
    const acc = snap.data();
    await db.collection('bankAccounts').doc(accountId).update({
      status, reviewedAt: FieldValue.serverTimestamp(), reviewNote: note || ''
    });
    const { date, time } = nowStr();
    const titles = { activated: '✅ Account Activated!', invalid: '❌ Account Invalid', pending: '⏳ Account Pending' };
    const msgs = {
      activated: `Your account ${acc.phone} (${acc.name}) has been activated!\n\n✅ You can now use it for withdrawals.\n📅 ${date} ⏰ ${time}`,
      invalid: `Your account ${acc.phone} was flagged as invalid.\n\n❌ Please bind a valid account.\n📅 ${date} ⏰ ${time}${note ? '\n\nNote: ' + note : ''}`,
      pending: `Your account ${acc.phone} is still under review.\n\n⏳ Please wait for activation.\n📅 ${date} ⏰ ${time}`
    };
    await notify(acc.userId, titles[status], msgs[status], status === 'activated' ? 'info' : 'warning', { phone: acc.phone, status, date, time });
    return res.json({ status: 'success', message: `Account marked as ${status}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// DAILY CHECK-IN (server-side, fraud-proof)
// ═══════════════════════════════════════════
app.post('/checkin', verifyUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const settSnap = await db.collection('settings').doc('main').get();
    const bonus = settSnap.exists ? (settSnap.data().checkinBonus || 1000) : 1000;
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = userSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const nowEAT   = eatNow();
    const todayKey = nowEAT.toISOString().slice(0, 10);
    if (user.lastCheckinDate === todayKey)
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    const { date, time } = nowStr();
    const newStreak = (user.checkinStreak || 0) + 1;
    await db.runTransaction(async (t) => {
      const freshSnap = await t.get(userRef);
      if (freshSnap.data().lastCheckinDate === todayKey) throw new Error('ALREADY_DONE');
      t.update(userRef, {
        walletBalance:   FieldValue.increment(bonus),
        depositBalance:  FieldValue.increment(bonus),
        lastCheckinDate: todayKey,
        checkinStreak:   newStreak,
        checkinDays:     FieldValue.increment(1),
        checkinEarned:   FieldValue.increment(bonus)
      });
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId, type: 'checkin',
        description: 'Daily check-in — Day ' + newStreak,
        amount: bonus, status: 'success', date, time,
        createdAt: FieldValue.serverTimestamp()
      });
      const notifRef = db.collection('notifications').doc();
      t.set(notifRef, {
        userId, title: '⚡ Daily Reward Claimed!',
        message: fmtUGX(bonus) + ' deposited to your wallet!\n\n🔥 Streak: ' + newStreak + ' day(s)\n📅 Date: ' + date + '\n⏰ Time: ' + time + '\n\nKeep earning every day! ⚙️',
        type: 'checkin', amount: bonus, date, time,
        readBy: [], createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log('✅ Check-in: ' + userId + ' — ' + fmtUGX(bonus) + ' — Day ' + newStreak);
    return res.json({ status: 'success', bonus, streak: newStreak, message: fmtUGX(bonus) + ' credited!' });
  } catch (e) {
    if (e.message === 'ALREADY_DONE')
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    console.error('Check-in error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// AUTO-CRONS
// ═══════════════════════════════════════════

// CRON 1: Auto-mature investments every 30 minutes

// ═══════════════════════════════════════════
// DAILY CASHBACK CRON — runs every 24hrs
// Credits dailyCashback to walletBalance for each active investment
// ═══════════════════════════════════════════
async function runDailyCashback() {
  try {
    const now = eatNow(); // use EAT so cashback fires on Uganda calendar day
    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD (EAT-shifted)

    // Get all active investments
    const invSnap = await db.collection('investments').where('status', '==', 'active').get();
    if (invSnap.empty) return;

    let paid = 0;
    const batch = db.batch();

    for (const invDoc of invSnap.docs) {
      const inv = invDoc.data();
      if (!inv.userId || !inv.dailyCashback) continue;

      // Check if already paid today
      const lastPaidKey = inv.lastCashbackDate || '';
      if (lastPaidKey === todayKey) continue;

      // Don't pay cashback on the same day the investment was created — first payout is day 2
      const rawCreated = inv.createdAt?.toDate ? inv.createdAt.toDate() : new Date(inv.createdAt || 0);
      const createdEAT = new Date(rawCreated.getTime() + 3 * 60 * 60 * 1000);
      const createdKey = createdEAT.toISOString().slice(0, 10);
      if (createdKey === todayKey) continue;

      // Check investment not expired
      const matDate = inv.maturityDate && inv.maturityDate.toDate
        ? inv.maturityDate.toDate()
        : new Date(inv.maturityDate || 0);
      if (now > matDate) continue; // matured — no daily cashback, wait for claim

      const cashback = Number(inv.dailyCashback);
      const { date, time } = nowStr();
      const isLocked = inv.lockedCashback === true; // set at buy time: ≤30k product AND no real deposit yet

      if (isLocked) {
        // Accumulate cashback on investment — NOT credited to wallet yet
        batch.update(invDoc.ref, {
          lastCashbackDate: todayKey,
          pendingCashback: FieldValue.increment(cashback)
        });

        // Transaction record (locked)
        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
          userId: inv.userId,
          type: 'daily_cashback_locked',
          amount: cashback,
          description: `Daily cashback (locked) — ${inv.productName || 'Investment'}`,
          investmentId: invDoc.id,
          locked: true,
          date, time,
          createdAt: FieldValue.serverTimestamp()
        });

        // Notification — inform user cashback is accumulating
        const newPending = (inv.pendingCashback || 0) + cashback;
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId: inv.userId,
          title: '🔒 Cashback Accumulating',
          message: `UGX ${cashback.toLocaleString()} cashback from ${inv.productName || 'your investment'} is locked. Total locked so far: UGX ${newPending.toLocaleString()}. You will receive everything at maturity.`,
          readBy: [],
          createdAt: FieldValue.serverTimestamp()
        });
      } else {
        // Normal: credit to user wallet immediately
        const userRef = db.collection('users').doc(inv.userId);
        batch.update(userRef, {
          walletBalance: FieldValue.increment(cashback),
          cumulativeBalance: FieldValue.increment(cashback),
          totalEarned: FieldValue.increment(cashback),
          updatedAt: FieldValue.serverTimestamp()
        });

        // Mark investment as paid today
        batch.update(invDoc.ref, { lastCashbackDate: todayKey });

        // Transaction record
        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
          userId: inv.userId,
          type: 'daily_cashback',
          amount: cashback,
          description: `Daily cashback — ${inv.productName || 'Investment'}`,
          investmentId: invDoc.id,
          date, time,
          createdAt: FieldValue.serverTimestamp()
        });

        // Notification
        const notifRef = db.collection('notifications').doc();
        batch.set(notifRef, {
          userId: inv.userId,
          title: '💰 Daily Cashback Received',
          message: `UGX ${cashback.toLocaleString()} cashback from ${inv.productName || 'your investment'} has been added to your Cumulative Wallet.`,
          readBy: [],
          createdAt: FieldValue.serverTimestamp()
        });
      }

      paid++;
    }

    await batch.commit();
    console.log(`💰 Daily cashback: ${paid} investment(s) credited`);
  } catch (e) {
    console.error('Daily cashback error:', e.message);
  }
}

async function runMaturityCheck() {
  try {
    const now  = eatNow();
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return;
    let count = 0;
    const batch = db.batch();
    const notifPromises = [];
    snap.forEach(doc => {
      const inv = doc.data();
      const matDate = inv.maturityDate && inv.maturityDate.toDate ? inv.maturityDate.toDate() : null;
      if (matDate && matDate <= now) {
        batch.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() });
        notifPromises.push(notify(
          inv.userId, '🎉 Investment Matured!',
          'Your ' + (inv.productName || 'investment') + ' is ready to claim!\n\n💰 Claim: ' + fmtUGX(inv.expectedReturn) + '\n📅 Matured: ' + now.toLocaleDateString('en-UG') + '\n\nOpen the app to claim your returns! 🌱',
          'investment', { amount: inv.expectedReturn, investmentId: doc.id }
        ));
        count++;
      }
    });
    if (count > 0) {
      await batch.commit();
      await Promise.allSettled(notifPromises);
      console.log('⏰ Auto-maturity: ' + count + ' investment(s) matured');
    }
  } catch (e) { console.error('Auto-maturity error:', e.message); }
}

// CRON 2: Auto-fail deposits stuck in processing >15 minutes
async function runStaleDepositCleanup() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await db.collection('pendingPayments').where('status', '==', 'processing').get();
    if (snap.empty) return;
    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const created = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : null;
      if (!created || created > cutoff) continue;
      const failReason = 'Payment timed out — no response from provider after 15 minutes';
      const batch = db.batch();
      batch.update(doc.ref, { status: 'failed', failReason, failedAt: FieldValue.serverTimestamp() });
      if (d.depositId) {
        batch.update(db.collection('deposits').doc(d.depositId), { status: 'failed', failReason });
      }
      await batch.commit();
      await notify(d.userId, '⏱️ Deposit Timed Out',
        'Your deposit of ' + fmtUGX(d.amount) + ' did not complete within 15 minutes.\n\nNo money was deducted from your account. Please try again.\n\nReference: ' + doc.id,
        'deposit_failed', { reference: doc.id, amount: d.amount, failReason });
      count++;
    }
    if (count > 0) console.log('🧹 Stale deposits cleaned: ' + count);
  } catch (e) { console.error('Stale deposit cleanup error:', e.message); }
}

// CRON 3: Warn admin + notify user for withdrawals stuck in processing >2 hours
async function runStaleWithdrawalAlert() {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').get();
    if (snap.empty) return;
    for (const doc of snap.docs) {
      const d  = doc.data();
      const ts = (d.approvedAt || d.createdAt);
      const tsDate = ts && ts.toDate ? ts.toDate() : null;
      if (!tsDate || tsDate > cutoff || d.staleAlerted) continue;
      await doc.ref.update({ staleAlerted: true });
      console.warn('⚠️ STALE WITHDRAWAL: ' + doc.id + ' — ' + fmtUGX(d.netAmount) + ' to ' + d.withdrawalPhone + ' — stuck >2h. Check MarzPay dashboard.');
      await notify(d.userId, '⏳ Withdrawal Still Processing',
        'Your withdrawal of ' + fmtUGX(d.netAmount) + ' to ' + d.withdrawalPhone + ' is taking longer than usual.\n\nWe are checking with our payment provider. You will be notified once it completes.\n\n🔖 Ref: ' + d.reference,
        'withdrawal', { amount: d.netAmount, reference: d.reference });
    }
  } catch (e) { console.error('Stale withdrawal alert error:', e.message); }
}

function startCrons() {
  setInterval(runMaturityCheck, 30 * 60 * 1000);
  // Run cashback check every hour — the guard (lastCashbackDate===todayKey) prevents double-pay.
  // Running hourly means cashback fires within 1 hour of Uganda midnight rather than waiting
  // a full 24h from the last server restart.
  setInterval(runDailyCashback, 60 * 60 * 1000);
  runDailyCashback(); // Immediate run on startup (safe — day-key guard prevents double-pay)
  runMaturityCheck();
  setInterval(runStaleDepositCleanup, 5 * 60 * 1000);
  setInterval(runStaleWithdrawalAlert, 30 * 60 * 1000);
  console.log('⏰ Crons started: maturity(30m) | stale-deposits(5m) | stale-withdrawals(30m) | daily-cashback(1h)');
}

// One-time backfill: recalculate l2ReferralCount and l3ReferralCount for all users
app.post('/admin/fix-referral-counts', async (req, res) => {
  const { secret } = req.body;
  if (secret !== (process.env.ADMIN_SECRET || 'xengine-fix-2026')) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  try {
    const allUsers = await db.collection('users').get();
    // Build a map: uid → referredBy
    const refMap = {};
    allUsers.forEach(d => { refMap[d.id] = d.data().referredBy || null; });

    // Count how many people each user has as L2 and L3 downstream
    const l2Counts = {}; // uid → number of L2 children
    const l3Counts = {}; // uid → number of L3 children

    allUsers.forEach(d => {
      const uid = d.id;
      const l1Parent = refMap[uid];          // person who referred uid
      if (!l1Parent) return;
      const l2Parent = refMap[l1Parent];     // l1Parent's referrer = uid's L2 grandparent
      if (!l2Parent) return;
      l2Counts[l2Parent] = (l2Counts[l2Parent] || 0) + 1;
      const l3Parent = refMap[l2Parent];     // l2Parent's referrer = uid's L3 great-grandparent
      if (!l3Parent) return;
      l3Counts[l3Parent] = (l3Counts[l3Parent] || 0) + 1;
    });

    // ── Migrate refEarned → cumulativeBalance for users where it hasn't been done yet.
    //    AND auto-fix double-credits: for users with depositCount=0 (no real deposits),
    //    cumulativeBalance should equal exactly refEarned + totalEarned.
    //    Any excess is a double-credit from running backfill + admin manual add.
    const cumUpdates   = {}; // uid → { add: N }  (positive = credit missing amount)
    const cumFixes     = {}; // uid → { set: N }   (corrected value for over-credited users)
    const walletFixes  = {}; // uid → delta to apply to walletBalance

    allUsers.forEach(d => {
      const u = d.data();
      const refEarned      = u.refEarned      || 0;
      const totalEarned    = u.totalEarned    || 0;
      const cumBalance     = u.cumulativeBalance || 0;
      const depositCount   = u.depositCount   || 0;

      if (depositCount === 0 && refEarned > 0) {
        // No real deposits → cumulative should ONLY be refEarned + totalEarned
        const expected = refEarned + totalEarned;
        if (cumBalance > expected) {
          // Over-credited — deduct the excess
          const overage = cumBalance - expected;
          cumFixes[d.id]    = -overage;   // delta to cumulativeBalance
          walletFixes[d.id] = -overage;   // delta to walletBalance
        } else if (cumBalance < expected) {
          // Under-credited (refEarned not yet migrated) — credit the missing amount
          const missing = expected - cumBalance;
          cumUpdates[d.id] = missing;
        }
      } else if (depositCount === 0 && refEarned === 0 && cumBalance === 0) {
        // No referrals, no deposits — nothing to do
      }
      // depositCount > 0: user has real deposits and may have legitimate daily cashback
      // in cumulativeBalance — don't touch them
    });

    const allUids = new Set([
      ...Object.keys(l2Counts), ...Object.keys(l3Counts),
      ...Object.keys(cumUpdates), ...Object.keys(cumFixes)
    ]);
    const uidArr = [...allUids];
    for (let i = 0; i < uidArr.length; i += 400) {
      const chunk = uidArr.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach(uid => {
        const ref = db.collection('users').doc(uid);
        const upd = {};
        if (l2Counts[uid]   !== undefined) upd.l2ReferralCount  = l2Counts[uid];
        if (l3Counts[uid]   !== undefined) upd.l3ReferralCount  = l3Counts[uid];
        if (cumUpdates[uid] !== undefined) upd.cumulativeBalance = FieldValue.increment(cumUpdates[uid]);
        if (cumFixes[uid]   !== undefined) upd.cumulativeBalance = FieldValue.increment(cumFixes[uid]);
        if (walletFixes[uid] !== undefined) upd.walletBalance   = FieldValue.increment(walletFixes[uid]);
        batch.update(ref, upd);
      });
      await batch.commit();
    }

    const fixedCount = Object.keys(cumFixes).length;
    const creditedCount = Object.keys(cumUpdates).length;

    // ── Backfill missed L2/L3 bonuses ──
    // Find referral docs where L1 was paid but L2/L3 parent wasn't credited yet
    const settSnap = await db.collection('settings').doc('main').get();
    const settings = settSnap.exists ? settSnap.data() : {};
    const ongoingFlat = settings.refL2 || 2000;
    const l3Flat      = settings.refL3 || 200;

    const unpaidL2Snap = await db.collection('referrals')
      .where('paid', '==', true)
      .where('l2Paid', '==', false)
      .get().catch(()=>null);

    // Also get referrals where l2Paid field doesn't exist yet
    const noFieldSnap = await db.collection('referrals')
      .where('paid', '==', true)
      .get().catch(()=>null);

    const toProcess = new Map();
    if (noFieldSnap) {
      noFieldSnap.forEach(d => {
        const data = d.data();
        if (data.l2Paid !== true) toProcess.set(d.id, { ref: d.ref, data });
      });
    }
    if (unpaidL2Snap) {
      unpaidL2Snap.forEach(d => toProcess.set(d.id, { ref: d.ref, data: d.data() }));
    }

    let l2BackfillCount = 0;
    const { date, time } = nowStr();

    for (const { ref: refDocRef, data: refData } of toProcess.values()) {
      const depositorId = refData.referredUserId;
      const l1Uid = refData.referrerId || refData.referredBy;
      if (!depositorId || !l1Uid) continue;

      const l2Uid = refMap[l1Uid];
      if (!l2Uid || l2Uid === l1Uid) {
        await refDocRef.update({ l2Paid: true });
        continue;
      }

      try {
        // Credit L2 parent
        const batch = db.batch();
        const l2Ref = db.collection('users').doc(l2Uid);
        batch.update(l2Ref, {
          walletBalance:     FieldValue.increment(ongoingFlat),
          cumulativeBalance: FieldValue.increment(ongoingFlat),
          referralBalance:   FieldValue.increment(ongoingFlat),
          refEarned:         FieldValue.increment(ongoingFlat)
        });
        const tx2Ref = db.collection('transactions').doc();
        batch.set(tx2Ref, {
          userId: l2Uid, type: 'referral_l2',
          description: `L2 backfill bonus — network member deposited`,
          amount: ongoingFlat, status: 'success', date, time,
          referredUserId: depositorId, createdAt: FieldValue.serverTimestamp()
        });

        // Credit L3 parent if exists
        const l3Uid = refMap[l2Uid];
        if (l3Uid && l3Uid !== l2Uid) {
          const l3Ref = db.collection('users').doc(l3Uid);
          batch.update(l3Ref, {
            walletBalance:     FieldValue.increment(l3Flat),
            cumulativeBalance: FieldValue.increment(l3Flat),
            referralBalance:   FieldValue.increment(l3Flat),
            refEarned:         FieldValue.increment(l3Flat)
          });
          const tx3Ref = db.collection('transactions').doc();
          batch.set(tx3Ref, {
            userId: l3Uid, type: 'referral_l3',
            description: `L3 backfill bonus — network member deposited`,
            amount: l3Flat, status: 'success', date, time,
            referredUserId: depositorId, createdAt: FieldValue.serverTimestamp()
          });
        }

        batch.update(refDocRef, { l2Paid: true });
        await batch.commit();
        l2BackfillCount++;
      } catch (e3) {
        console.error('L2/L3 backfill error for', depositorId, e3.message);
      }
    }

    // ── Unlock locked cashback for users who have since made real deposits ──
    // Finds any investment with lockedCashback=true whose owner now has depositCount>0.
    // Credits all accumulated pendingCashback and flips the lock off.
    const lockedInvSnap = await db.collection('investments')
      .where('lockedCashback', '==', true)
      .get().catch(() => null);
    let unlockedCount = 0;
    if (lockedInvSnap && !lockedInvSnap.empty) {
      // Group by userId so we only load each user doc once
      const byUser = {};
      lockedInvSnap.forEach(d => {
        const uid = d.data().userId;
        if (!byUser[uid]) byUser[uid] = [];
        byUser[uid].push({ ref: d.ref, data: d.data() });
      });
      for (const [uid, invs] of Object.entries(byUser)) {
        try {
          const uSnap = await db.collection('users').doc(uid).get();
          if (!uSnap.exists || (uSnap.data().depositCount || 0) === 0) continue;
          // This user has real deposits — unlock all their locked investments
          await unlockLockedCashback(uid);
          unlockedCount += invs.length;
        } catch (e4) { console.error('Cashback unlock backfill error:', uid, e4.message); }
      }
    }

    console.log(`✅ Maintenance: ${allUids.size} users updated | ${fixedCount} double-credits fixed | ${creditedCount} missing credits added | ${l2BackfillCount} L2/L3 bonuses backfilled | ${unlockedCount} cashback locks released`);
    return res.json({
      status: 'success',
      updated: allUids.size,
      doubleCreditsFixed: fixedCount,
      missingCreditsAdded: creditedCount,
      l2l3Backfilled: l2BackfillCount,
      cashbackUnlocked: unlockedCount,
      fixes: cumFixes,
      credits: cumUpdates
    });
  } catch (e) {
    console.error('Backfill error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN: BACKFILL referralBalance — one-time migration for users
// created before the referralBalance field existed.
// Estimate: unspent referral money = refEarned − totalWithdrawn,
// floored at 0 and capped at current cumulativeBalance (can't have
// more unspent referral money than total withdrawable balance).
// Idempotent: only sets the field where it doesn't exist yet.
// ═══════════════════════════════════════════
app.post('/admin/backfill-referral-balance', async (req, res) => {
  const { secret } = req.body;
  if (secret !== (process.env.ADMIN_SECRET || 'xengine-fix-2026')) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  try {
    const allUsers = await db.collection('users').get();
    const updates = {}; // uid → estimated referralBalance
    allUsers.forEach(d => {
      const u = d.data();
      if (u.referralBalance !== undefined) return; // already migrated — never overwrite live values
      const refEarned      = u.refEarned || 0;
      const totalWithdrawn = u.totalWithdrawn || 0;
      const cumBalance     = u.cumulativeBalance || 0;
      updates[d.id] = Math.max(0, Math.min(refEarned - totalWithdrawn, cumBalance));
    });

    const uids = Object.keys(updates);
    for (let i = 0; i < uids.length; i += 400) {
      const batch = db.batch();
      uids.slice(i, i + 400).forEach(uid => {
        batch.update(db.collection('users').doc(uid), { referralBalance: updates[uid] });
      });
      await batch.commit();
    }

    const withBalance = uids.filter(uid => updates[uid] > 0).length;
    console.log(`✅ referralBalance backfill: ${uids.length} users migrated, ${withBalance} with balance > 0`);
    return res.json({ status: 'success', migrated: uids.length, withBalance });
  } catch (e) {
    console.error('referralBalance backfill error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// OTP — send (max 2 per 24 hrs) then verify + reset PIN or PASSWORD
// purpose: 'pin' | 'password'
// ═══════════════════════════════════════════
app.post('/otp/send', verifyUser, async (req, res) => {
  const { userId, purpose = 'pin' } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    // SECURITY: OTP only ever goes to the phone registered on the account —
    // never to a number supplied in the request body.
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'Account not found' });
    const regPhone = userSnap.data().phone;
    if (!regPhone) return res.status(400).json({ status: 'error', message: 'No phone number on this account. Contact support.' });

    const otpRef   = db.collection('otps').doc(userId);
    const otpSnap  = await otpRef.get();
    const otpData  = otpSnap.exists ? otpSnap.data() : {};
    const now      = Date.now();
    const winStart = otpData.windowStart?.toMillis?.() || 0;
    const count    = otpData.requestCount || 0;
    const expired  = (now - winStart) >= 24 * 60 * 60 * 1000;

    if (!expired && count >= 2) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - winStart)) / (60 * 60 * 1000));
      return res.status(429).json({ status: 'error', message: `Maximum OTP attempts reached. Try again in ${hoursLeft} hour(s).` });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await otpRef.set({
      code, purpose,
      expiresAt:    new Date(now + 10 * 60 * 1000),
      phone:        cleanPhone(regPhone),
      attempts:     0,
      requestCount: expired ? 1 : count + 1,
      windowStart:  expired ? FieldValue.serverTimestamp() : (otpData.windowStart || FieldValue.serverTimestamp()),
      createdAt:    FieldValue.serverTimestamp()
    });

    const label   = purpose === 'password' ? 'password' : 'PIN';
    const smsRes  = await marzSMS(cleanPhone(regPhone),
      `X-Engine OTP: ${code}\nUse this to reset your ${label}. Expires in 10 mins. Do NOT share this code.`);

    if (!smsRes.success) return res.status(500).json({ status: 'error', message: 'SMS failed. Check your phone number.' });
    return res.json({ status: 'success', message: 'OTP sent to your phone number.' });
  } catch(e) {
    console.error('OTP send error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// Verify an OTP WITHOUT consuming it. Used by the "Verify OTP" button so the
// user is told immediately whether the code is right — before they ever reach
// the new-PIN / new-password screen. The OTP is finally consumed (deleted) by
// the /pin/reset-via-otp and /password/reset-via-otp endpoints.
app.post('/otp/verify', verifyUser, async (req, res) => {
  const { userId, otp, purpose = 'pin' } = req.body;
  if (!userId || !otp) return res.status(400).json({ status: 'error', message: 'userId and otp required' });
  try {
    const otpRef  = db.collection('otps').doc(userId);
    const otpSnap = await otpRef.get();
    if (!otpSnap.exists) return res.status(400).json({ status: 'error', message: 'No OTP found. Request a new one.' });
    const otpData = otpSnap.data();

    if ((otpData.purpose || 'pin') !== purpose)
      return res.status(400).json({ status: 'error', message: `OTP was not issued for ${purpose === 'password' ? 'password' : 'PIN'} reset.` });

    if (new Date(otpData.expiresAt.toDate ? otpData.expiresAt.toDate() : otpData.expiresAt) < new Date())
      return res.status(400).json({ status: 'error', message: 'OTP has expired. Request a new one.' });

    if ((otpData.attempts || 0) >= 5)
      return res.status(400).json({ status: 'error', message: 'Too many wrong attempts. Request a new OTP.' });

    if (otpData.code !== String(otp)) {
      await otpRef.update({ attempts: FieldValue.increment(1) });
      const left = 5 - ((otpData.attempts || 0) + 1);
      return res.status(400).json({ status: 'error', message: `Wrong OTP. ${left} attempt(s) left.` });
    }

    // Correct — do NOT delete; the reset endpoint consumes it.
    return res.json({ status: 'success', message: 'OTP verified.' });
  } catch(e) {
    console.error('OTP verify error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/pin/reset-via-otp', verifyUser, async (req, res) => {
  const { userId, otp, newPin } = req.body;
  if (!userId || !otp || !newPin) return res.status(400).json({ status: 'error', message: 'userId, otp and newPin required' });
  if (!/^\d{4}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'PIN must be 4 digits' });
  try {
    const otpRef  = db.collection('otps').doc(userId);
    const otpSnap = await otpRef.get();
    if (!otpSnap.exists) return res.status(400).json({ status: 'error', message: 'No OTP found. Request a new one.' });
    const otpData = otpSnap.data();

    if ((otpData.purpose || 'pin') !== 'pin')
      return res.status(400).json({ status: 'error', message: 'OTP was not issued for PIN reset.' });

    if (new Date(otpData.expiresAt.toDate ? otpData.expiresAt.toDate() : otpData.expiresAt) < new Date())
      return res.status(400).json({ status: 'error', message: 'OTP has expired. Request a new one.' });

    if ((otpData.attempts || 0) >= 5)
      return res.status(400).json({ status: 'error', message: 'Too many wrong attempts. Request a new OTP.' });

    if (otpData.code !== String(otp)) {
      await otpRef.update({ attempts: FieldValue.increment(1) });
      const left = 5 - ((otpData.attempts || 0) + 1);
      return res.status(400).json({ status: 'error', message: `Wrong OTP. ${left} attempt(s) left.` });
    }

    await db.collection('users').doc(userId).update({
      withdrawalPin:   hashPin(newPin),
      pinResetByAdmin: false,
      pinAttempts:     0,
      pinLockUntil:    null
    });
    await otpRef.delete();
    return res.json({ status: 'success', message: 'PIN reset successfully.' });
  } catch(e) {
    console.error('PIN reset OTP error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/password/reset-via-otp', verifyUser, async (req, res) => {
  const { userId, otp, newPassword } = req.body;
  if (!userId || !otp || !newPassword) return res.status(400).json({ status: 'error', message: 'userId, otp and newPassword required' });
  if (newPassword.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
  try {
    const otpRef  = db.collection('otps').doc(userId);
    const otpSnap = await otpRef.get();
    if (!otpSnap.exists) return res.status(400).json({ status: 'error', message: 'No OTP found. Request a new one.' });
    const otpData = otpSnap.data();

    if ((otpData.purpose || 'pin') !== 'password')
      return res.status(400).json({ status: 'error', message: 'OTP was not issued for password reset.' });

    if (new Date(otpData.expiresAt.toDate ? otpData.expiresAt.toDate() : otpData.expiresAt) < new Date())
      return res.status(400).json({ status: 'error', message: 'OTP has expired. Request a new one.' });

    if ((otpData.attempts || 0) >= 5)
      return res.status(400).json({ status: 'error', message: 'Too many wrong attempts. Request a new OTP.' });

    if (otpData.code !== String(otp)) {
      await otpRef.update({ attempts: FieldValue.increment(1) });
      const left = 5 - ((otpData.attempts || 0) + 1);
      return res.status(400).json({ status: 'error', message: `Wrong OTP. ${left} attempt(s) left.` });
    }

    // Update Firebase Auth password
    await admin.auth().updateUser(userId, { password: newPassword });
    // Clear temp password if admin had set one
    await db.collection('users').doc(userId).update({ tempPassword: '', tempPasswordSetAt: null });
    await otpRef.delete();
    return res.json({ status: 'success', message: 'Password reset successfully.' });
  } catch(e) {
    console.error('Password reset OTP error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN SMS — single user or bulk
// ═══════════════════════════════════════════
app.post('/admin/sms/user', async (req, res) => {
  const { userId, message, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId || !message) return res.status(400).json({ status: 'error', message: 'userId and message required' });
  if (message.length > 320) return res.status(400).json({ status: 'error', message: 'Message too long (max 320 chars)' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const phone = uSnap.data().phone;
    if (!phone) return res.status(400).json({ status: 'error', message: 'User has no phone number' });
    const smsRes = await marzSMS(phone, message);
    if (smsRes.success) return res.json({ status: 'success', message: `SMS sent to ${phone}` });
    return res.status(500).json({ status: 'error', message: smsRes.message });
  } catch(e) {
    console.error('Admin SMS user error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/admin/sms/bulk', async (req, res) => {
  const { message, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!message) return res.status(400).json({ status: 'error', message: 'message required' });
  if (message.length > 320) return res.status(400).json({ status: 'error', message: 'Message too long (max 320 chars)' });
  try {
    const snap   = await db.collection('users').where('status', '==', 'active').get();
    const phones = [];
    snap.forEach(d => { const p = d.data().phone; if (p) phones.push(p); });
    if (!phones.length) return res.status(400).json({ status: 'error', message: 'No active users with phone numbers' });

    let sent = 0, failed = 0;
    for (let i = 0; i < phones.length; i += 50) {
      const batch = phones.slice(i, i + 50).join(', ');
      const r = await marzSMS(batch, message);
      sent   += r.data?.successful || (r.success ? phones.slice(i, i + 50).length : 0);
      failed += r.data?.failed     || (r.success ? 0 : phones.slice(i, i + 50).length);
    }
    return res.json({ status: 'success', message: `Bulk SMS: ${sent} sent, ${failed} failed`, sent, failed });
  } catch(e) {
    console.error('Admin bulk SMS error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const authSource = process.env.MARZ_AUTH ? 'MARZ_AUTH env'
    : process.env.MARZ_API_KEY ? 'MARZ_API_KEY env' : 'hardcoded fallback';
  console.log('🌱 X-Engine Server v3.0 on port ' + PORT);
  console.log('   Marzipay:  ' + MARZ_BASE);
  console.log('   Railway:   ' + RAILWAY_URL);
  console.log('   Auth:      ' + authSource);
  console.log('   Callbacks: POST /callback  &  POST /deposit/callback');
  startCrons();
});
