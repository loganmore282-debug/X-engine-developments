const express    = require('express');
const admin      = require('firebase-admin');
const cors       = require('cors');
const crypto     = require('crypto');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

process.on('unhandledRejection', (reason) => console.error('⚠️ Unhandled rejection:', reason));
process.on('uncaughtException',  (err)    => { console.error('💥 Uncaught exception:', err); process.exit(1); });

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cors({ origin: '*' }));

// ── RATE LIMITERS ──
const authLimiter  = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a minute.' } });
const apiLimiter   = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many admin requests.' } });
app.use('/auth/', authLimiter);
app.use('/checkin', apiLimiter);
app.use('/withdraw/request', apiLimiter);
app.use('/invest/create', apiLimiter);
app.use('/admin/', adminLimiter);

// ── FIREBASE AUTH ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT invalid:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── MONGODB ──
const { connectMongo, db, FieldValue } = require('./db');

// ── CONFIG ──
const ADMIN_KEY        = process.env.ADMIN_KEY        || '';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
if (!FIREBASE_API_KEY) { console.error('❌ FIREBASE_API_KEY env var is required'); process.exit(1); }

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || '';

const MIN_DEPOSIT      = 30000;
const MIN_WITHDRAWAL   = 20000;
const WITHDRAW_STEP    = 5000;
const CHECKIN_BONUS    = 500;
const WELCOME_BONUS    = 5000;
const COMM_L1          = 0.20;
const COMM_L2          = 0.05;
const COMM_L3          = 0.01;
const LIQUIDITY_FEE    = 0.15;
const PROVIDER_BUSY_MSG = 'The mobile-money service is temporarily busy. Please try again shortly.';

// ── VIP TIERS (space-themed ladder, ×3 return) — admin-overridable via settings ──
const DEFAULT_TIERS = [
  { key: 'comet',     label: 'Comet',     price: 30000,    cycleDays: 8, multiplier: 3 },
  { key: 'asteroid',  label: 'Asteroid',  price: 90000,    cycleDays: 8, multiplier: 3 },
  { key: 'pulsar',    label: 'Pulsar',    price: 270000,   cycleDays: 8, multiplier: 3 },
  { key: 'nebula',    label: 'Nebula',    price: 500000,   cycleDays: 8, multiplier: 3 },
  { key: 'quasar',    label: 'Quasar',    price: 700000,   cycleDays: 7, multiplier: 3 },
  { key: 'supernova', label: 'Supernova', price: 900000,   cycleDays: 8, multiplier: 3 },
  { key: 'singularity', label: 'Singularity', price: 1000000, cycleDays: 8, multiplier: 3 },
];

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── MarzPay API helpers ──
const MARZ_TIMEOUT = 20000;
async function marzCollect({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'Wallet recharge' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/collect-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'Payout' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/send-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}
async function marzGetCollectStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/collect-money/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` } });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
async function marzGetSendStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/send-money/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` } });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}

// ── MAINTENANCE (cached 60s) ──
let _maint = false, _maintTs = 0;
async function isMaintenanceOn() {
  if (Date.now() - _maintTs < 60000) return _maint;
  try {
    const s = await db.collection('settings').doc('main').get();
    _maint = s.exists && !!s.data().maintenanceMode;
  } catch (_) {}
  _maintTs = Date.now();
  return _maint;
}
const BYPASS = ['/', '/admin', '/auth/', '/settings/public'];
app.use(async (req, res, next) => {
  const p = req.path;
  if (BYPASS.some(b => p === b || p.startsWith(b + '/'))) return next();
  if (await isMaintenanceOn())
    return res.status(503).json({ status: 'error', maintenance: true,
      message: 'Novera is under maintenance. Please check back shortly.' });
  next();
});

