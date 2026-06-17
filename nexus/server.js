const express    = require('express');
const admin      = require('firebase-admin');
const cors       = require('cors');
const crypto     = require('crypto');
// Node 18+ has built-in fetch; for older Node fallback
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

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
const ADMIN_KEY    = process.env.ADMIN_KEY    || '';
const SMS_SECRET   = process.env.SMS_SECRET   || '';
const RAILWAY_URL  = (process.env.RAILWAY_URL || '').replace(/\/$/, '');

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64 encoded credentials

const MIN_WITHDRAWAL = 15000;
const CHECKIN_BONUS  = 500;
const WELCOME_BONUS  = 7000;
const COMM_L1        = 0.10;
const COMM_L2        = 0.05;
const COMM_L3        = 0.02;
const LIQUIDITY_FEE  = 0.17;

// ── SETTINGS CACHE — reads Firestore `settings/main`, TTL 5 min ──
// Admin-editable rates (commL1/L2/L3, liquidityFee, minWithdrawal) live here;
// hardcoded constants above are fallbacks only so a bad Firestore value never breaks the server.
let _settingsCache = null, _settingsCacheTs = 0;
async function getSettings() {
  if (Date.now() - _settingsCacheTs < 5 * 60 * 1000) return _settingsCache || {};
  try {
    const snap = await db.collection('settings').doc('main').get();
    _settingsCache = snap.exists ? snap.data() : {};
  } catch (_) { _settingsCache = _settingsCache || {}; }
  _settingsCacheTs = Date.now();
  return _settingsCache;
}

// ── UUID v4 generator ──
function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── FormData helper for MarzPay ──
function marzForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
}

// ── MAINTENANCE — cached 60 s ──
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
// Webhooks and admin routes must never be blocked by maintenance
const BYPASS = ['/', '/sms/incoming', '/admin', '/deposit/callback', '/withdraw/callback'];
app.use(async (req, res, next) => {
  const p = req.path;
  if (BYPASS.some(b => p === b || p.startsWith(b + '/'))) return next();
  if (await isMaintenanceOn())
    return res.status(503).json({ status: 'error', maintenance: true,
      message: 'Nexus is under maintenance. Please check back shortly. ◈' });
  next();
});

// ── HELPERS ──
function fmtUGX(n)   { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function hashPin(p)  { return crypto.createHash('sha256').update(String(p) + 'nexus_salt_2026').digest('hex'); }
function eatNow()    { return new Date(Date.now() + 3 * 3600000); }
function nowStr() {
  const d = eatNow();
  const pad = n => String(n).padStart(2, '0');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return {
    date: days[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
    time: pad(d.getUTCHours() % 12 || 12) + ':' + pad(d.getUTCMinutes()) + ' ' + (d.getUTCHours() >= 12 ? 'PM' : 'AM')
  };
}
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('256') && s.length >= 12) return '+' + s;
  if (s.startsWith('0')   && s.length === 10) return '+256' + s.slice(1);
  if (s.length === 9)  return '+256' + s;
  if (s.length === 12 && s.startsWith('256')) return '+' + s;
  return '+256' + s;
}
function detectNetwork(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  let num = digits;
  if (num.startsWith('256') && num.length === 12) num = num.slice(3);
  if (num.startsWith('0') && num.length === 10) num = num.slice(1);
  const prefix2 = num.slice(0, 2);
  if (['77','78','76','31','39'].includes(prefix2)) return 'MTN';
  if (['70','74','75','71'].includes(prefix2)) return 'Airtel';
  return 'MTN';
}
// Crypto-secure character picker (no I/L/O/0/1 ambiguity)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randChars(n) {
  return Array.from(crypto.randomBytes(n)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// Globally-unique referral code: N + 5 random + X (e.g. N4K7M2X)
async function generateUniqueRefCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const code = 'N' + randChars(5) + 'X';
    const exists = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  return 'N' + Date.now().toString(36).toUpperCase().slice(-5).padStart(5, '0') + 'X';
}

// ── SMS PARSING ──
// Handles three real Ugandan carrier formats:
//   MTN→MTN:     "You have received UGX 22120 from VICTOR KYOYAGALA, 256791269201 on 2026-06-14..."
//   Airtel→same: "RECEIVED. TID 149730678579. UGX 27,200 from 743706731, HANIFAH. Bal UGX 332,358."
//   Airtel→MTN:  "You have received UGX 500 from Airtel Money on ... Reason: ABIIBA KANTONO, 0708523218. ... ID: 41454115808."
function parseMoMoSMS(sms) {
  if (!sms) return null;
  const text = sms.trim();
  let amount, senderPhone, senderName, txnId;

  // ── MTN Uganda MoMo (same-network) ──
  const mtnM = text.match(
    /you have received UGX\s*([\d,]+)\s+from\s+([A-Z][A-Z ]+),\s*(256\d{9}|\d{9,10})\s+on/i
  );
  if (mtnM) {
    amount      = parseInt(mtnM[1].replace(/,/g, ''), 10);
    senderName  = mtnM[2].trim();
    senderPhone = mtnM[3];
    const idM   = text.match(/\bID[:\s]+(\d{6,})/i);
    txnId = idM ? idM[1] : null;
  }

  // ── Airtel Uganda Money (same-network) ──
  if (!amount) {
    const airM = text.match(
      /RECEIVED\.\s*TID\s+(\d+)\.\s*UGX\s*([\d,]+)\s+from\s+(\d{9,12}),\s*([A-Z][A-Z ]*)\.\s*Bal/i
    );
    if (airM) {
      txnId       = airM[1];
      amount      = parseInt(airM[2].replace(/,/g, ''), 10);
      senderPhone = airM[3];
      senderName  = airM[4].trim();
    }
  }

  // ── Cross-network: Airtel→MTN ──
  // MTN account receives from Airtel; sender info is in the Reason field.
  // Uses [\s\S]*? so it still matches even if the SMS body has line breaks.
  if (!amount) {
    const crossM = text.match(
      /you have received UGX\s*([\d,]+)\s+from Airtel Money[\s\S]*?Reason:\s*([A-Z][A-Z ]+),\s*(\d{9,12})/i
    );
    if (crossM) {
      amount      = parseInt(crossM[1].replace(/,/g, ''), 10);
      senderName  = crossM[2].trim();
      senderPhone = crossM[3];
      const idM   = text.match(/\bID[:\s]+(\d{6,})/i);
      txnId = idM ? idM[1] : null;
    }
  }

  if (!amount || amount < 100 || !senderPhone) return null;
  if (!txnId) txnId = crypto.randomBytes(6).toString('hex').toUpperCase();
  return { amount, senderPhone, senderName, txnId };
}

