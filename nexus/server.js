const express = require('express');
const axios   = require('axios');
const admin   = require('firebase-admin');
const cors    = require('cors');
const crypto  = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

// ── FIREBASE ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT invalid:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db         = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── CONFIG ──
const MARZ_BASE   = 'https://wallet.wearemarz.com/api/v1';
const MARZ_AUTH   = process.env.MARZ_AUTH || process.env.MARZ_API_KEY || '';
const RAILWAY_URL = (process.env.RAILWAY_URL || '').replace(/\/$/, '');
const ADMIN_KEY   = process.env.ADMIN_KEY   || '';

const MIN_DEPOSIT    = 30000;
const MIN_WITHDRAWAL = 15000;
const CHECKIN_BONUS  = 500;
const COMM_L1        = 0.35;
const COMM_L2        = 0.05;
const COMM_L3        = 0.02;

// ── MAINTENANCE — cached, refreshed every 60 s ──
let _maintenance = false, _maintChecked = 0;
async function isMaintenanceOn() {
  if (Date.now() - _maintChecked < 60000) return _maintenance;
  try {
    const snap = await db.collection('settings').doc('main').get();
    _maintenance = snap.exists && !!snap.data().maintenanceMode;
  } catch (_) {}
  _maintChecked = Date.now();
  return _maintenance;
}
const BYPASS = ['/', '/callback', '/deposit/callback', '/withdraw/callback',
  '/withdraw/approve', '/withdraw/reject', '/admin'];
app.use(async (req, res, next) => {
  const p = req.path;
  if (BYPASS.some(b => p === b || p.startsWith(b + '/'))) return next();
  if (await isMaintenanceOn())
    return res.status(503).json({ status: 'error', maintenance: true,
      message: 'Nexus is under maintenance. Please check back shortly. ◈' });
  next();
});

// ── HELPERS ──
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.randomBytes(1)[0] & 15;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function fmtUGX(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function hashPin(pin) { return crypto.createHash('sha256').update(String(pin) + 'nexus_salt_2026').digest('hex'); }
function eatNow() { return new Date(Date.now() + 3 * 60 * 60 * 1000); }
function nowStr() {
  const d    = eatNow();
  const pad  = n => String(n).padStart(2, '0');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const date = days[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const hh   = d.getUTCHours(), ampm = hh >= 12 ? 'PM' : 'AM';
  const time = pad(hh % 12 || 12) + ':' + pad(d.getUTCMinutes()) + ' ' + ampm;
  return { date, time, iso: new Date().toISOString() };
}
function cleanPhone(phone) {
  const s = String(phone || '').replace(/\s+/g, '').replace(/^\+/, '');
  if (s.startsWith('256')) return '+' + s;
  if (s.startsWith('0'))   return '+256' + s.slice(1);
  if (s.length === 9)      return '+256' + s;
  return '+' + s;
}
async function notify(userId, title, message, type, extras = {}) {
  const { date, time } = nowStr();
  await db.collection('notifications').add({
    userId, title, message, type,
    readBy: [], details: { ...extras, date, time },
    date, time, createdAt: FieldValue.serverTimestamp()
  });
}

// ── MARZIPAY ──
async function marzCollect({ amount, phone, reference, callbackUrl }) {
  const resp = await axios.post(`${MARZ_BASE}/collect-money`, {
    amount: Number(amount), phone_number: cleanPhone(phone),
    country: 'UG', reference,
    description: 'Nexus Investment Deposit',
    ...(callbackUrl ? { callback_url: callbackUrl } : {})
  }, { headers: { Authorization: `Basic ${MARZ_AUTH}`, 'Content-Type': 'application/json' }, timeout: 30000 });
  return resp.data;
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl }) {
  const resp = await axios.post(`${MARZ_BASE}/send-money`, {
    amount: Number(amount), phone_number: cleanPhone(phone),
    country: 'UG', reference, description: description || 'Nexus Withdrawal',
    ...(callbackUrl ? { callback_url: callbackUrl } : {})
  }, { headers: { Authorization: `Basic ${MARZ_AUTH}`, 'Content-Type': 'application/json' }, timeout: 30000 });
  return resp.data;
}
async function marzVerifyPhone(phone) {
  const resp = await axios.post(`${MARZ_BASE}/phone-verification/verify`,
    { phone_number: cleanPhone(phone).replace('+', '') },
    { headers: { 'Content-Type': 'application/json', Authorization: `Basic ${MARZ_AUTH}` }, timeout: 15000 });
  return resp.data;
}

// ═══════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════
app.get('/', (req, res) => res.json({
  status: '◈ Nexus Investment Server', time: new Date().toISOString(), version: '1.0'
}));

// ═══════════════════════════════════════════
// PHONE VERIFICATION
// ═══════════════════════════════════════════
app.post('/verify-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });
  try {
    const data = await marzVerifyPhone(phone);
    return res.json({ success: data.success, name: data.data?.full_name || '', phone: data.data?.phone_number || phone });
  } catch (e) {
    return res.json({ success: false, message: e.response?.data?.message || e.message });
  }
});