// ── HELPERS ──
function fmtUGX(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function')   return v.toDate().getTime();
  if (typeof v === 'object' && v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('256') && s.length >= 12) return '+' + s;
  if (s.startsWith('0')   && s.length === 10) return '+256' + s.slice(1);
  if (s.length === 9)  return '+256' + s;
  if (s.length === 12 && s.startsWith('256')) return '+' + s;
  return '+256' + s;
}
async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch (_) { return null; }
}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randChars(n) {
  return Array.from(crypto.randomBytes(n)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const code = randChars(7);
    const exists = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  return randChars(9);
}
async function getSettings() {
  const s = await db.collection('settings').doc('main').get();
  return s.exists ? s.data() : {};
}
async function getTiers() {
  const sett = await getSettings();
  return Array.isArray(sett.tiers) && sett.tiers.length ? sett.tiers : DEFAULT_TIERS;
}

// ── AUTH: REGISTER PROFILE ──
app.post('/auth/register', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  try {
    const existing = await db.collection('users').doc(uid).get();
    if (existing.exists) return res.json({ status: 'success', message: 'Already registered' });

    const { name, phone, referredBy } = req.body || {};
    const cleanName = String(name || '').replace(/<[^>]*>/g, '').trim().slice(0, 60) || 'Voyager';

    let referrer = null;
    if (referredBy) {
      const q = await db.collection('users').where('referralCode', '==', String(referredBy).toUpperCase().trim()).limit(1).get();
      if (!q.empty) referrer = q.docs[0];
    }

    const referralCode = await generateUniqueReferralCode();
    const userDoc = {
      name: cleanName,
      phone: cleanPhone(phone),
      referralCode,
      referredBy: referrer ? referrer.id : null,
      referralChain: referrer ? [referrer.id, ...(referrer.data().referralChain || []).slice(0, 1)] : [],
      walletBalance: WELCOME_BONUS,
      totalInvested: 0,
      totalEarned: 0,
      lastCheckin: null,
      checkinStreak: 0,
      createdAt: FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(uid).set(userDoc);
    if (WELCOME_BONUS > 0) {
      await db.collection('ledger').add({
        userId: uid, type: 'welcome_bonus', amount: WELCOME_BONUS,
        description: 'Welcome bonus', createdAt: FieldValue.serverTimestamp(),
      });
    }
    res.json({ status: 'success', referralCode });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ status: 'error', message: 'Registration failed' });
  }
});

app.get('/auth/profile', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Profile not found' });
  res.json({ status: 'success', profile: { id: uid, ...snap.data() } });
});

// ── PUBLIC: TIERS + SETTINGS ──
app.get('/public/tiers', async (req, res) => {
  res.json({ status: 'success', tiers: await getTiers() });
});
app.get('/settings/public', async (req, res) => {
  const sett = await getSettings();
  res.json({ status: 'success', settings: {
    maintenanceMode: !!sett.maintenanceMode,
    announcement: sett.announcement || null,
    support: sett.support || null,
  } });
});

// ── INVEST (buy a VIP tier from wallet, referral commission paid up 3 levels) ──
const _investingUsers = new Set();
app.post('/invest/create', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  if (_investingUsers.has(uid)) return res.status(429).json({ status: 'error', message: 'Investment already in progress' });
  _investingUsers.add(uid);
  try {
    const { tierKey } = req.body || {};
    const tiers = await getTiers();
    const tier = tiers.find(t => t.key === tierKey);
    if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown tier' });

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'Profile not found' });
    const user = userSnap.data();
    if ((user.walletBalance || 0) < tier.price)
      return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });

    const expectedReturn = Math.round(tier.price * tier.multiplier);
    const maturesAt = new Date(Date.now() + tier.cycleDays * 86400000);

    await userRef.update({ walletBalance: FieldValue.increment(-tier.price), totalInvested: FieldValue.increment(tier.price) });
    const invRef = await db.collection('investments').add({
      userId: uid, tierKey: tier.key, tierLabel: tier.label, price: tier.price,
      expectedReturn, cycleDays: tier.cycleDays, status: 'active',
      startedAt: FieldValue.serverTimestamp(), maturesAt,
    });

    // Referral commissions L1/L2/L3, paid immediately on investment
    const sett = await getSettings();
    const commL1 = sett.commL1 ?? COMM_L1, commL2 = sett.commL2 ?? COMM_L2, commL3 = sett.commL3 ?? COMM_L3;
    let uplineId = user.referredBy;
    const rates = [commL1, commL2, commL3];
    for (let level = 0; level < 3 && uplineId; level++) {
      const upRef = db.collection('users').doc(uplineId);
      const upSnap = await upRef.get();
      if (!upSnap.exists) break;
      const commission = Math.round(tier.price * rates[level]);
      if (commission > 0) {
        await upRef.update({ walletBalance: FieldValue.increment(commission), totalEarned: FieldValue.increment(commission) });
        await db.collection('ledger').add({
          userId: uplineId, type: 'referral_commission', amount: commission, level: level + 1,
          fromUserId: uid, description: `Level ${level + 1} reward`, createdAt: FieldValue.serverTimestamp(),
        });
      }
      uplineId = upSnap.data().referredBy;
    }

    res.json({ status: 'success', investmentId: invRef.id, expectedReturn, maturesAt: maturesAt.toISOString() });
  } catch (e) {
    console.error('invest error', e);
    res.status(500).json({ status: 'error', message: 'Investment failed' });
  } finally {
    _investingUsers.delete(uid);
  }
});