// ── COMMISSION CHAIN ──
// Commission fires on EVERY plan purchase at the investment price.
// Each investmentId can only trigger commission once (dedup via commissionPaid_<invId> flag).
async function payCommissions(investorId, amount, investmentId) {
  const { date, time } = nowStr();
  try {
    const [invSnap, sett] = await Promise.all([
      db.collection('users').doc(investorId).get(),
      getSettings()
    ]);
    if (!invSnap.exists) return;
    const investor = invSnap.data();
    const l1Id = investor.referredBy;
    if (!l1Id || l1Id === investorId) return;

    // Rates from Firestore settings; hardcoded constants are fallbacks
    const commL1 = sett.commL1 ?? COMM_L1;
    const commL2 = sett.commL2 ?? COMM_L2;
    const commL3 = sett.commL3 ?? COMM_L3;
    const dedupFlag = `commPaid_${investmentId}`;

    // ── L1 ──
    const l1Snap = await db.collection('users').doc(l1Id).get();
    if (!l1Snap.exists) return;
    const l1Amt = Math.round(amount * commL1);
    if (l1Amt > 0 && !l1Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l1Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l1Amt),
          commissionEarned:   FieldValue.increment(l1Amt),
          commissionL1Earned: FieldValue.increment(l1Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l1Id, type: 'commission',
          description: `L1 commission (${Math.round(commL1*100)}%) — ${investor.name || investor.phone} paid ${fmtUGX(amount)}`,
          amount: l1Amt, level: 1, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    // ── L2 ──
    const l2Id = l1Snap.data().referredBy;
    if (!l2Id || l2Id === l1Id || l2Id === investorId) return;
    const l2Snap = await db.collection('users').doc(l2Id).get();
    if (!l2Snap.exists) return;
    const l2Amt = Math.round(amount * commL2);
    if (l2Amt > 0 && !l2Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l2Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l2Amt),
          commissionEarned:   FieldValue.increment(l2Amt),
          commissionL2Earned: FieldValue.increment(l2Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l2Id, type: 'commission',
          description: `L2 commission (${Math.round(commL2*100)}%) — ${investor.name || investor.phone} paid ${fmtUGX(amount)}`,
          amount: l2Amt, level: 2, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    // ── L3 ──
    const l3Id = l2Snap.data().referredBy;
    if (!l3Id || l3Id === l2Id || l3Id === l1Id || l3Id === investorId) return;
    const l3Snap = await db.collection('users').doc(l3Id).get();
    if (!l3Snap.exists) return;
    const l3Amt = Math.round(amount * commL3);
    if (l3Amt > 0 && !l3Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l3Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l3Amt),
          commissionEarned:   FieldValue.increment(l3Amt),
          commissionL3Earned: FieldValue.increment(l3Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l3Id, type: 'commission',
          description: `L3 commission (${Math.round(commL3*100)}%) — ${investor.name || investor.phone} paid ${fmtUGX(amount)}`,
          amount: l3Amt, level: 3, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }
  } catch (e) { console.error('Commission error:', e.message); }
}

// ═══════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════
app.get('/', (req, res) => res.json({ status: '◈ Nexus Server', time: new Date().toISOString() }));

// ── GIFT CODE GENERATION HELPER ──
function genGiftCode() {
  return 'NEXUS-' + Array.from(crypto.randomBytes(6)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// ═══════════════════════════════════════════
// ADMIN KEY CHECK
// ═══════════════════════════════════════════
app.post('/admin/check-key', (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.status(500).json({ valid: false, message: 'ADMIN_KEY not set' });
  return res.json({ valid: key === ADMIN_KEY });
});

// ═══════════════════════════════════════════
// SMS DEPOSIT DETECTION
// ═══════════════════════════════════════════
app.post('/sms/incoming', async (req, res) => {
  // Nexus SMS Forwarder app sends: { message, sender, secret }
  // Legacy/manual callers may send: { smsBody, senderPhone, raw, secret }
  const { smsBody, senderPhone, secret, raw, message, sender } = req.body;
  const body       = message || smsBody || raw || '';
  const fromPhone  = sender  || senderPhone || '';

  if (SMS_SECRET && secret !== SMS_SECRET)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });

  res.status(200).json({ status: 'received' });

  setImmediate(async () => {
    try {
      console.log('📨 SMS received — full body:', JSON.stringify(body));
      const parsed = parseMoMoSMS(body);
      if (!parsed || !parsed.amount) {
        console.log('📵 SMS ignored (not a deposit):', body.slice(0, 80));
        return;
      }

      const { amount, txnId, senderName } = parsed;
      const payerPhone = cleanPhone(parsed.senderPhone || fromPhone || '');

      console.log(`📩 SMS deposit: ${fmtUGX(amount)} from ${payerPhone} | txn: ${txnId}`);

      // Dedup by transaction ID
      const dupSnap = await db.collection('processedSMS').doc(txnId).get();
      if (dupSnap.exists) {
        console.log('⚠️ Duplicate txnId:', txnId);
        return;
      }

      const now = new Date();
      const { date, time } = nowStr();

      // Find matching pending deposit: senderPhone + pending + not expired
      let matchedDep = null, matchedRef = null;
      if (payerPhone && payerPhone.length >= 9) {
        const pendSnap = await db.collection('pendingDeposits')
          .where('senderPhone', '==', payerPhone)
          .where('status', '==', 'pending')
          .limit(5)
          .get();
        for (const d of pendSnap.docs) {
          const dep = d.data();
          const exp = dep.expiresAt?.toDate?.() || new Date(0);
          if (exp > now) {
            matchedDep = dep;
            matchedRef = d.ref;
            if (dep.amount === amount) break; // exact match preferred
          }
        }
      }

      if (matchedDep && matchedRef) {
        const userId = matchedDep.userId;
        await db.runTransaction(async t => {
          const uRef  = db.collection('users').doc(userId);
          const uSnap = await t.get(uRef);
          if (!uSnap.exists) throw new Error('User not found');
          t.update(uRef, {
            walletBalance:  (uSnap.data().walletBalance || 0) + amount,
            totalDeposited: FieldValue.increment(amount)
          });
          t.set(db.collection('processedSMS').doc(txnId), {
            userId, amount, payerPhone, txnId,
            depositId: matchedRef.id,
            processedAt: FieldValue.serverTimestamp()
          });
          t.update(matchedRef, {
            status: 'matched',
            creditedAmount: amount,
            txnId,
            matchedAt: FieldValue.serverTimestamp()
          });
          t.set(db.collection('transactions').doc(), {
            userId, type: 'deposit',
            description: `${matchedDep.network || 'MoMo'} deposit — received`,
            amount, phone: payerPhone, txnId,
            network: matchedDep.network || 'MoMo',
            status: 'success', date, time,
            createdAt: FieldValue.serverTimestamp()
          });
        });
        console.log(`✅ Deposit matched: ${matchedRef.id} — ${fmtUGX(amount)} → ${userId}`);
        // Referral commission fires on every successful deposit
        payCommissions(userId, amount, 'dep_' + matchedRef.id).catch(e => console.error('Deposit commission err:', e.message));
      } else {
        // No match — store for admin review
        await db.collection('unmatchedDeposits').add({
          smsBody: body,
          payerPhone,
          senderName: senderName || '',
          amount,
          txnId,
          status: 'unmatched',
          receivedAt: FieldValue.serverTimestamp()
        });
        // Mark as processed to avoid re-processing same SMS
        await db.collection('processedSMS').doc(txnId).set({
          amount, payerPhone, txnId, matched: false,
          processedAt: FieldValue.serverTimestamp()
        });
        console.log(`❓ Unmatched deposit: ${payerPhone} ${fmtUGX(amount)}`);
      }
    } catch (e) {
      console.error('SMS processing error:', e.message);
    }
  });
});

// Manual assign for unmatched deposits (admin)
app.post('/admin/assign-deposit', async (req, res) => {
  const { depositId, userId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depSnap = await db.collection('unmatchedDeposits').doc(depositId).get();
    if (!depSnap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const dep = depSnap.data();
    if (dep.status !== 'unmatched') return res.status(400).json({ status: 'error', message: 'Already processed' });
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, {
        walletBalance:  (uSnap.data().walletBalance || 0) + dep.amount,
        totalDeposited: FieldValue.increment(dep.amount)
      });
      t.update(db.collection('unmatchedDeposits').doc(depositId), {
        status: 'assigned', assignedTo: userId, assignedAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'deposit',
        description: `MoMo deposit (admin assigned) — ${dep.txnId || depositId}`,
        amount: dep.amount, phone: dep.senderPhone || '', status: 'success', date, time,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(dep.amount)} to user` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════
app.post('/register', async (req, res) => {
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().registrationDone) return res.json({ status: 'already_done', referralCode: userSnap.data().referralCode || null });

    let referrerId = null;
    if (referralCode) {
      const refSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase().trim()).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== userId) referrerId = refSnap.docs[0].id;
    }

    const myRefCode = userSnap.data().referralCode || await generateUniqueRefCode();

    const WELCOME = WELCOME_BONUS;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true, referralCode: myRefCode };

    batch.update(userRef, { walletBalance: FieldValue.increment(WELCOME) });
    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit', description: 'Welcome bonus — new account',
      amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });

    if (referrerId) {
      update.referredBy = referrerId;
      batch.update(db.collection('users').doc(referrerId), { teamL1Count: FieldValue.increment(1) });
      const l1Snap = await db.collection('users').doc(referrerId).get();
      const l2Id   = l1Snap.exists ? l1Snap.data().referredBy : null;
      if (l2Id && l2Id !== referrerId) {
        batch.update(db.collection('users').doc(l2Id), { teamL2Count: FieldValue.increment(1) });
        const l2Snap = await db.collection('users').doc(l2Id).get();
        const l3Id   = l2Snap.exists ? l2Snap.data().referredBy : null;
        if (l3Id && l3Id !== l2Id && l3Id !== referrerId)
          batch.update(db.collection('users').doc(l3Id), { teamL3Count: FieldValue.increment(1) });
      }
      batch.set(db.collection('referrals').doc(), {
        referrerId, referredUserId: userId, createdAt: FieldValue.serverTimestamp()
      });
    }

    batch.update(userRef, update);
    await batch.commit();
    return res.json({ status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// Ensure a user has a valid globally-unique referral code (backfill on login)
app.post('/account/ensure-refcode', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const ref  = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const existing = snap.data().referralCode;
    if (existing && /^N[A-Z0-9]{5}X$/.test(existing)) {
      return res.json({ status: 'success', referralCode: existing, changed: false });
    }
    const code = await generateUniqueRefCode();
    await ref.update({ referralCode: code });
    return res.json({ status: 'success', referralCode: code, changed: true });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENTS
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const { userId, productId } = req.body;
  if (!userId || !productId) return res.status(400).json({ status: 'error', message: 'userId and productId required' });
  try {
    const [uSnap, pSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('products').doc(productId).get()
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (!pSnap.exists) return res.status(404).json({ status: 'error', message: 'Plan not found' });
    const user = uSnap.data(), product = pSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if (!product.active)         return res.status(400).json({ status: 'error', message: 'Plan not available' });
    if (!product.isInStock)      return res.status(400).json({ status: 'error', message: 'Plan is sold out' });
    const price = product.price || 0;
    if ((user.walletBalance || 0) < price)
      return res.status(400).json({ status: 'error', message: `Need ${fmtUGX(price)}, have ${fmtUGX(user.walletBalance || 0)}` });
    const { date, time } = nowStr();
    const matDate = new Date();
    matDate.setDate(matDate.getDate() + (product.cycle || 1));
    let invId;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < price) throw new Error(`Need ${fmtUGX(price)}, have ${fmtUGX(bal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      t.update(uRef, { walletBalance: bal - price, totalInvested: FieldValue.increment(price) });
      t.set(invRef, {
        userId, productId, productName: product.name, productImage: product.image || '',
        amount: price, dailyReturn: product.dailyReturn || 0, cycle: product.cycle || 1,
        expectedReturn: product.expectedReturn || price, status: 'active',
        maturityDate: admin.firestore.Timestamp.fromDate(matDate),
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Invested in ${product.name}`,
        amount: -price, status: 'success', date, time,
        investmentId: invRef.id, productId, createdAt: FieldValue.serverTimestamp()
      });
    });
    payCommissions(userId, price, invId).catch(e => console.error('Commission err:', e.message));
    console.log(`✅ Investment: ${invId} — ${fmtUGX(price)} — ${userId}`);
    return res.json({ status: 'success', investmentId: invId, message: `Invested ${fmtUGX(price)} in ${product.name}` });
  } catch (e) {
    console.error('Invest error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/invest/claim', async (req, res) => {
  const { userId, investmentId } = req.body;
  if (!userId || !investmentId) return res.status(400).json({ status: 'error', message: 'userId and investmentId required' });
  try {
    const invRef  = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ status: 'error', message: 'Investment not found' });
    const inv = invSnap.data();
    if (inv.userId !== userId) return res.status(403).json({ status: 'error', message: 'Not your investment' });
    if (inv.status !== 'matured') return res.status(400).json({ status: 'error', message: 'Not ready to claim (status: ' + inv.status + ')' });
    // Subtract daily cashback already paid out to avoid double-crediting
    const payout = Math.max(0, (inv.expectedReturn || 0) - (inv.dailyCredited || 0));
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: (uSnap.data().walletBalance || 0) + payout, totalEarned: FieldValue.increment(payout) });
      t.update(invRef, { status: 'claimed', claimedAt: FieldValue.serverTimestamp() });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment_return',
        description: `Returns claimed — ${inv.productName || 'Plan'}`,
        amount: payout, status: 'success', date, time, investmentId,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', payout, message: `${fmtUGX(payout)} credited` });
  } catch (e) {
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// WITHDRAWALS — user requests, admin processes via MarzPay
// ═══════════════════════════════════════════
app.post('/withdraw/request', async (req, res) => {
  const { userId, amount, phone } = req.body;
  if (!userId || !amount || !phone)
    return res.status(400).json({ status: 'error', message: 'userId, amount and phone required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0)
    return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const fullPhone = cleanPhone(phone);
  try {
    const [uSnap, sett] = await Promise.all([
      db.collection('users').doc(userId).get(),
      getSettings()
    ]);
    const feeRate = sett.liquidityFee ?? LIQUIDITY_FEE;
    const minWit  = sett.minWithdrawal ?? MIN_WITHDRAWAL;
    if (amt < minWit)
      return res.status(400).json({ status: 'error', message: `Minimum withdrawal is ${fmtUGX(minWit)}` });
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });

    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    const fee    = Math.round(amt * feeRate);
    const netAmt = amt - fee;
    const { date, time } = nowStr();
    let witId;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Insufficient: ${fmtUGX(bal)}`);
      t.update(uRef, { walletBalance: bal - amt, withdrawalCount: FieldValue.increment(1) });
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      t.set(witRef, {
        userId, userName: user.name || '', userPhone: user.phone || '',
        withdrawalPhone: fullPhone, amount: amt, fee, netAmount: netAmt,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdrawal',
        description: 'Withdrawal request — pending processing',
        amount: -amt, fee, netAmount: netAmt, phone: fullPhone,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`📋 Withdrawal ${witId}: ${fmtUGX(amt)} → ${fullPhone}`);
    return res.json({ status: 'success', withdrawalId: witId, netAmount: netAmt, fee, message: 'Withdrawal submitted. Processing soon.' });
  } catch (e) {
    console.error('Withdrawal error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/withdraw/reject', async (req, res) => {
  const { withdrawalId, adminKey, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const wit = snap.data();
    if (['processed','rejected'].includes(wit.status))
      return res.status(400).json({ status: 'error', message: 'Already ' + wit.status });
    const batch = db.batch();
    batch.update(db.collection('withdrawals').doc(withdrawalId), {
      status: 'rejected', rejectionReason: reason || 'Rejected by admin', rejectedAt: FieldValue.serverTimestamp()
    });
    batch.update(db.collection('users').doc(wit.userId), {
      walletBalance:   FieldValue.increment(wit.amount),
      withdrawalCount: FieldValue.increment(-1)
    });
    await batch.commit();
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
// ADMIN — PROCESS WITHDRAWAL VIA MARZPAY
// ═══════════════════════════════════════════
app.post('/admin/withdraw/process', async (req, res) => {
  const { withdrawalId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });

  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();

    if (wit.status !== 'pending')
      return res.status(400).json({ status: 'error', message: `Cannot process — status is '${wit.status}'` });

    const phone     = wit.withdrawalPhone || wit.userPhone || '';
    const netAmount = wit.netAmount || wit.amount;
    const reference = uuidv4();
    const callbackUrl = RAILWAY_URL + '/withdraw/callback';

    // Call MarzPay send-money (multipart form)
    const fd = marzForm({
      phone_number: phone,
      amount:       String(netAmount),
      country:      'UG',
      reference,
      description:  `Nexus withdrawal - ${wit.userName || wit.userId}`,
      callback_url: callbackUrl
    });

    const mpRes = await fetch(`${MARZPAY_BASE}/send-money`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${MARZPAY_KEY}` },
      body: fd
    });
    const mpData = await mpRes.json();
    console.log('MarzPay send-money response:', JSON.stringify(mpData));

    if (mpData.status !== 'success' && mpData.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: mpData.message || 'MarzPay disbursement failed' });
    }

    // Update withdrawal to processing
    const batch = db.batch();
    batch.update(db.collection('withdrawals').doc(withdrawalId), {
      status: 'processing',
      marzReference: reference,
      processedAt: FieldValue.serverTimestamp()
    });

    // Update matching transactions doc
    const txSnap = await db.collection('transactions')
      .where('type', '==', 'withdrawal')
      .where('userId', '==', wit.userId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    for (const txDoc of txSnap.docs) {
      const txData = txDoc.data();
      if (txData.status === 'pending' && Math.abs(txData.amount) === wit.amount) {
        batch.update(txDoc.ref, { status: 'processing', marzReference: reference });
        break;
      }
    }

    await batch.commit();

    console.log(`💸 Withdrawal processing: ${withdrawalId} → ${phone} ${fmtUGX(netAmount)}`);
    return res.json({ status: 'success', message: `Withdrawal processing — ${fmtUGX(netAmount)} being sent to ${phone}` });
  } catch (e) {
    console.error('Process withdrawal error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// MARZPAY WITHDRAWAL CALLBACK (disbursement webhook)
// ═══════════════════════════════════════════
app.post('/withdraw/callback', async (req, res) => {
  res.json({ received: true });

  const body      = req.body;
  const eventType = body.event_type || '';
  const reference = body.transaction?.reference || body.reference || '';

  console.log('Withdraw callback:', eventType, reference);

  try {
    if (!reference) return;

    const witSnap = await db.collection('withdrawals')
      .where('marzReference', '==', reference)
      .limit(1).get();
    if (witSnap.empty) {
      console.log('No withdrawal found for marzReference:', reference);
      return;
    }

    const witDoc = witSnap.docs[0];
    const wit    = witDoc.data();
    const { date, time } = nowStr();

    if (eventType === 'disbursement.completed') {
      const batch = db.batch();
      batch.update(witDoc.ref, {
        status: 'processed',
        completedAt: FieldValue.serverTimestamp()
      });
      batch.update(db.collection('users').doc(wit.userId), {
        totalWithdrawn: FieldValue.increment(wit.netAmount || wit.amount)
      });
      await batch.commit();

      // Update matching transaction status
      const txSnap = await db.collection('transactions')
        .where('userId', '==', wit.userId)
        .where('type', '==', 'withdrawal')
        .orderBy('createdAt', 'desc')
        .limit(10).get();
      for (const txDoc of txSnap.docs) {
        const txData = txDoc.data();
        if (txData.marzReference === reference || txData.status === 'processing') {
          await txDoc.ref.update({ status: 'success' });
          break;
        }
      }

      console.log(`✅ Withdrawal complete: ${witDoc.id} → ${wit.userId}`);

    } else if (eventType === 'disbursement.failed') {
      const refundAmount = wit.amount;
      await db.runTransaction(async t => {
        const uRef  = db.collection('users').doc(wit.userId);
        const uSnap = await t.get(uRef);
        if (!uSnap.exists) throw new Error('User not found');
        t.update(uRef, {
          walletBalance:   (uSnap.data().walletBalance || 0) + refundAmount,
          withdrawalCount: FieldValue.increment(-1)
        });
        t.update(witDoc.ref, {
          status: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          failureReason: body.transaction?.failure_reason || 'Disbursement failed'
        });
        t.set(db.collection('transactions').doc(), {
          userId: wit.userId, type: 'refund',
          description: 'Withdrawal refund — disbursement failed',
          amount: refundAmount, status: 'success', date, time,
          createdAt: FieldValue.serverTimestamp()
        });
      });

      const txSnap = await db.collection('transactions')
        .where('userId', '==', wit.userId)
        .where('type', '==', 'withdrawal')
        .orderBy('createdAt', 'desc')
        .limit(10).get();
      for (const txDoc of txSnap.docs) {
        const txData = txDoc.data();
        if (txData.marzReference === reference || txData.status === 'processing') {
          await txDoc.ref.update({ status: 'failed' });
          break;
        }
      }

      console.log(`❌ Withdrawal failed & refunded: ${witDoc.id} → ${wit.userId}`);
    }
  } catch (e) {
    console.error('Withdraw callback error:', e.message);
  }
});

// ═══════════════════════════════════════════
// CHECK-IN
// ═══════════════════════════════════════════
app.post('/checkin', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const settSnap = await db.collection('settings').doc('main').get();
    const bonus    = settSnap.exists ? (settSnap.data().checkinBonus || CHECKIN_BONUS) : CHECKIN_BONUS;
    const uRef     = db.collection('users').doc(userId);
    const uSnap    = await uRef.get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const today    = eatNow();
    const todayKey = today.toISOString().slice(0, 10);
    const yesterdayKey = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
    if (user.lastCheckinDate === todayKey)
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    const newStreak = user.lastCheckinDate === yesterdayKey ? (user.checkinStreak || 0) + 1 : 1;
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const fresh = await t.get(uRef);
      if (fresh.data().lastCheckinDate === todayKey) throw new Error('ALREADY_DONE');
      t.update(uRef, {
        walletBalance:   FieldValue.increment(bonus),
        lastCheckinDate: todayKey, checkinStreak: newStreak,
        checkinDays:     FieldValue.increment(1),
        checkinEarned:   FieldValue.increment(bonus)
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'checkin',
        description: `Daily check-in — Day ${newStreak}`,
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
// GIFT CODES — admin generates, users redeem
// ═══════════════════════════════════════════
app.post('/giftcode/redeem', async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ status: 'error', message: 'userId and code required' });
  try {
    const snap = await db.collection('giftCodes').where('code', '==', code.toUpperCase().trim()).limit(1).get();
    if (snap.empty) return res.status(404).json({ status: 'error', message: 'Invalid gift code' });
    const gc  = snap.docs[0];
    const gcd = gc.data();
    if (!gcd.active) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
    if ((gcd.usedBy || []).includes(userId)) return res.status(400).json({ status: 'error', message: 'You have already redeemed this code' });
    if (gcd.maxUsers && (gcd.usedBy || []).length >= gcd.maxUsers) return res.status(400).json({ status: 'error', message: 'Usage limit reached — this code has expired' });
    if (gcd.expiresAt && gcd.expiresAt.toDate() < new Date()) return res.status(400).json({ status: 'error', message: 'This gift code has expired' });
    const amount = Math.floor(Math.random() * 1801) + 200;
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: (uSnap.data().walletBalance || 0) + amount });
      t.update(gc.ref, { usedBy: FieldValue.arrayUnion(userId) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'gift_code',
        description: `Gift code redeemed — ${code.toUpperCase()}`,
        amount, status: 'success', code: code.toUpperCase(), date, time,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`🎁 Gift ${code} → ${userId} — ${fmtUGX(amount)}`);
    return res.json({ status: 'success', amount, message: `🎁 You won ${fmtUGX(amount)}!` });
  } catch (e) {
    console.error('Gift code error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — misc
// ═══════════════════════════════════════════
app.post('/admin/deposit', async (req, res) => {
  const { userId, amount, note, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const amt = parseFloat(amount || 0);
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  try {
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'Admin credit',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/ban', async (req, res) => {
  const { userId, adminKey, action, reason } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const isBan = action === 'ban';
    await db.collection('users').doc(userId).update({
      status: isBan ? 'banned' : 'active',
      banReason: isBan ? (reason || 'Policy violation') : null,
      bannedAt:  isBan ? FieldValue.serverTimestamp() : null
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — STATS
// ═══════════════════════════════════════════
app.post('/admin/stats', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, withdrawalsSnap, investmentsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('withdrawals').where('status', '==', 'pending').get(),
      db.collection('investments').where('status', '==', 'active').get()
    ]);

    let totalUsers = 0, activeUsers = 0, bannedUsers = 0;
    let totalWalletBalance = 0, totalDeposited = 0, totalWithdrawn = 0, totalInvested = 0;

    usersSnap.forEach(doc => {
      const u = doc.data();
      totalUsers++;
      if (u.status === 'banned') bannedUsers++;
      else activeUsers++;
      totalWalletBalance += u.walletBalance   || 0;
      totalDeposited     += u.totalDeposited  || 0;
      totalWithdrawn     += u.totalWithdrawn  || 0;
      totalInvested      += u.totalInvested   || 0;
    });

    return res.json({
      status: 'success',
      stats: {
        totalUsers,
        activeUsers,
        bannedUsers,
        totalWalletBalance,
        totalDeposited,
        totalWithdrawn,
        totalInvested,
        pendingWithdrawals: withdrawalsSnap.size,
        activeInvestments:  investmentsSnap.size
      }
    });
  } catch (e) {
    console.error('Admin stats error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — USERS LIST
// ═══════════════════════════════════════════
app.post('/admin/users', async (req, res) => {
  const { adminKey, limit: lim = 200 } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users')
      .orderBy('createdAt', 'desc')
      .limit(Number(lim) || 200)
      .get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ status: 'success', users });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — GIFT CODES: GENERATE
// ═══════════════════════════════════════════
app.post('/admin/gift-codes/generate', async (req, res) => {
  const { adminKey, count = 1, expiresInDays, maxUsers } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  try {
    const existingSnap = await db.collection('giftCodes').select('code').get();
    const existingCodes = new Set(existingSnap.docs.map(d => d.data().code));

    const generatedCodes = [];
    const batch = db.batch();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 86400000)
      : null;

    let attempts = 0;
    while (generatedCodes.length < n && attempts < n * 10) {
      attempts++;
      const code = genGiftCode();
      if (existingCodes.has(code) || generatedCodes.includes(code)) continue;
      generatedCodes.push(code);
      existingCodes.add(code);

      const docRef  = db.collection('giftCodes').doc();
      const docData = {
        code,
        active:    true,
        usedBy:    [],
        maxUsers:  maxUsers ? Math.max(1, parseInt(maxUsers)) : null,
        createdAt: FieldValue.serverTimestamp()
      };
      if (expiresAt) docData.expiresAt = admin.firestore.Timestamp.fromDate(expiresAt);
      batch.set(docRef, docData);
    }

    await batch.commit();
    console.log(`🎁 Generated ${generatedCodes.length} gift codes`);
    return res.json({ status: 'success', codes: generatedCodes, count: generatedCodes.length });
  } catch (e) {
    console.error('Generate codes error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — GIFT CODES: DEACTIVATE
// ═══════════════════════════════════════════
app.post('/admin/gift-codes/deactivate', async (req, res) => {
  const { adminKey, codeId } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!codeId) return res.status(400).json({ status: 'error', message: 'codeId required' });
  try {
    await db.collection('giftCodes').doc(codeId).update({ active: false });
    return res.json({ status: 'success', message: 'Gift code deactivated' });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// DEPOSIT — PHONE VERIFICATION (proxies MarzPay)
// ═══════════════════════════════════════════
app.post('/deposit/verify-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ status: 'error', message: 'Phone required' });
  if (!MARZPAY_KEY) return res.json({ status: 'error', message: 'Verification not configured' });
  try {
    const resp = await fetch(`${MARZPAY_BASE}/phone-verification/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${MARZPAY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone_number: phone })
    });
    const data = await resp.json();
    if (data.success && data.data) {
      return res.json({
        status: 'success',
        name: data.data.full_name,
        verification_status: data.data.verification_status
      });
    }
    return res.json({ status: 'error', message: data.message || 'Phone not found or not registered' });
  } catch (e) {
    console.error('Phone verify error:', e.message);
    return res.json({ status: 'error', message: 'Verification service unavailable' });
  }
});

// ═══════════════════════════════════════════
// DEPOSIT — INITIATE (SMS-based, no USSD push)
// ═══════════════════════════════════════════
app.post('/deposit/initiate', async (req, res) => {
  const { userId, senderPhone, amount, network, senderName } = req.body;
  if (!userId || !senderPhone || !amount)
    return res.json({ status: 'error', message: 'userId, senderPhone and amount required' });

  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0)
    return res.json({ status: 'error', message: 'Invalid amount' });

  try {
    // Get settings
    const settSnap = await db.collection('settings').doc('main').get();
    const settings = settSnap.exists ? settSnap.data() : {};
    const minDep = settings.minDeposit || 500;
    if (amt < minDep)
      return res.json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.json({ status: 'error', message: 'User not found' });
    if (userSnap.data().status === 'banned')
      return res.json({ status: 'error', message: 'Account suspended' });

    const cleanSender = cleanPhone(senderPhone);
    const net = network || detectNetwork(cleanSender);
    const isMTN = net === 'MTN';

    const receivingPhone = isMTN
      ? (settings.mtnReceivingPhone || '')
      : (settings.airtelReceivingPhone || '');
    const receivingName = isMTN
      ? (settings.mtnReceivingName || 'NEXUS INVESTMENTS')
      : (settings.airtelReceivingName || 'NEXUS INVESTMENTS');

    if (!receivingPhone)
      return res.json({ status: 'error', message: `${net} receiving number not configured. Contact admin.` });

    // Cancel ALL existing pending deposits — only one must exist at a time
    // so the SMS matcher always finds the right one.
    const oldSnap = await db.collection('pendingDeposits')
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .limit(10)
      .get();
    const now = new Date();
    if (!oldSnap.empty) {
      const batch = db.batch();
      oldSnap.forEach(d => batch.update(d.ref, { status: 'cancelled' }));
      await batch.commit();
    }

    const expiresAt = new Date(Date.now() + 12 * 3600000);
    const { date, time } = nowStr();

    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId,
      senderPhone: cleanSender,
      senderName: senderName || '',
      amount: amt,
      network: net,
      receivingPhone,
      receivingName,
      status: 'pending',
      date, time,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: FieldValue.serverTimestamp()
    });

    console.log(`📋 Deposit pending: ${depRef.id} — ${fmtUGX(amt)} from ${cleanSender} → ${receivingPhone}`);

    return res.json({
      status: 'success',
      depositId: depRef.id,
      receivingPhone,
      receivingName,
      amount: amt,
      network: net,
      expiresAt: expiresAt.toISOString()
    });
  } catch (e) {
    console.error('Deposit initiate error:', e.message);
    return res.json({ status: 'error', message: e.message });
  }
});

app.get('/deposit/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('pendingDeposits').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const dep = snap.data();
    return res.json({
      status: 'success',
      deposit: {
        id: snap.id,
        depositStatus: dep.status,
        amount: dep.amount,
        network: dep.network,
        expiresAt: dep.expiresAt?.toDate?.()?.toISOString?.() || null
      }
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Legacy MarzPay deposit callback — no longer used for deposits (SMS-based now)
app.post('/deposit/callback', (req, res) => {
  res.json({ received: true });
  console.log('Deposit callback received (ignored — SMS-based deposits only):', req.body?.event_type);
});

// ── TICKER (anonymized global activity) ──
app.get('/ticker', async (req, res) => {
  try {
    const snap = await db.collection('transactions')
      .where('status', '==', 'success')
      .orderBy('createdAt', 'desc')
      .limit(20).get();
    const items = snap.docs.map(d => {
      const t = d.data();
      return { type: t.type, amount: t.amount };
    });
    res.json({ status: 'success', items });
  } catch (e) {
    res.json({ status: 'success', items: [] });
  }
});

app.post('/admin/check-maturities', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error' });
  const count = await runMaturityCheck();
  return res.json({ status: 'success', matured: count });
});

// ═══════════════════════════════════════════
// CRONS — maturity + daily cashback
// ═══════════════════════════════════════════
async function runDailyCashback() {
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    const now      = new Date();
    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
    let credited   = 0;

    // Group by userId so we do one wallet update per user
    const byUser = {};
    snap.forEach(docSnap => {
      const inv = docSnap.data();
      if (!inv.dailyReturn || inv.dailyReturn <= 0) return;

      // Determine last credit date (default = investment creation day)
      const lastKey = inv.lastCreditDate || inv.createdAt?.toDate?.()?.toISOString()?.slice(0, 10);
      if (!lastKey || lastKey >= todayKey) return; // already credited today

      // Count full days owed (cap at cycle to avoid over-crediting)
      const startDate = new Date(lastKey + 'T00:00:00Z');
      const diffMs    = now - startDate;
      const daysDue   = Math.min(Math.floor(diffMs / 86400000), inv.cycle || 1);
      if (daysDue <= 0) return;

      const amount = Math.round(inv.dailyReturn * daysDue);
      if (!byUser[inv.userId]) byUser[inv.userId] = { total: 0, docs: [] };
      byUser[inv.userId].total += amount;
      byUser[inv.userId].docs.push({ ref: docSnap.ref, amount, daysDue });
      credited++;
    });

    for (const [userId, data] of Object.entries(byUser)) {
      const { date, time } = nowStr();
      await db.runTransaction(async t => {
        const uRef  = db.collection('users').doc(userId);
        const uSnap = await t.get(uRef);
        if (!uSnap.exists) return;
        t.update(uRef, {
          walletBalance: FieldValue.increment(data.total),
          totalEarned:   FieldValue.increment(data.total)
        });
        for (const d of data.docs) {
          t.update(d.ref, {
            lastCreditDate: todayKey,
            dailyCredited:  FieldValue.increment(d.amount)
          });
          t.set(db.collection('transactions').doc(), {
            userId, type: 'checkin',
            description: `Daily cashback — ${d.daysDue} day(s)`,
            amount: d.amount, status: 'success', date, time,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      });
    }

    if (credited > 0) console.log(`💰 Daily cashback: ${credited} investment(s) credited`);
    return credited;
  } catch (e) { console.error('Daily cashback error:', e.message); return 0; }
}

async function runMaturityCheck() {
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    let count = 0;
    const now = new Date();
    const batch = db.batch();
    snap.forEach(doc => {
      const inv = doc.data();
      const mat = inv.maturityDate?.toDate?.() || null;
      if (mat && mat <= now) {
        batch.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() });
        count++;
      }
    });
    if (count > 0) { await batch.commit(); }
    if (count > 0) console.log(`⏰ Matured: ${count} plan(s)`);
    return count;
  } catch (e) { console.error('Maturity error:', e.message); return 0; }
}

// Schedule runDailyCashback to fire at exactly 00:00 EAT (UTC+3) each night,
// then reschedule itself so it self-corrects for drift.
function scheduleMidnightEAT() {
  const nowUtc = Date.now();
  const eatNow = new Date(nowUtc + 3 * 3600000);
  // 00:00 EAT tomorrow = UTC midnight of tomorrow (EAT date) minus 3 h
  const midnightEATUtc = Date.UTC(
    eatNow.getUTCFullYear(), eatNow.getUTCMonth(), eatNow.getUTCDate() + 1
  ) - 3 * 3600000;
  const delay = Math.max(60000, midnightEATUtc - nowUtc);
  console.log(`⏰ Daily cashback next run: ${new Date(midnightEATUtc).toISOString()} (in ${Math.round(delay/60000)}m)`);
  setTimeout(async () => {
    await runDailyCashback();
    scheduleMidnightEAT();
  }, delay);
}

function startCrons() {
  // Maturity check every 30 min
  setInterval(runMaturityCheck, 30 * 60 * 1000);
  runMaturityCheck();
  // Daily cashback at 00:00 EAT; also run once on startup to catch any missed credits
  scheduleMidnightEAT();
  runDailyCashback();
  console.log('⏰ Crons started (maturity + daily cashback at midnight EAT)');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`◈ Nexus Investment Server on port ${PORT}`);
  console.log(`  URL: ${RAILWAY_URL || '(set RAILWAY_URL)'}`);
  startCrons();
});