// ═══════════════════════════════════════════
// PIN
// ═══════════════════════════════════════════
app.post('/pin/set', async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin || !/^\d{4}$/.test(String(pin)))
    return res.status(400).json({ status: 'error', message: 'Valid 4-digit PIN required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await db.collection('users').doc(userId).update({ withdrawalPin: hashPin(pin), pinSetAt: FieldValue.serverTimestamp() });
    return res.json({ status: 'success', message: 'PIN set successfully' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/pin/verify', async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin) return res.status(400).json({ status: 'error', valid: false });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', valid: false });
    const stored = snap.data().withdrawalPin;
    if (!stored) return res.json({ status: 'no_pin', valid: false, needsSetup: true });
    return res.json({ status: 'success', valid: stored === hashPin(pin) });
  } catch (e) { return res.status(500).json({ status: 'error', valid: false }); }
});

// ═══════════════════════════════════════════
// REGISTRATION — sets up referral chain
// Called by frontend after Firebase user is created
// ═══════════════════════════════════════════
app.post('/register', async (req, res) => {
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().registrationDone)
      return res.json({ status: 'already_done' });

    let referrerId = null;
    if (referralCode) {
      const refSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase()).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== userId) {
        referrerId = refSnap.docs[0].id;
      }
    }

    const WELCOME_BONUS = 10000;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true };

    // Credit UGX 10,000 welcome bonus
    batch.update(userRef, { walletBalance: FieldValue.increment(WELCOME_BONUS) });
    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit',
      description: 'Welcome bonus — new account',
      amount: WELCOME_BONUS, status: 'success', date, time,
      createdAt: FieldValue.serverTimestamp()
    });
    batch.set(db.collection('notifications').doc(), {
      userId, title: '🎉 Welcome to Nexus!',
      message: `${fmtUGX(WELCOME_BONUS)} welcome bonus has been credited to your account!\n\nStart investing in a plan to earn daily returns.\n\n📅 ${date}\n⏰ ${time}\n\n◈ Nexus Investment Platform`,
      type: 'admin_credit', amount: WELCOME_BONUS, date, time,
      readBy: [], createdAt: FieldValue.serverTimestamp()
    });

    if (referrerId) {
      update.referredBy = referrerId;
      // L1 referrer count
      batch.update(db.collection('users').doc(referrerId), {
        teamL1Count: FieldValue.increment(1)
      });
      // L2
      const l1Snap = await db.collection('users').doc(referrerId).get();
      const l2Id   = l1Snap.exists ? l1Snap.data().referredBy : null;
      if (l2Id && l2Id !== referrerId) {
        batch.update(db.collection('users').doc(l2Id), { teamL2Count: FieldValue.increment(1) });
        // L3
        const l2Snap = await db.collection('users').doc(l2Id).get();
        const l3Id   = l2Snap.exists ? l2Snap.data().referredBy : null;
        if (l3Id && l3Id !== l2Id && l3Id !== referrerId) {
          batch.update(db.collection('users').doc(l3Id), { teamL3Count: FieldValue.increment(1) });
        }
      }
      // Referral doc
      batch.set(db.collection('referrals').doc(), {
        referrerId, referredUserId: userId,
        createdAt: FieldValue.serverTimestamp()
      });
    }
    batch.update(userRef, update);
    await batch.commit();
    return res.json({ status: 'success', referrerId });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// COMMISSIONS — paid on every investment
