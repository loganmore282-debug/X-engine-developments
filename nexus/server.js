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

const MIN_WITHDRAWAL = 15000;
const CHECKIN_BONUS  = 500;
const WELCOME_BONUS  = 10000;
const COMM_L1        = 0.35;
const COMM_L2        = 0.05;
const COMM_L3        = 0.02;
const LIQUIDITY_FEE  = 0.17;

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
const BYPASS = ['/', '/sms/incoming', '/admin'];
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
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
async function notify(userId, title, message, type, extras = {}) {
  const { date, time } = nowStr();
  await db.collection('notifications').add({
    userId, title, message, type,
    readBy: [], date, time, details: { ...extras, date, time },
    createdAt: FieldValue.serverTimestamp()
  });
}

// ── SMS PARSING ──
function parseMoMoSMS(sms) {
  if (!sms) return null;
  // Must contain UGX and look like a received-money SMS
  if (!/received|deposited|credited/i.test(sms)) return null;
  // Amount
  const amtMatch = sms.match(/UGX\s*([0-9,]+)/i);
  if (!amtMatch) return null;
  const amount = parseInt(amtMatch[1].replace(/,/g, ''), 10);
  if (!amount || amount < 100) return null;
  // Sender phone — MTN/Airtel Uganda formats
  const phonePatterns = [
    /from\s+(\+?256[347]\d{8})/i,
    /from\s+(0[347]\d{8})/i,
    /(\+256[347]\d{8})/,
    /(0[347]\d{8})/
  ];
  let senderPhone = null;
  for (const p of phonePatterns) {
    const m = sms.match(p);
    if (m) { senderPhone = m[1]; break; }
  }
  // Transaction ID
  const txnMatch = sms.match(/[Ff]inancial\s*[Tt]ransaction\s*[Ii]d\s+(\d+)/) ||
                   sms.match(/[Tt]xn\s*[Ii]d[:\s]+([A-Z0-9]+)/i) ||
                   sms.match(/[Tt]ransaction\s*[Ii][Dd][:\s]+([A-Z0-9]+)/i) ||
                   sms.match(/[Rr]ef(?:erence)?[:\s]+([A-Z0-9]+)/i);
  const txnId = txnMatch ? txnMatch[1] : crypto.randomBytes(6).toString('hex').toUpperCase();
  return { amount, senderPhone, txnId };
}

