const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));

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
async function marzVerifyPhone(phone) {
  const resp = await axios.post(`${MARZ_BASE}/phone-verification/verify`,
    { phone_number: cleanPhone(phone).replace('+', '') },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${MARZ_AUTH}` }, timeout: 15000 }
  );
  return resp.data;
}

// ── NOTIFICATION HELPER ──
async function notify(userId, title, message, type, extras = {}) {
  const { date, time } = nowStr();
  await db.collection('notifications').add({
    userId, title, message, type,
    readBy: [], details: { ...extras, date, time },
    date, time, createdAt: FieldValue.serverTimestamp()
  });
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
// WITHDRAWAL PIN MANAGEMENT
// ═══════════════════════════════════════════
app.post('/pin/set', async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin || String(pin).length !== 4 || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ status: 'error', message: 'Valid 4-digit PIN required' });
  }
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await db.collection('users').doc(userId).update({ withdrawalPin: hashPin(pin), pinSetAt: FieldValue.serverTimestamp() });
    return res.json({ status: 'success', message: 'PIN set successfully' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// ── Check if user has PIN set ──
app.post('/pin/status', async (req, res) => {
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
app.post('/pin/request-reset', async (req, res) => {
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

app.post('/password/request-reset', async (req, res) => {
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

app.post('/withdraw/request-phone-change', async (req, res) => {
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



app.post('/pin/verify', async (req, res) => {
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
app.post('/collect', async (req, res) => {
  const { userId, amount, phone } = req.body;
  if (!userId || !amount || !phone) return res.status(400).json({ status: 'error', message: 'userId, amount, phone required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 50000 || amt > 200000) return res.status(400).json({ status: 'error', message: 'Amount must be 50,000–200,000 UGX' });
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
        if (payload.event_type === 'collection.successful') return 'successful';
        if (payload.event_type === 'collection.failed') return 'failed';
        return '';
      })();

      const isSuccess = ['successful', 'success', 'completed', 'paid'].includes(rawStatus);
      const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);

      const callbackAmount = parseFloat(
        payload.amount ||
        payload.collection?.amount?.raw ||          // ← actual MarzPay structure
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
            const curBal = userSnap.data().walletBalance || 0;
            t.update(userRef, { walletBalance: curBal + creditAmount, depositBalance: FieldValue.increment(creditAmount), depositCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
            if (pending.depositId) {
              t.update(db.collection('deposits').doc(pending.depositId), {
                status: 'success', amountCredited: creditAmount, marzTxId: txId,
                phone: phone || pending.phone, provider, paidAt: FieldValue.serverTimestamp()
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

// ═══════════════════════════════════════════
// REGISTRATION BONUS
// Called by frontend immediately after new user is created in Firestore
// ═══════════════════════════════════════════
app.post('/register/bonus', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = userSnap.data();

    // Idempotency: only pay once
    if (user.regBonusPaid) {
      return res.json({ status: 'already_paid', message: 'Registration bonus already credited' });
    }

    const settSnap = await db.collection('settings').doc('main').get();
    const bonus = settSnap.exists ? (settSnap.data().registrationBonus || 50000) : 50000;
    const { date, time } = nowStr();

    // Generate a globally unique referral code if user doesn't have one yet
    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = await generateUniqueReferralCode(userId);
    }

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

    console.log(`🎁 Registration bonus: ${fmtUGX(bonus)} → ${userId}`);
    return res.json({ status: 'success', bonus, message: `${fmtUGX(bonus)} welcome bonus credited!` });
  } catch (e) {
    if (e.message === 'ALREADY_PAID')
      return res.json({ status: 'already_paid', message: 'Registration bonus already credited' });
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
          walletBalance: FieldValue.increment(firstDepBonus),
          referralCount: FieldValue.increment(1),
          refEarned:     FieldValue.increment(firstDepBonus)
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
      return; // Don't also pay L2 on the same event
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
          walletBalance: FieldValue.increment(reward),
          refEarned:     FieldValue.increment(reward)
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
              walletBalance: FieldValue.increment(l3Flat),
              refEarned:     FieldValue.increment(l3Flat)
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
app.post('/invest/notify', async (req, res) => {
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
app.post('/withdraw/request', async (req, res) => {
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
    // Dynamic minimum: referral balance ≥ 10,000 → min is 10,000, otherwise 60,000
    const refEarnedNow = user.refEarned || 0;
    const minWithdraw  = refEarnedNow >= 10000 ? 10000 : 60000;
    if (amt < minWithdraw)
      return res.status(400).json({ status: 'error', message: refEarnedNow >= 10000 ? 'Minimum withdrawal is UGX 10,000' : 'Minimum withdrawal is UGX 60,000' });

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

    // Withdrawable = cumulative wallet ONLY (earned investment returns + referral earnings)
    // Deposit wallet funds are investable-only, not withdrawable
    const cumBal = user.cumulativeBalance || 0;
    const refBal = user.refEarned || 0;
    const balance = cumBal + (refBal >= 10000 ? refBal : 0);
    if (balance < amt) return res.status(400).json({ status: 'error', message: 'Insufficient withdrawable balance. Cumulative: ' + fmtUGX(cumBal) + (refBal >= 10000 ? ', Referral: ' + fmtUGX(refBal) : '') });

    // ── RULE: deposited funds cannot be withdrawn directly ──────────────
    const investedTotal  = user.totalInvested  || 0;
    const withdrawnTotal = user.totalWithdrawn || 0;
    // Allow if user has invested OR if admin has credited their cumulative wallet
    const hasInvested = investedTotal > 0 || (user.cumulativeBalance || 0) > 0;
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
    const fee       = (witCount === 0 || isTop) ? 0 : Math.round(amt * witFeePct / 100);
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
      const freshBal = freshData.walletBalance || 0;
      if (freshBal < amt) throw new Error(`Insufficient balance: ${fmtUGX(freshBal)}`);
      // Split deduction: deplete cumulativeBalance first, then refEarned
      const freshCum = freshData.cumulativeBalance || 0;
      const freshRef = freshData.refEarned || 0;
      cumPortion = Math.max(0, Math.min(freshCum, amt));
      refPortion = Math.max(0, amt - cumPortion);
      const balUpdates = {
        walletBalance: Math.max(0, freshBal - amt),
        withdrawalCount: (freshData.withdrawalCount || 0) + 1,
        lastWithdrawalRequestAt: FieldValue.serverTimestamp()
      };
      if (cumPortion > 0) balUpdates.cumulativeBalance = FieldValue.increment(-cumPortion);
      if (refPortion > 0) balUpdates.refEarned = FieldValue.increment(-refPortion);
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
  // Track totalWithdrawn for invest-before-withdraw rule
  await db.collection('users').doc(wit.userId).update({
    totalWithdrawn: FieldValue.increment(wit.amount)
  });
  const txSnap = await db.collection('transactions')
    .where('reference', '==', wit.reference).limit(1).get();
  if (!txSnap.empty) txSnap.docs[0].ref.update({ status: 'success', date, time });

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
      if (['success', 'successful', 'completed'].includes(rawStatus) && wit.status !== 'processed') {
        console.log(`✅ Withdrawal confirmed: ${reference}`);
        await processWithdrawalSuccess(witDoc.id, wit, payload);
      }
      if (['failed', 'declined', 'cancelled', 'error'].includes(rawStatus) && !['failed', 'processed'].includes(wit.status)) {
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
    return res.json({ status: 'success', data: { id: snap.id, ...snap.data() } });
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
    // Trigger referral check if depositing to deposits wallet
    if (targetWallet === 'depositBalance') {
      try { await checkAndPayReferral(userId, amt); } catch(e) { console.log('Ref check:', e.message); }
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
    await db.collection('notifications').add({
      userId, title: '🔐 Password Reset',
      message: 'Your login password has been reset by admin.',
      readBy: [], createdAt: FieldValue.serverTimestamp()
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
    const updateData = { pinAttempts: 0, pinLockUntil: null, updatedAt: FieldValue.serverTimestamp() };
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
app.post('/invest/claim', async (req, res) => {
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
      const userRef  = db.collection('users').doc(userId);
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found');
      if (userSnap.data().status === 'banned') throw new Error('Account suspended');
      t.update(userRef, {
        walletBalance: (userSnap.data().walletBalance || 0) + payout,
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
app.post('/bank-account/add', async (req, res) => {
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

app.post('/bank-account/list', async (req, res) => {
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
app.post('/checkin', async (req, res) => {
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
  setInterval(runDailyCashback, 24 * 60 * 60 * 1000); // Every 24hrs
  runDailyCashback(); // Run once on startup too (safe — checks lastCashbackDate)
  runMaturityCheck();
  setInterval(runStaleDepositCleanup, 5 * 60 * 1000);
  setInterval(runStaleWithdrawalAlert, 30 * 60 * 1000);
  console.log('⏰ Crons started: maturity(30m) | stale-deposits(5m) | stale-withdrawals(30m) | daily-cashback(24h)');
}

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