// L1 = 35% of investment | L2 = 5% | L3 = 2%
// ═══════════════════════════════════════════
async function payCommissions(investorId, amount) {
  const { date, time } = nowStr();
  try {
    const invSnap = await db.collection('users').doc(investorId).get();
    if (!invSnap.exists) return;
    const investor = invSnap.data();
    const l1Id = investor.referredBy;
    if (!l1Id || l1Id === investorId) return;

    // L1
    const l1Snap = await db.collection('users').doc(l1Id).get();
    if (!l1Snap.exists) return;
    const l1Amt = Math.round(amount * COMM_L1);
    if (l1Amt > 0) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l1Id);
        const f   = await t.get(ref);
        t.update(ref, {
          walletBalance:      (f.data().walletBalance || 0) + l1Amt,
          commissionEarned:   FieldValue.increment(l1Amt),
          commissionL1Earned: FieldValue.increment(l1Amt)
        });
        t.set(db.collection('transactions').doc(), {
          userId: l1Id, type: 'commission',
          description: `L1 commission — ${investor.name || investor.phone} invested ${fmtUGX(amount)}`,
          amount: l1Amt, level: 1, fromUserId: investorId,
          status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l1Id, title: '💰 Commission Earned!',
          message: `${investor.name || 'Your referral'} invested ${fmtUGX(amount)}!\n\nYou earned 35% = ${fmtUGX(l1Amt)} commission.\n\n📅 ${date}\n⏰ ${time}\n\nFunds are in your wallet — withdraw anytime! ◈`,
          type: 'commission', amount: l1Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`✅ L1 commission: ${fmtUGX(l1Amt)} → ${l1Id}`);
    }

    // L2
    const l2Id = l1Snap.data().referredBy;
    if (!l2Id || l2Id === l1Id || l2Id === investorId) return;
    const l2Snap = await db.collection('users').doc(l2Id).get();
    if (!l2Snap.exists) return;
    const l2Amt = Math.round(amount * COMM_L2);
    if (l2Amt > 0) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l2Id);
        const f   = await t.get(ref);
        t.update(ref, {
          walletBalance:      (f.data().walletBalance || 0) + l2Amt,
          commissionEarned:   FieldValue.increment(l2Amt),
          commissionL2Earned: FieldValue.increment(l2Amt)
        });
        t.set(db.collection('transactions').doc(), {
          userId: l2Id, type: 'commission',
          description: `L2 commission — team investment ${fmtUGX(amount)}`,
          amount: l2Amt, level: 2, fromUserId: investorId,
          status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l2Id, title: '💰 Team Commission!',
          message: `A Level 2 team member invested ${fmtUGX(amount)}!\n\nYou earned 5% = ${fmtUGX(l2Amt)}.\n\n📅 ${date}\n⏰ ${time}`,
          type: 'commission', amount: l2Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`✅ L2 commission: ${fmtUGX(l2Amt)} → ${l2Id}`);
    }

    // L3
    const l3Id = l2Snap.data().referredBy;
    if (!l3Id || l3Id === l2Id || l3Id === l1Id || l3Id === investorId) return;
    const l3Amt = Math.round(amount * COMM_L3);
    if (l3Amt > 0) {
      const l3Snap = await db.collection('users').doc(l3Id).get();
      if (!l3Snap.exists) return;
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l3Id);
        const f   = await t.get(ref);
        t.update(ref, {
          walletBalance:      (f.data().walletBalance || 0) + l3Amt,
          commissionEarned:   FieldValue.increment(l3Amt),
          commissionL3Earned: FieldValue.increment(l3Amt)
        });
        t.set(db.collection('transactions').doc(), {
          userId: l3Id, type: 'commission',
          description: `L3 commission — team investment ${fmtUGX(amount)}`,
          amount: l3Amt, level: 3, fromUserId: investorId,
          status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l3Id, title: '💰 Team Commission!',
          message: `A Level 3 team member invested ${fmtUGX(amount)}!\n\nYou earned 2% = ${fmtUGX(l3Amt)}.\n\n📅 ${date}\n⏰ ${time}`,
          type: 'commission', amount: l3Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`✅ L3 commission: ${fmtUGX(l3Amt)} → ${l3Id}`);
    }
  } catch (e) { console.error('payCommissions error:', e.message); }
}