// ── COMMISSION CHAIN ──
async function payCommissions(investorId, amount) {
  const { date, time } = nowStr();
  try {
    const invSnap = await db.collection('users').doc(investorId).get();
    if (!invSnap.exists) return;
    const investor = invSnap.data();
    const l1Id = investor.referredBy;
    if (!l1Id || l1Id === investorId) return;

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
          amount: l1Amt, level: 1, fromUserId: investorId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l1Id, title: '💰 Commission Earned!',
          message: `${investor.name || 'Your referral'} invested ${fmtUGX(amount)}!\n\nYou earned 35% = ${fmtUGX(l1Amt)} — credited now.\n\n📅 ${date} ⏰ ${time}`,
          type: 'commission', amount: l1Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
    }

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
          amount: l2Amt, level: 2, fromUserId: investorId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l2Id, title: '💰 Team Commission!',
          message: `L2 team member invested ${fmtUGX(amount)}! You earned 5% = ${fmtUGX(l2Amt)}.\n\n📅 ${date}`,
          type: 'commission', amount: l2Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    const l3Id = l2Snap.data().referredBy;
    if (!l3Id || l3Id === l2Id || l3Id === l1Id || l3Id === investorId) return;
    const l3Amt = Math.round(amount * COMM_L3);
    if (l3Amt > 0) {
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
          amount: l3Amt, level: 3, fromUserId: investorId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId: l3Id, title: '💰 Team Commission!',
          message: `L3 team member invested ${fmtUGX(amount)}! You earned 2% = ${fmtUGX(l3Amt)}.\n\n📅 ${date}`,
          type: 'commission', amount: l3Amt, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
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
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars — no I/L/O/0/1
  return Array.from(crypto.randomBytes(6)).map(b => CHARS[b % CHARS.length]).join('');
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
  const { smsBody, senderPhone, secret, raw } = req.body;
  const body = smsBody || raw || '';

  // Verify secret if configured
  if (SMS_SECRET && secret !== SMS_SECRET)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });

  res.status(200).json({ status: 'received' });

  setImmediate(async () => {
    try {
      const parsed = parseMoMoSMS(body);
      if (!parsed || !parsed.amount) {
        console.log('📵 SMS ignored (not a deposit):', body.slice(0, 80));
        return;
      }

      const { amount, txnId } = parsed;
      const phone = cleanPhone(parsed.senderPhone || senderPhone || '');

      console.log(`📩 SMS deposit: ${fmtUGX(amount)} from ${phone} | txn: ${txnId}`);

      // Deduplication — check if txnId already processed
      const dupSnap = await db.collection('processedSMS').doc(txnId).get();
      if (dupSnap.exists) {
        console.log('⚠️ Duplicate SMS txnId:', txnId);
        return;
      }

      // Find user by phone
      const userSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
      if (userSnap.empty) {
        // Store as unmatched for admin review
        await db.collection('unmatchedDeposits').add({
          smsBody: body, senderPhone: phone, amount, txnId,
          status: 'unmatched', receivedAt: FieldValue.serverTimestamp()
        });
        console.log('❓ No user for phone:', phone, '— stored as unmatched');
        return;
      }

      const userId = userSnap.docs[0].id;
      const { date, time } = nowStr();

      // Credit in transaction + mark txnId as processed atomically
      await db.runTransaction(async t => {
        const uRef   = db.collection('users').doc(userId);
        const uSnap  = await t.get(uRef);
        if (!uSnap.exists) throw new Error('User not found');
        t.update(uRef, {
          walletBalance:  (uSnap.data().walletBalance || 0) + amount,
          totalDeposited: FieldValue.increment(amount)
        });
        t.set(db.collection('processedSMS').doc(txnId), {
          userId, amount, phone, processedAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'deposit',
          description: 'MoMo deposit detected',
          amount, phone, txnId, status: 'success', date, time,
          createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('notifications').doc(), {
          userId, title: '✅ Deposit Received!',
          message: `${fmtUGX(amount)} has been credited to your Nexus wallet.\n\n📅 ${date}\n⏰ ${time}\n📱 ${phone}\n🔖 Txn: ${txnId}\n\nThank you for investing with Nexus! ◈`,
          type: 'deposit', amount, txnId, date, time,
          readBy: [], createdAt: FieldValue.serverTimestamp()
        });
      });

      console.log(`✅ Credited ${fmtUGX(amount)} → ${userId}`);
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
    await notify(userId, '✅ Deposit Credited', `${fmtUGX(dep.amount)} has been credited to your wallet.\n\n📅 ${date}`, 'deposit', { amount: dep.amount });
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
    if (userSnap.data().registrationDone) return res.json({ status: 'already_done' });

    let referrerId = null;
    if (referralCode) {
      const refSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase()).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== userId) referrerId = refSnap.docs[0].id;
    }

    const WELCOME = 10000;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true };

    // Welcome bonus
    batch.update(userRef, { walletBalance: FieldValue.increment(WELCOME) });
    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit', description: 'Welcome bonus — new account',
      amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
    batch.set(db.collection('notifications').doc(), {
      userId, title: '🎉 Welcome to Nexus!',
      message: `${fmtUGX(WELCOME)} welcome bonus credited!\n\nStart investing in a plan to earn daily returns.\n\n📅 ${date}\n◈ Nexus Investment Platform`,
      type: 'admin_credit', amount: WELCOME, date, time,
      readBy: [], createdAt: FieldValue.serverTimestamp()
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
    return res.json({ status: 'success', referrerId, welcomeBonus: WELCOME });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// PIN
// ═══════════════════════════════════════════
app.post('/pin/set', async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !/^\d{4}$/.test(String(pin || '')))
    return res.status(400).json({ status: 'error', message: '4-digit PIN required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await db.collection('users').doc(userId).update({ withdrawalPin: hashPin(pin), pinSetAt: FieldValue.serverTimestamp() });
    return res.json({ status: 'success', message: 'PIN set' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/pin/verify', async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin) return res.status(400).json({ valid: false });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ valid: false });
    const stored = snap.data().withdrawalPin;
    if (!stored) return res.json({ valid: false, needsSetup: true });
    return res.json({ valid: stored === hashPin(pin) });
  } catch (e) { return res.status(500).json({ valid: false }); }
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
    payCommissions(userId, price).catch(e => console.error('Commission err:', e.message));
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
    const payout = inv.expectedReturn || 0;
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
      t.set(db.collection('notifications').doc(), {
        userId, title: '🎯 Returns Claimed!',
        message: `${fmtUGX(payout)} from ${inv.productName || 'your plan'} credited to wallet.\n\n📅 ${date}`,
        type: 'investment_return', amount: payout, date, time,
        readBy: [], createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', payout, message: `${fmtUGX(payout)} credited` });
  } catch (e) {
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// WITHDRAWALS — user requests, admin processes manually
// ═══════════════════════════════════════════
app.post('/withdraw/request', async (req, res) => {
  const { userId, amount, phone } = req.body;
  if (!userId || !amount || !phone)
    return res.status(400).json({ status: 'error', message: 'userId, amount and phone required' });
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < MIN_WITHDRAWAL)
    return res.status(400).json({ status: 'error', message: `Minimum withdrawal is ${fmtUGX(MIN_WITHDRAWAL)}` });
  const fullPhone = cleanPhone(phone);
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });

    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    // 17% liquidity fee on all withdrawals
    const fee    = Math.round(amt * LIQUIDITY_FEE);
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
    await notify(userId, '⏳ Withdrawal Submitted',
      `Your withdrawal request for ${fmtUGX(netAmt)} (after ${fmtUGX(fee)} liquidity fee, 17%) to ${fullPhone} has been submitted.\n\nWe will process it shortly.\n\n📅 ${date}\n⏰ ${time}`,
      'withdrawal', { amount: amt, net: netAmt, fee, phone: fullPhone });
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
    await notify(wit.userId, '❌ Withdrawal Rejected',
      `Your withdrawal of ${fmtUGX(wit.amount)} was rejected.\n\nReason: ${reason || 'Rejected by admin'}\n\n${fmtUGX(wit.amount)} has been refunded to your wallet.`,
      'withdrawal_failed', { amount: wit.amount });
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
    const todayKey = eatNow().toISOString().slice(0, 10);
    if (user.lastCheckinDate === todayKey)
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    const newStreak = (user.checkinStreak || 0) + 1;
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
    if (gcd.expiresAt && gcd.expiresAt.toDate() < new Date()) return res.status(400).json({ status: 'error', message: 'This gift code has expired' });
    // Random amount at redemption — 100 to 15,000
    const amount = Math.floor(Math.random() * 14901) + 100;
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
    await notify(userId, '💰 Funds Added', `${fmtUGX(amt)} added to your wallet.\n📝 ${note || 'Admin credit'}\n📅 ${nowStr().date}`, 'deposit', { amount: amt });
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
    await notify(userId, isBan ? '🚫 Account Suspended' : '✅ Account Restored',
      isBan ? `Your account has been suspended.\nReason: ${reason || 'Policy violation'}\nContact support for help.`
            : 'Your Nexus account has been restored. All features are available.',
      isBan ? 'warning' : 'info', {});
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// MARZPAY — DEPOSIT INITIATION & CALLBACK
// ═══════════════════════════════════════════
const MARZPAY_KEY = process.env.MARZPAY_KEY || '';
const MARZPAY_URL = (process.env.MARZPAY_URL || 'https://api.marzpay.co.ug').replace(/\/$/, '');

app.post('/deposit/initiate', async (req, res) => {
  const { userId, amount, phone, network } = req.body;
  if (!userId || !amount || !phone) return res.json({ status: 'error', message: 'Missing required fields' });
  if (amount < 30000) return res.json({ status: 'error', message: 'Minimum deposit is UGX 30,000' });

  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.json({ status: 'error', message: 'User not found' });

    const ref = 'NX' + Date.now() + Math.floor(Math.random() * 1000);
    const callbackUrl = RAILWAY_URL + '/deposit/callback';

    let payStatus = 'pending';
    let mpMessage = 'Payment prompt sent';

    if (MARZPAY_KEY) {
      const mpRes = await fetch(`${MARZPAY_URL}/v1/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MARZPAY_KEY}` },
        body: JSON.stringify({ amount, phone_number: phone, network: network || 'MTN', reference: ref, callback_url: callbackUrl })
      });
      const mpData = await mpRes.json();
      if (mpData.status !== 'success' && mpData.code !== '200' && !mpData.transaction_id) {
        return res.json({ status: 'error', message: mpData.message || 'Payment provider error' });
      }
      mpMessage = mpData.message || 'Payment prompt sent to your phone';
    }

    // Record pending deposit transaction
    const now = new Date();
    await db.collection('transactions').add({
      userId, type: 'deposit', amount, phone, network: network || 'MTN',
      status: payStatus, reference: ref,
      description: `${network || 'MTN'} Deposit`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      date: now.toLocaleDateString('en-GB'), time: now.toLocaleTimeString('en-GB')
    });

    return res.json({ status: 'success', message: mpMessage, reference: ref });
  } catch (e) {
    console.error('MarzPay initiate error:', e.message);
    return res.json({ status: 'error', message: 'Payment service unavailable' });
  }
});

app.post('/deposit/callback', async (req, res) => {
  // MarzPay webhook — called when user approves payment on phone
  const { reference, status, amount, transaction_id } = req.body;
  res.json({ received: true }); // Respond immediately

  const txStatus = (status || '').toLowerCase();
  if (txStatus !== 'successful' && txStatus !== 'success') return;

  try {
    const snap = await db.collection('transactions')
      .where('reference', '==', reference)
      .where('type', '==', 'deposit')
      .limit(1).get();
    if (snap.empty) return;

    const txDoc = snap.docs[0];
    const tx = txDoc.data();
    if (tx.status === 'success') return; // already credited

    const creditAmount = Number(amount) || tx.amount;

    await db.runTransaction(async t => {
      const userRef = db.collection('users').doc(tx.userId);
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) return;
      t.update(userRef, { walletBalance: FieldValue.increment(creditAmount) });
      t.update(txDoc.ref, { status: 'success', transactionId: transaction_id || '' });
    });

    console.log(`✅ Deposit credited: ${tx.userId} +UGX ${creditAmount}`);
  } catch (e) {
    console.error('MarzPay callback error:', e.message);
  }
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
// CRONS
// ═══════════════════════════════════════════
async function runMaturityCheck() {
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    let count = 0;
    const now = new Date();
    const batch = db.batch();
    const notifPs = [];
    snap.forEach(doc => {
      const inv = doc.data();
      const mat = inv.maturityDate?.toDate?.() || null;
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
  } catch (e) { console.error('Maturity error:', e.message); return 0; }
}

function startCrons() {
  setInterval(runMaturityCheck, 30 * 60 * 1000);
  runMaturityCheck();
  console.log('⏰ Crons started');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`◈ Nexus Investment Server on port ${PORT}`);
  console.log(`  URL: ${RAILWAY_URL || '(set RAILWAY_URL)'}`);
  startCrons();
});