app.get('/invest/mine', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const q = await db.collection('investments').where('userId', '==', uid).orderBy('startedAt', 'desc').get();
  res.json({ status: 'success', investments: q.docs.map(d => ({ id: d.id, ...d.data() })) });
});

// ── MATURITY CHECK — pays out full expectedReturn when an investment matures ──
async function runMaturityCheck() {
  try {
    const now = new Date();
    const q = await db.collection('investments').where('status', '==', 'active').get();
    for (const doc of q.docs) {
      const inv = doc.data();
      if (tsMillis(inv.maturesAt) > now.getTime()) continue;
      await db.collection('users').doc(inv.userId).update({
        walletBalance: FieldValue.increment(inv.expectedReturn),
        totalEarned: FieldValue.increment(inv.expectedReturn),
      });
      await doc.ref.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() });
      await db.collection('ledger').add({
        userId: inv.userId, type: 'investment_payout', amount: inv.expectedReturn,
        description: `${inv.tierLabel} matured`, createdAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (e) { console.error('maturity check error', e); }
}
setInterval(runMaturityCheck, 5 * 60 * 1000);

// ── CHECK-IN ──
app.post('/checkin', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Profile not found' });
  const user = snap.data();
  const last = tsMillis(user.lastCheckin);
  const oneDay = 20 * 3600000; // allow slightly before 24h so timezone drift doesn't block
  if (Date.now() - last < oneDay)
    return res.status(400).json({ status: 'error', message: 'Already checked in today' });
  await userRef.update({
    walletBalance: FieldValue.increment(CHECKIN_BONUS),
    lastCheckin: FieldValue.serverTimestamp(),
    checkinStreak: FieldValue.increment(1),
  });
  res.json({ status: 'success', bonus: CHECKIN_BONUS });
});

// ── TEAM / REFERRALS ──
app.get('/team', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const l1q = await db.collection('users').where('referredBy', '==', uid).get();
  const l1 = l1q.docs.map(d => ({ id: d.id, name: d.data().name, totalInvested: d.data().totalInvested || 0 }));
  const l2ids = [];
  for (const m of l1) {
    const q = await db.collection('users').where('referredBy', '==', m.id).get();
    l2ids.push(...q.docs.map(d => d.id));
  }
  let l3Count = 0;
  for (const id of l2ids) {
    const q = await db.collection('users').where('referredBy', '==', id).get();
    l3Count += q.size;
  }
  const commQ = await db.collection('ledger').where('userId', '==', uid).where('type', '==', 'referral_commission').get();
  const totalCommission = commQ.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
  res.json({ status: 'success', l1, l2Count: l2ids.length, l3Count, totalCommission });
});