// ═══════════════════════════════════════════
// INVESTMENT — create + claim
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const { userId, productId } = req.body;
  if (!userId || !productId)
    return res.status(400).json({ status: 'error', message: 'userId and productId required' });
  try {
    const [uSnap, pSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('products').doc(productId).get()
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (!pSnap.exists) return res.status(404).json({ status: 'error', message: 'Product not found' });
    const user    = uSnap.data();
    const product = pSnap.data();
    if (user.status === 'banned')  return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if (!product.active)           return res.status(400).json({ status: 'error', message: 'Product not available' });
    if (!product.isInStock)        return res.status(400).json({ status: 'error', message: 'This plan is currently sold out' });
    const price = product.price || 0;
    if ((user.walletBalance || 0) < price)
      return res.status(400).json({ status: 'error',
        message: `Insufficient balance. Need ${fmtUGX(price)}, available ${fmtUGX(user.walletBalance || 0)}` });
    const { date, time } = nowStr();
    const matDate = new Date();
    matDate.setDate(matDate.getDate() + (product.cycle || 1));
    let invId;
    await db.runTransaction(async t => {
      const uRef    = db.collection('users').doc(userId);
      const fresh   = await t.get(uRef);
      const freshBal = fresh.data().walletBalance || 0;
      if (freshBal < price) throw new Error(`Insufficient balance: need ${fmtUGX(price)}, have ${fmtUGX(freshBal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      t.update(uRef, {
        walletBalance: freshBal - price,
        totalInvested: FieldValue.increment(price)
      });
      t.set(invRef, {
        userId, productId, productName: product.name,
        productImage: product.image || '',
        amount: price, dailyReturn: product.dailyReturn || 0,
        cycle: product.cycle || 1,
        expectedReturn: product.expectedReturn || price,
        status: 'active',
        maturityDate: admin.firestore.Timestamp.fromDate(matDate),
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment',
        description: `Invested in ${product.name}`,
        amount: -price, status: 'success', date, time,
        investmentId: invId, productId, createdAt: FieldValue.serverTimestamp()
      });
    });
    payCommissions(userId, price).catch(e => console.error('Commission error:', e.message));
    console.log(`✅ Investment: ${invId} — ${fmtUGX(price)} — ${userId}`);
    return res.json({ status: 'success', investmentId: invId,
      message: `Successfully invested ${fmtUGX(price)} in ${product.name}` });
  } catch (e) {
    console.error('Invest create error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/invest/claim', async (req, res) => {
  const { userId, investmentId } = req.body;
  if (!userId || !investmentId)
    return res.status(400).json({ status: 'error', message: 'userId and investmentId required' });
  try {
    const invRef  = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ status: 'error', message: 'Investment not found' });
    const inv = invSnap.data();
    if (inv.userId !== userId) return res.status(403).json({ status: 'error', message: 'Not your investment' });
    if (inv.status !== 'matured')
      return res.status(400).json({ status: 'error', message: 'Cannot claim — status is ' + inv.status });
    const payout = inv.expectedReturn || 0;
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, {
        walletBalance: (uSnap.data().walletBalance || 0) + payout,
        totalEarned:   FieldValue.increment(payout)
      });
      t.update(invRef, { status: 'claimed', claimedAt: FieldValue.serverTimestamp() });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment_return',
        description: `Returns claimed — ${inv.productName || 'Investment'}`,
        amount: payout, status: 'success', date, time,
        investmentId, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('notifications').doc(), {
        userId, title: '✅ Returns Claimed!',
        message: `${fmtUGX(payout)} from your ${inv.productName || 'investment'} has been credited to your wallet.\n\n📅 ${date}\n⏰ ${time}`,
        type: 'investment_return', amount: payout, date, time,
        readBy: [], createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`✅ Claimed: ${investmentId} — ${fmtUGX(payout)} → ${userId}`);
    return res.json({ status: 'success', payout, message: `${fmtUGX(payout)} credited to wallet` });
  } catch (e) {
    console.error('Claim error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// DEPOSITS
// ═══════════════════════════════════════════
app.post('/collect', async (req, res) => {
  const { userId, amount, phone } = req.body;
  if (!userId || !amount || !phone)
    return res.status(400).json({ status: 'error', message: 'userId, amount and phone required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < MIN_DEPOSIT || amt > 10000000)
    return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(MIN_DEPOSIT)}` });
  const fullPhone = cleanPhone(phone);
  const reference = uuidv4();
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const depRef     = db.collection('deposits').doc();
    const pendingRef = db.collection('pendingPayments').doc(reference);
    const batch      = db.batch();
    batch.set(depRef, {
      userId, amount: amt, phone: fullPhone, reference,
      status: 'pending', type: 'mobile_money', createdAt: FieldValue.serverTimestamp()
    });
    batch.set(pendingRef, {
      userId, amount: amt, phone: fullPhone,
      depositId: depRef.id, status: 'pending', createdAt: FieldValue.serverTimestamp()
    });
    await batch.commit();
    let marzData;
    try {
      marzData = await marzCollect({ amount: amt, phone: fullPhone, reference,
        callbackUrl: `${RAILWAY_URL}/callback` });
    } catch (marzErr) {
      const errMsg = marzErr.response?.data?.message || marzErr.message;
      console.error('❌ Marz collect error:', errMsg);
      await Promise.all([
        depRef.update({ status: 'marz_error', error: errMsg }),
        pendingRef.update({ status: 'failed', failReason: 'Payment gateway: ' + errMsg })
      ]);
      return res.status(502).json({ status: 'error', message: 'Payment gateway: ' + errMsg });
    }
    const marzUuid = marzData?.data?.transaction?.uuid || '';
    await Promise.all([
      depRef.update({ marzTxId: marzUuid, status: 'processing' }),
      pendingRef.update({ marzTxId: marzUuid, status: 'processing' })
    ]);
    console.log(`📤 Collect: ${reference} | ${fmtUGX(amt)} | ${fullPhone}`);
    return res.json({ status: 'success', reference, depositId: depRef.id, marz: marzData });
  } catch (e) {
    console.error('Collect error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

async function handleDepositCallback(req, res) {
  const payload = req.body;
  console.log('📩 Deposit callback:', JSON.stringify(payload));
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      const reference = payload.reference || payload.transaction?.reference || payload.data?.transaction?.reference;
      const rawStatus = (() => {
        const s = (payload.status || payload.transaction?.status || payload.data?.transaction?.status || '').toLowerCase();
        if (s) return s;
        if (payload.event_type === 'collection.successful') return 'successful';
        if (payload.event_type === 'collection.failed')    return 'failed';
        return '';
      })();
      const isSuccess = ['successful','success','completed','paid'].includes(rawStatus);
      const isFailed  = ['failed','cancelled','error','declined'].includes(rawStatus);
      const callbackAmt = parseFloat(payload.amount || payload.collection?.amount?.raw || 0);
      const phone    = payload.phone_number || payload.transaction?.phone_number || payload.collection?.phone_number || null;
      const txId     = payload.transaction?.uuid || payload.data?.transaction?.uuid || '';
      const provider = payload.collection?.provider || payload.data?.collection?.provider || 'Mobile Money';
      if (!reference) { console.log('❌ No reference in callback'); return; }
      const pendSnap = await db.collection('pendingPayments').doc(reference).get();
      if (!pendSnap.exists) { console.log('❌ No pending payment:', reference); return; }
      const pend = pendSnap.data();
      if (pend.status === 'success') return;
      const userId = pend.userId;
      const credit = (callbackAmt > 0 && callbackAmt <= pend.amount * 1.01) ? callbackAmt : pend.amount;
      if (isSuccess) {
        const { date, time } = nowStr();
        await db.runTransaction(async t => {
          const uRef  = db.collection('users').doc(userId);
          const uSnap = await t.get(uRef);
          if (!uSnap.exists) throw new Error('User not found');
          t.update(uRef, {
            walletBalance: (uSnap.data().walletBalance || 0) + credit,
            totalDeposited: FieldValue.increment(credit)
          });
          if (pend.depositId)
            t.update(db.collection('deposits').doc(pend.depositId), {
              status: 'success', amountCredited: credit, marzTxId: txId,
              phone: phone || pend.phone, provider, paidAt: FieldValue.serverTimestamp()
            });
          t.update(db.collection('pendingPayments').doc(reference), {
            status: 'success', amountCredited: credit, processedAt: FieldValue.serverTimestamp()
          });
          t.set(db.collection('transactions').doc(), {
            userId, type: 'deposit', description: `Deposit via ${provider}`,
            amount: credit, phone: phone || pend.phone || '', reference,
            marzTxId: txId, provider, status: 'success', date, time,
            createdAt: FieldValue.serverTimestamp()
          });
          t.set(db.collection('notifications').doc(), {
            userId, title: '✅ Deposit Successful!',
            message: `${fmtUGX(credit)} has been credited to your wallet.\n\n📅 ${date}\n⏰ ${time}\n📱 ${phone || pend.phone}\n🔖 Ref: ${reference}\n\nThank you for investing with Nexus! ◈`,
            type: 'deposit', amount: credit, reference, provider, date, time,
            readBy: [], createdAt: FieldValue.serverTimestamp()
          });
        });
        console.log(`✅ Credited ${fmtUGX(credit)} to ${userId}`);
      } else if (isFailed) {
        const failReason = payload.transaction?.description || rawStatus || 'Payment declined';
        const batch = db.batch();
        batch.update(db.collection('pendingPayments').doc(reference), {
          status: 'failed', failReason, failedAt: FieldValue.serverTimestamp()
        });
        if (pend.depositId)
          batch.update(db.collection('deposits').doc(pend.depositId), { status: 'failed', failReason });
        await batch.commit();
        await notify(userId, '❌ Deposit Failed',
          `Your deposit of ${fmtUGX(pend.amount)} could not be processed.\n\nReason: ${failReason}\n\nNo money was deducted from your account. Please try again.`,
          'deposit_failed', { reference, amount: pend.amount });
      }
    } catch (e) { console.error('❌ Callback error:', e.message); }
  });
}
app.post('/callback', handleDepositCallback);
app.post('/deposit/callback', handleDepositCallback);

app.get('/check/:reference', async (req, res) => {
  try {
    const snap = await db.collection('pendingPayments').doc(req.params.reference).get();
    if (!snap.exists) return res.json({ status: 'not_found' });
    const d = snap.data();
    return res.json({ status: d.status, amount: d.amount, amountCredited: d.amountCredited || 0, failReason: d.failReason || null });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// WITHDRAWALS
// ═══════════════════════════════════════════
app.post('/withdraw/request', async (req, res) => {
  const { userId, amount, phone, pin } = req.body;
  if (!userId || !amount || !phone || !pin)
    return res.status(400).json({ status: 'error', message: 'userId, amount, phone and PIN required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < MIN_WITHDRAWAL)
    return res.status(400).json({ status: 'error', message: `Minimum withdrawal is ${fmtUGX(MIN_WITHDRAWAL)}` });
  const fullPhone = cleanPhone(phone);
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if (!user.withdrawalPin) return res.status(400).json({ status: 'error', message: 'No PIN set. Set your withdrawal PIN first.', needsPin: true });

    // PIN brute-force protection
    const MAX_ATTEMPTS = 10, LOCK_MS = 60 * 60 * 1000;
    const attempts = user.pinAttempts || 0;
    const lockUntil = user.pinLockUntil?.toDate?.() || null;
    if (lockUntil && lockUntil > new Date()) {
      const mins = Math.ceil((lockUntil - new Date()) / 60000);
      return res.status(429).json({ status: 'error', message: `Account locked. Try again in ${mins} minute(s).` });
    }
    if (user.withdrawalPin !== hashPin(pin)) {
      const newAtt = attempts + 1;
      const remaining = MAX_ATTEMPTS - newAtt;
      const upd = { pinAttempts: newAtt };
      if (newAtt >= MAX_ATTEMPTS) {
        upd.pinLockUntil = new Date(Date.now() + LOCK_MS);
        upd.pinAttempts  = 0;
        await db.collection('users').doc(userId).update(upd);
        return res.status(429).json({ status: 'error', message: `Too many wrong attempts. Account locked for 1 hour.` });
      }
      await db.collection('users').doc(userId).update(upd);
      return res.status(400).json({ status: 'error', message: `Incorrect PIN. ${remaining} attempt(s) remaining.`, attemptsLeft: remaining });
    }
    if (attempts > 0 || lockUntil)
      await db.collection('users').doc(userId).update({ pinAttempts: 0, pinLockUntil: null });

    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    const witCount  = user.withdrawalCount || 0;
    const isTop     = user.isTopInvestor   || false;
    const fee       = (witCount === 0 || isTop) ? 0 : Math.round(amt * 0.17); // 17% liquidity fee
    const netAmount = amt - fee;
    const reference = uuidv4();
    let witId;
    await db.runTransaction(async t => {
      const uRef    = db.collection('users').doc(userId);
      const fresh   = await t.get(uRef);
      const freshBal = fresh.data().walletBalance || 0;
      if (freshBal < amt) throw new Error(`Insufficient balance: ${fmtUGX(freshBal)}`);
      t.update(uRef, {
        walletBalance:   freshBal - amt,
        withdrawalCount: (fresh.data().withdrawalCount || 0) + 1
      });
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      const { date, time } = nowStr();
      t.set(witRef, {
        userId, userName: user.name || '', userPhone: user.phone || '',
        withdrawalPhone: fullPhone, amount: amt, fee, netAmount, reference,
        status: 'pending', isTopInvestor: isTop, date, time,
        createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdrawal',
        description: 'Withdrawal request (pending approval)',
        amount: -amt, fee, netAmount, reference, phone: fullPhone,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`📋 Withdrawal ${witId} queued`);
    return res.json({ status: 'success', withdrawalId: witId, reference, netAmount, fee,
      message: 'Withdrawal submitted. Pending admin approval.' });
  } catch (e) {
    console.error('Withdrawal error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/withdraw/approve', async (req, res) => {
  const { withdrawalId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const wit = witSnap.data();
    if (wit.status !== 'pending')
      return res.status(400).json({ status: 'error', message: `Already ${wit.status}` });
    await db.collection('withdrawals').doc(withdrawalId).update({ status: 'processing', approvedAt: FieldValue.serverTimestamp() });
    let marzData;
    try {
      marzData = await marzSendMoney({
        amount: wit.netAmount, phone: wit.withdrawalPhone,
        reference: wit.reference,
        description: `Nexus Withdrawal — ${wit.userName || 'user'}`,
        callbackUrl: `${RAILWAY_URL}/withdraw/callback`
      });
    } catch (marzErr) {
      const errMsg = marzErr.response?.data?.message || marzErr.message;
      await processWithdrawFail(withdrawalId, wit, 'Marzipay: ' + errMsg);
      return res.status(502).json({ status: 'error', message: errMsg });
    }
    const marzStatus = (marzData?.data?.transaction?.status || '').toLowerCase();
    const marzTxUuid = marzData?.data?.transaction?.uuid || '';
    const isOk = ['success','successful','completed'].includes(marzStatus);
    const isProcessing = ['processing','pending','queued'].includes(marzStatus) || marzTxUuid;
    if (!isOk && !isProcessing) {
      await processWithdrawFail(withdrawalId, wit, 'Marzipay declined: ' + (marzStatus || 'unknown'));
      return res.json({ status: 'failed', message: 'Marzipay declined', marz: marzData });
    }
    if (isOk) {
      await processWithdrawSuccess(withdrawalId, wit, marzData);
      return res.json({ status: 'success', message: 'Payout sent', marz: marzData });
    }
    const { date, time } = nowStr();
    await db.collection('withdrawals').doc(withdrawalId).update({ status: 'processing', marzTxId: marzTxUuid, approvedAt: FieldValue.serverTimestamp() });
    await notify(wit.userId, '⏳ Withdrawal Processing',
      `Your withdrawal of ${fmtUGX(wit.netAmount)} is being sent to ${wit.withdrawalPhone}.\n\n📅 ${date}\n⏰ ${time}\n🔖 Ref: ${wit.reference}`,
      'withdrawal', { amount: wit.netAmount, phone: wit.withdrawalPhone, date, time });
    return res.json({ status: 'success', message: 'Payout processing', marz: marzData });
  } catch (e) {
    console.error('Approve error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

async function processWithdrawSuccess(witId, wit, marzData) {
  const { date, time } = nowStr();
  const marzTxId = marzData?.transaction?.uuid || marzData?.data?.transaction?.uuid || '';
  const recipientName = marzData?.transaction?.recipient_name || wit.userName || 'Customer';
  await db.collection('withdrawals').doc(witId).update({
    status: 'processed', marzTxId, recipientName, processedAt: FieldValue.serverTimestamp()
  });
  await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.amount) });
  const txSnap = await db.collection('transactions').where('reference', '==', wit.reference).limit(1).get();
  if (!txSnap.empty) txSnap.docs[0].ref.update({ status: 'success', date, time });
  const feeNote = wit.fee > 0 ? `\n💸 Fee: ${fmtUGX(wit.fee)}` : '';
  await notify(wit.userId, '✅ Withdrawal Successful!',
    `Your withdrawal has been processed!\n\n👤 ${recipientName}\n📱 ${wit.withdrawalPhone}\n💰 ${fmtUGX(wit.netAmount)}${feeNote}\n📅 ${date}\n⏰ ${time}\n🔖 Ref: ${wit.reference}\n\nThank you for using Nexus! ◈`,
    'withdrawal', { amount: wit.netAmount, date, time });
}

async function processWithdrawFail(witId, wit, reason) {
  await db.collection('withdrawals').doc(witId).update({
    status: 'failed', failReason: reason, failedAt: FieldValue.serverTimestamp()
  });
  await db.collection('users').doc(wit.userId).update({
    walletBalance:   FieldValue.increment(wit.amount),
    withdrawalCount: FieldValue.increment(-1)
  });
  const txSnap = await db.collection('transactions').where('reference', '==', wit.reference).limit(1).get();
  if (!txSnap.empty) txSnap.docs[0].ref.update({ status: 'failed' });
  await notify(wit.userId, '❌ Withdrawal Failed',
    `Your withdrawal of ${fmtUGX(wit.amount)} could not be processed.\n\n${fmtUGX(wit.amount)} has been refunded.\n\nReason: ${reason}`,
    'withdrawal_failed', { amount: wit.amount, reference: wit.reference });
}

app.post('/withdraw/callback', async (req, res) => {
  console.log('💸 Withdrawal callback:', JSON.stringify(req.body));
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      const payload = req.body;
      const reference = payload.reference || payload.transaction?.provider_reference || payload.transaction?.reference;
      const rawStatus = (() => {
        const s = (payload.status || payload.transaction?.status || '').toLowerCase();
        if (s) return s;
        if (payload.event_type === 'disbursement.completed') return 'completed';
        if (payload.event_type === 'disbursement.failed')   return 'failed';
        return '';
      })();
      if (!reference) return;
      const witSnap = await db.collection('withdrawals').where('reference', '==', reference).limit(1).get();
      if (witSnap.empty) return;
      const witDoc = witSnap.docs[0];
      const wit    = witDoc.data();
      if (['success','successful','completed'].includes(rawStatus) && wit.status !== 'processed')
        await processWithdrawSuccess(witDoc.id, wit, payload);
      if (['failed','declined','cancelled','error'].includes(rawStatus) && !['failed','processed'].includes(wit.status))
        await processWithdrawFail(witDoc.id, wit, payload.transaction?.description || rawStatus || 'Declined');
    } catch (e) { console.error('Withdrawal callback error:', e.message); }
  });
});

app.post('/withdraw/reject', async (req, res) => {
  const { withdrawalId, adminKey, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const wit = snap.data();
    if (['processed','failed'].includes(wit.status))
      return res.status(400).json({ status: 'error', message: 'Already ' + wit.status });
    await processWithdrawFail(withdrawalId, wit, reason || 'Rejected by admin');
    return res.json({ status: 'success', message: `Rejected. ${fmtUGX(wit.amount)} refunded.` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/withdraw/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('withdrawals').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error' });
    return res.json({ status: 'success', data: { id: snap.id, ...snap.data() } });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// DAILY CHECK-IN
// ═══════════════════════════════════════════
app.post('/checkin', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const settSnap = await db.collection('settings').doc('main').get();
    const bonus    = settSnap.exists ? (settSnap.data().checkinBonus || CHECKIN_BONUS) : CHECKIN_BONUS;
    const uRef  = db.collection('users').doc(userId);
    const uSnap = await uRef.get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const todayKey = eatNow().toISOString().slice(0, 10);
    if (user.lastCheckinDate === todayKey)
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    const { date, time } = nowStr();
    const newStreak = (user.checkinStreak || 0) + 1;
    await db.runTransaction(async t => {
      const fresh = await t.get(uRef);
      if (fresh.data().lastCheckinDate === todayKey) throw new Error('ALREADY_DONE');
      t.update(uRef, {
        walletBalance:   FieldValue.increment(bonus),
        lastCheckinDate: todayKey,
        checkinStreak:   newStreak,
        checkinDays:     FieldValue.increment(1),
        checkinEarned:   FieldValue.increment(bonus)
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'checkin',
        description: `Daily check-in bonus — Day ${newStreak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`✅ Check-in: ${userId} — ${fmtUGX(bonus)} — Day ${newStreak}`);
    return res.json({ status: 'success', bonus, streak: newStreak, message: `${fmtUGX(bonus)} credited!` });
  } catch (e) {
    if (e.message === 'ALREADY_DONE')
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// GIFT CODES
// ═══════════════════════════════════════════
app.post('/giftcode/redeem', async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ status: 'error', message: 'userId and code required' });
  try {
    const codeSnap = await db.collection('giftCodes').where('code', '==', code.toUpperCase().trim()).limit(1).get();
    if (codeSnap.empty) return res.status(404).json({ status: 'error', message: 'Invalid gift code' });
    const codeDoc = codeSnap.docs[0];
    const gc      = codeDoc.data();
    if (!gc.active) return res.status(400).json({ status: 'error', message: 'This gift code is no longer active' });
    if ((gc.usedBy || []).includes(userId)) return res.status(400).json({ status: 'error', message: 'You have already redeemed this code' });
    if (gc.maxUses && (gc.usedBy || []).length >= gc.maxUses) return res.status(400).json({ status: 'error', message: 'This gift code has expired' });
    const { date, time } = nowStr();
    const amount = gc.amount || 0;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: (uSnap.data().walletBalance || 0) + amount });
      t.update(codeDoc.ref, { usedBy: FieldValue.arrayUnion(userId) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'gift_code',
        description: `Gift code redeemed — ${code.toUpperCase()}`,
        amount, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`🎁 Gift code ${code} redeemed by ${userId} — ${fmtUGX(amount)}`);
    return res.json({ status: 'success', amount, message: `${fmtUGX(amount)} credited to your wallet!` });
  } catch (e) {
    console.error('Gift code error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════
app.post('/admin/verify', async (req, res) => {
  const { uid, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.json({ isAdmin: false });
  try {
    const snap = await db.collection('admins').doc(uid).get();
    return res.json({ isAdmin: snap.exists && snap.data()?.active !== false });
  } catch (_) { return res.json({ isAdmin: false }); }
});

app.post('/admin/deposit', async (req, res) => {
  const { userId, amount, note, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!userId || !amount) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  const amt = parseFloat(amount);
  try {
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'Admin credit',
        amount: amt, status: 'success', createdAt: FieldValue.serverTimestamp()
      });
    });
    const { date, time } = nowStr();
    await notify(userId, '💰 Funds Added', `${fmtUGX(amt)} added to your wallet.\n\n📅 ${date}\n⏰ ${time}\n📝 ${note || 'Admin credit'}`, 'deposit', { amount: amt });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/ban', async (req, res) => {
  const { userId, adminKey, action, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const isBan = action === 'ban';
    await db.collection('users').doc(userId).update({
      status:    isBan ? 'banned' : 'active',
      banReason: isBan ? (reason || 'Policy violation') : null,
      bannedAt:  isBan ? FieldValue.serverTimestamp() : null
    });
    await notify(userId,
      isBan ? '🚫 Account Suspended' : '✅ Account Restored',
      isBan ? `Your Nexus account has been suspended.\n\nReason: ${reason || 'Policy violation'}\n\nContact support for assistance.`
            : 'Your Nexus account has been restored. All features are available.',
      isBan ? 'warning' : 'info', {});
    return res.json({ status: 'success', message: `User ${isBan ? 'banned' : 'unbanned'}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/check-maturities', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error' });
  try {
    const count = await runMaturityCheck();
    return res.json({ status: 'success', matured: count });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// CRONS
// ═══════════════════════════════════════════
async function runMaturityCheck() {
  try {
    const now  = new Date();
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    let count = 0;
    const batch = db.batch();
    const notifPs = [];
    snap.forEach(doc => {
      const inv = doc.data();
      const mat = inv.maturityDate?.toDate ? inv.maturityDate.toDate() : null;
      if (mat && mat <= now) {
        batch.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() });
        notifPs.push(notify(inv.userId, '🎉 Plan Matured!',
          `Your ${inv.productName || 'plan'} is ready to claim!\n\n💰 Claim: ${fmtUGX(inv.expectedReturn)}\n\nOpen Nexus to claim your returns. ◈`,
          'investment', { amount: inv.expectedReturn, investmentId: doc.id }));
        count++;
      }
    });
    if (count > 0) { await batch.commit(); await Promise.allSettled(notifPs); }
    if (count > 0) console.log(`⏰ Matured: ${count} plan(s)`);
    return count;
  } catch (e) { console.error('Maturity check error:', e.message); return 0; }
}

async function runStaleDepositCleanup() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await db.collection('pendingPayments').where('status', '==', 'processing').get();
    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const created = d.createdAt?.toDate?.() || null;
      if (!created || created > cutoff) continue;
      const batch = db.batch();
      batch.update(doc.ref, { status: 'failed', failReason: 'Timed out', failedAt: FieldValue.serverTimestamp() });
      if (d.depositId) batch.update(db.collection('deposits').doc(d.depositId), { status: 'failed', failReason: 'Timed out' });
      await batch.commit();
      await notify(d.userId, '⏱️ Deposit Timed Out',
        `Your deposit of ${fmtUGX(d.amount)} did not complete. No funds were deducted. Please try again.`,
        'deposit_failed', { amount: d.amount });
      count++;
    }
    if (count > 0) console.log(`🧹 Stale deposits: ${count}`);
  } catch (e) { console.error('Stale deposit cleanup error:', e.message); }
}

function startCrons() {
  setInterval(runMaturityCheck, 30 * 60 * 1000);
  runMaturityCheck();
  setInterval(runStaleDepositCleanup, 5 * 60 * 1000);
  console.log('⏰ Crons started');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`◈ Nexus Investment Server v1.0 on port ${PORT}`);
  console.log(`  Railway: ${RAILWAY_URL || '(set RAILWAY_URL env)'}`);
  startCrons();
});