// ── WALLET: DEPOSIT VIA MARZPAY ──
const _lastDepositAttempt = new Map();
app.post('/deposit/marzpay', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const lastAt = _lastDepositAttempt.get(uid) || 0;
  if (Date.now() - lastAt < 7000) return res.status(429).json({ status: 'error', message: 'Please wait a moment before retrying' });
  _lastDepositAttempt.set(uid, Date.now());

  const { amount, phone } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt < MIN_DEPOSIT) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(MIN_DEPOSIT)}` });

  try {
    const reference = uuidv4();
    const depRef = await db.collection('deposits').add({
      userId: uid, amount: amt, phone: cleanPhone(phone), reference, status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    const mpData = await marzCollect({ amount: amt, phone: cleanPhone(phone), reference, description: 'Wallet recharge' });
    const uuid = mpData?.data?.transaction?.uuid || mpData?.transaction?.uuid || mpData?.uuid || null;
    if (!uuid) {
      await depRef.update({ status: 'failed', error: JSON.stringify(mpData).slice(0, 500) });
      return res.status(502).json({ status: 'error', message: PROVIDER_BUSY_MSG });
    }
    await depRef.update({ marzUuid: uuid });
    res.json({ status: 'success', depositId: depRef.id });
  } catch (e) {
    console.error('deposit error', e);
    res.status(502).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});

const _creditingDeposits = new Set();
async function creditDepositIfNeeded(depDoc) {
  if (depDoc.data().status === 'completed') return false;
  if (_creditingDeposits.has(depDoc.id)) return false;
  _creditingDeposits.add(depDoc.id);
  try {
    const fresh = await depDoc.ref.get();
    if (!fresh.exists || fresh.data().status === 'completed') return false;
    const dep = fresh.data();
    await db.collection('users').doc(dep.userId).update({ walletBalance: FieldValue.increment(dep.amount) });
    await depDoc.ref.update({ status: 'completed', completedAt: FieldValue.serverTimestamp() });
    await db.collection('ledger').add({
      userId: dep.userId, type: 'wallet_recharge', amount: dep.amount,
      description: 'Wallet recharge', createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } finally {
    _creditingDeposits.delete(depDoc.id);
  }
}

app.get('/deposit/status/:id', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const doc = await db.collection('deposits').doc(req.params.id).get();
  if (!doc.exists || doc.data().userId !== uid) return res.status(404).json({ status: 'error', message: 'Not found' });
  const dep = doc.data();
  if (dep.status === 'pending' && dep.marzUuid) {
    const providerStatus = await marzGetCollectStatus(dep.marzUuid);
    if (providerStatus === 'successful' || providerStatus === 'completed') await creditDepositIfNeeded(doc);
    else if (providerStatus === 'failed') await doc.ref.update({ status: 'failed' });
  }
  const fresh = await doc.ref.get();
  res.json({ status: 'success', deposit: fresh.data() });
});

app.post('/webhooks/marzpay', async (req, res) => {
  try {
    const uuid = req.body?.data?.transaction?.uuid || req.body?.transaction?.uuid;
    const txStatus = String(req.body?.data?.transaction?.status || req.body?.transaction?.status || '').toLowerCase();
    if (!uuid) return res.json({ status: 'ignored' });
    const q = await db.collection('deposits').where('marzUuid', '==', uuid).limit(1).get();
    if (!q.empty && (txStatus === 'successful' || txStatus === 'completed')) await creditDepositIfNeeded(q.docs[0]);
    else if (!q.empty && txStatus === 'failed') await q.docs[0].ref.update({ status: 'failed' });
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('webhook error', e);
    res.status(200).json({ status: 'error' }); // ack anyway, provider will retry otherwise
  }
});

// ── WALLET: WITHDRAWAL ──
const _completingWithdrawals = new Set();
app.post('/withdraw/request', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const { amount, phone } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt < MIN_WITHDRAWAL || amt % WITHDRAW_STEP !== 0)
    return res.status(400).json({ status: 'error', message: `Minimum withdrawal is ${fmtUGX(MIN_WITHDRAWAL)}, in multiples of ${fmtUGX(WITHDRAW_STEP)}` });

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'Profile not found' });
  const user = userSnap.data();
  const sett = await getSettings();
  const feeRate = sett.liquidityFee ?? LIQUIDITY_FEE;
  const fee = Math.round(amt * feeRate);
  const payout = amt - fee;
  if ((user.walletBalance || 0) < amt) return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });

  try {
    await userRef.update({ walletBalance: FieldValue.increment(-amt) });
    const witRef = await db.collection('withdrawals').add({
      userId: uid, amount: amt, fee, payout, phone: cleanPhone(phone), status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ status: 'success', withdrawalId: witRef.id, payout });
  } catch (e) {
    console.error('withdraw request error', e);
    res.status(500).json({ status: 'error', message: 'Withdrawal request failed' });
  }
});

// ── GIFT CODES ──
app.post('/giftcode/redeem', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  const code = String(req.body?.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a code' });
  const giftRef = db.collection('giftcodes').doc(code);
  const giftSnap = await giftRef.get();
  if (!giftSnap.exists || giftSnap.data().used) return res.status(400).json({ status: 'error', message: 'Invalid or already-used code' });
  const gift = giftSnap.data();
  await giftRef.update({ used: true, usedBy: uid, usedAt: FieldValue.serverTimestamp() });
  await db.collection('users').doc(uid).update({ walletBalance: FieldValue.increment(gift.amount) });
  await db.collection('ledger').add({
    userId: uid, type: 'gift_code', amount: gift.amount, description: 'Gift code redeemed', createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ status: 'success', amount: gift.amount });
});

// ══════════════════════════════ ADMIN ══════════════════════════════
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}
app.post('/admin/check-key', (req, res) => {
  const key = req.body?.key || '';
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  res.json({ status: 'success' });
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  const q = await db.collection('users').orderBy('createdAt', 'desc').get();
  res.json({ status: 'success', users: q.docs.map(d => ({ id: d.id, ...d.data() })), count: q.size });
});

app.post('/admin/users/:id/adjust', requireAdmin, async (req, res) => {
  const amt = Number(req.body?.amount);
  if (!amt) return res.status(400).json({ status: 'error', message: 'amount required' });
  await db.collection('users').doc(req.params.id).update({ walletBalance: FieldValue.increment(amt) });
  await db.collection('ledger').add({
    userId: req.params.id, type: 'admin_adjustment', amount: amt,
    description: 'Admin credit', createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ status: 'success' });
});

app.get('/admin/deposits', requireAdmin, async (req, res) => {
  const q = await db.collection('deposits').orderBy('createdAt', 'desc').limit(200).get();
  res.json({ status: 'success', deposits: q.docs.map(d => ({ id: d.id, ...d.data() })) });
});

app.get('/admin/withdrawals', requireAdmin, async (req, res) => {
  const q = await db.collection('withdrawals').orderBy('createdAt', 'desc').limit(200).get();
  res.json({ status: 'success', withdrawals: q.docs.map(d => ({ id: d.id, ...d.data() })) });
});

app.post('/admin/withdrawals/:id/approve', requireAdmin, async (req, res) => {
  const witDoc = await db.collection('withdrawals').doc(req.params.id).get();
  if (!witDoc.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
  if (_completingWithdrawals.has(witDoc.id)) return res.status(429).json({ status: 'error', message: 'Already processing' });
  _completingWithdrawals.add(witDoc.id);
  try {
    const wit = witDoc.data();
    if (wit.status !== 'pending') return res.status(400).json({ status: 'error', message: `Already ${wit.status}` });
    const reference = uuidv4();
    const mpData = await marzSendMoney({ amount: wit.payout, phone: wit.phone, reference, description: 'Novera payout' });
    const uuid = mpData?.data?.transaction?.uuid || mpData?.transaction?.uuid || null;
    if (!uuid) {
      return res.status(502).json({ status: 'error', message: PROVIDER_BUSY_MSG });
    }
    await witDoc.ref.update({ status: 'processing', marzUuid: uuid, processedAt: FieldValue.serverTimestamp() });
    res.json({ status: 'success' });
  } finally {
    _completingWithdrawals.delete(witDoc.id);
  }
});

app.post('/admin/withdrawals/:id/reject', requireAdmin, async (req, res) => {
  const witDoc = await db.collection('withdrawals').doc(req.params.id).get();
  if (!witDoc.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
  const wit = witDoc.data();
  if (wit.status !== 'pending') return res.status(400).json({ status: 'error', message: `Already ${wit.status}` });
  await db.collection('users').doc(wit.userId).update({ walletBalance: FieldValue.increment(wit.amount) }); // refund
  await witDoc.ref.update({ status: 'rejected', rejectedAt: FieldValue.serverTimestamp() });
  res.json({ status: 'success' });
});

app.get('/admin/settings', requireAdmin, async (req, res) => {
  res.json({ status: 'success', settings: await getSettings() });
});
app.post('/admin/settings', requireAdmin, async (req, res) => {
  await db.collection('settings').doc('main').set(req.body || {}, { merge: true });
  res.json({ status: 'success' });
});

app.post('/admin/giftcodes/create', requireAdmin, async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!amount) return res.status(400).json({ status: 'error', message: 'amount required' });
  let code;
  for (let i = 0; i < 10; i++) {
    code = randChars(4);
    const exists = await db.collection('giftcodes').doc(code).get();
    if (!exists.exists) break;
  }
  await db.collection('giftcodes').doc(code).set({ amount, used: false, createdAt: FieldValue.serverTimestamp() });
  res.json({ status: 'success', code });
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Novera API' }));

// ── BOOTSTRAP ──
const PORT = process.env.PORT || 3000;
connectMongo(process.env.MONGODB_URI).then(() => {
  app.listen(PORT, () => console.log(`🚀 Novera server listening on :${PORT}`));
}).catch(e => {
  console.error('❌ MongoDB connection failed:', e.message);
  process.exit(1);
});
