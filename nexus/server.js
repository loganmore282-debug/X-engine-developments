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

// ── FIREBASE AUTH (Auth only — Firestore replaced by MongoDB) ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT invalid:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── MONGODB (replaces Firestore) ──
const { connectMongo, db, FieldValue } = require('./db');

// ── CONFIG ──
const ADMIN_KEY    = process.env.ADMIN_KEY    || '';
const SMS_SECRET   = process.env.SMS_SECRET   || '';
const RAILWAY_URL  = (() => {
  let u = (process.env.RAILWAY_URL || '').trim().replace(/\/$/, '');
  if (u && !u.startsWith('http')) u = 'https://' + u;
  return u;
})();

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64 encoded credentials

const MIN_WITHDRAWAL   = 15000;
const CHECKIN_BONUS    = 500;
const WELCOME_BONUS    = 7000;
const COMM_L1          = 0.10;
const COMM_L2          = 0.05;
const COMM_L3          = 0.02;
const LIQUIDITY_FEE    = 0.17;
// Agent tier ladder — ordered highest → lowest (array order matters for findIndex)
const AGENT_TIERS = [
  { key: 'executive_agent', label: 'Executive Agent', icon: '🚀', threshold: 50, weeklyPay: 280000 },
  { key: 'national_agent',  label: 'National Agent',  icon: '👑', threshold: 30, weeklyPay: 220000 },
  { key: 'regional_agent',  label: 'Regional Agent',  icon: '💎', threshold: 20, weeklyPay: 170000 },
  { key: 'super_agent',     label: 'Super Agent',     icon: '🥇', threshold: 15, weeklyPay: 120000 },
  { key: 'agent',           label: 'Agent',           icon: '🥈', threshold: 10, weeklyPay:  75000 },
  { key: 'junior_agent',    label: 'Junior Agent',    icon: '🥉', threshold:  5, weeklyPay:  30000 },
];
function getTierForCount(count) {
  return AGENT_TIERS.find(t => count >= t.threshold) || null;
}

// ── SETTINGS CACHE — reads MongoDB `settings/main`, TTL 5 min ──
// Admin-editable rates (commL1/L2/L3, liquidityFee, minWithdrawal) live here;
// hardcoded constants above are fallbacks only so a bad DB value never breaks the server.
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

// ── MarzPay API helpers (JSON body — matches X-engine proven implementation) ──
async function marzCollect({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'Online Deposit' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/collect-money`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'Withdrawal' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/send-money`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}
// Get collection status — uses /collect-money/{uuid} per MarzPay docs
async function marzGetCollectStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/collect-money/${uuid}`, {
      headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
// Get disbursement status — uses /send-money/{uuid} per MarzPay docs
async function marzGetStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/send-money/${uuid}`, {
      headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
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
const BYPASS = ['/', '/sms/incoming', '/admin', '/callback', '/deposit/callback', '/withdraw/callback'];
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
function phoneToEmail(phone) { return String(phone).replace(/\D/g,'') + '@nexus-app.com'; }

// Verify Firebase ID token — returns uid on success, null on failure.
// All user-action endpoints call this so the server never trusts a client-provided userId.
async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch (_) { return null; }
}
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

// Trusted MoMo sender names — reject SMS from any other sender to block spoofed messages.
const TRUSTED_SENDERS = new Set([
  'mtnmobmoney', 'mtnmobilemoney', 'mtn momo', 'mtn uganda',
  'airtelmoney', 'airtel money', 'airtel uganda',
  'momo', 'mobilemoney'
]);
function isTrustedSender(sender) {
  if (!sender) return false;
  return TRUSTED_SENDERS.has(String(sender).toLowerCase().trim());
}

// Parse MoMo REVERSAL SMS — returns { txnId, amount } or null.
// MTN reversal: "Your transaction of UGX 500 ... has been reversed. TxnID: 12345678."
// Airtel reversal: "REVERSED. TID 149730678579. UGX 500 ..."
function parseReversalSMS(sms) {
  if (!sms) return null;
  const text = sms.trim();

  // MTN reversal
  const mtnR = text.match(/reversed[\s\S]*?(?:TxnID|ID)[:\s]+(\d{6,})/i);
  if (mtnR && /reversed/i.test(text)) {
    const amtM = text.match(/UGX\s*([\d,]+)/i);
    return { txnId: mtnR[1], amount: amtM ? parseInt(amtM[1].replace(/,/g,''),10) : 0 };
  }
  // Airtel reversal
  const airR = text.match(/REVERSED\.\s*TID\s+(\d+)\.\s*UGX\s*([\d,]+)/i);
  if (airR) return { txnId: airR[1], amount: parseInt(airR[2].replace(/,/g,''),10) };

  return null;
}

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

// ── AGENT PROMOTION ──
// Called after every investment. Checks the investor's referrer for tier promotion
// or upgrade (Agent → Senior Agent → Regional Agent). Uses a transaction to
// prevent race conditions. Never downgrades a tier.
async function checkAgentPromotion(investorId) {
  try {
    const invSnap = await db.collection('users').doc(investorId).get();
    if (!invSnap.exists) return;
    const referrerId = invSnap.data().referredBy;
    if (!referrerId || referrerId === investorId) return;

    const refSnap = await db.collection('users').doc(referrerId).get();
    if (!refSnap.exists) return;

    // Already at highest tier — nothing to check
    if (refSnap.data().agentTier === 'executive_agent') return;

    // Count direct referrals who have actually invested.
    // Single-field query + client-side filter avoids a composite index
    // (equality + inequality on different fields would otherwise require one,
    //  and the thrown error would silently disable all agent promotions).
    const teamSnap = await db.collection('users')
      .where('referredBy', '==', referrerId)
      .get();
    const count = teamSnap.docs.filter(d => (d.data().totalInvested || 0) > 0).length;
    await db.collection('users').doc(referrerId).update({ activeReferralCount: count });

    const targetTier = getTierForCount(count);
    if (!targetTier) return; // below lowest threshold

    const currentTierKey = refSnap.data().agentTier || null;
    if (currentTierKey === targetTier.key) return; // already at target tier

    // Only upgrade, never downgrade (lower index in AGENT_TIERS = higher tier)
    const currentIdx = currentTierKey ? AGENT_TIERS.findIndex(t => t.key === currentTierKey) : AGENT_TIERS.length;
    const targetIdx  = AGENT_TIERS.findIndex(t => t.key === targetTier.key);
    if (targetIdx >= currentIdx) return; // target is same or lower tier

    const isFirstPromotion = !currentTierKey;
    const { date, time } = nowStr();

    await db.runTransaction(async t => {
      const rRef   = db.collection('users').doc(referrerId);
      const rFresh = await t.get(rRef);
      const freshTierKey = rFresh.data().agentTier || null;
      const freshIdx = freshTierKey ? AGENT_TIERS.findIndex(tt => tt.key === freshTierKey) : AGENT_TIERS.length;
      if (targetIdx >= freshIdx) return; // race-condition guard
      t.update(rRef, {
        isAgent:             true,
        agentTier:           targetTier.key,
        activeReferralCount: count,
        ...(isFirstPromotion ? { agentSince: FieldValue.serverTimestamp(), agentPayoutTotal: 0, lastAgentPayoutDate: null } : {})
      });
      t.set(db.collection('transactions').doc(), {
        userId: referrerId, type: 'agent_promotion',
        description: `${isFirstPromotion ? 'Promoted to' : 'Upgraded to'} ${targetTier.label} — ${count} active referrals`,
        amount: 0, status: 'success', date, time,
        createdAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`⭐ ${isFirstPromotion ? 'Promoted' : 'Upgraded'}: ${referrerId} → ${targetTier.label} (${count} referrals)`);
  } catch (e) { console.error('Agent promotion error:', e.message); }
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

      // ── FRAUD: reject SMS from untrusted senders (blocks spoofed messages) ──
      if (!isTrustedSender(fromPhone)) {
        console.log(`🚫 SMS rejected — untrusted sender: "${fromPhone}"`);
        return;
      }

      // ── FRAUD: handle reversal SMS before trying to parse as deposit ──
      const reversal = parseReversalSMS(body);
      if (reversal && reversal.txnId) {
        console.log(`🔄 Reversal SMS: txnId ${reversal.txnId} — ${fmtUGX(reversal.amount)}`);
        // Find the original processed deposit
        const origSnap = await db.collection('processedSMS').doc(reversal.txnId).get();
        if (origSnap.exists) {
          const orig = origSnap.data();
          if (orig.userId && orig.matched !== false) {
            const { date, time } = nowStr();
            await db.runTransaction(async t => {
              const uRef  = db.collection('users').doc(orig.userId);
              const uSnap = await t.get(uRef);
              if (!uSnap.exists) return;
              const debit = reversal.amount || orig.amount || 0;
              const newBal = Math.max(0, (uSnap.data().walletBalance || 0) - debit);
              t.update(uRef, { walletBalance: newBal, totalDeposited: FieldValue.increment(-debit) });
              t.update(origSnap.ref, { reversed: true, reversedAt: FieldValue.serverTimestamp() });
              t.set(db.collection('transactions').doc(), {
                userId: orig.userId, type: 'reversal',
                description: `Online deposit reversed — ${reversal.txnId}`,
                amount: -debit, status: 'reversed', date, time,
                createdAt: FieldValue.serverTimestamp()
              });
            });
            console.log(`↩️ Deposit reversed: ${reversal.txnId} — ${fmtUGX(reversal.amount || orig.amount)} debited from ${orig.userId}`);
          }
        } else {
          console.log(`⚠️ Reversal for unknown txnId: ${reversal.txnId}`);
        }
        return;
      }

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
      const withdrawableAt = new Date(now.getTime() + 60 * 60 * 1000); // 60-min hold

      // Find matching pending deposit: senderPhone + pending + not expired
      let matchedDep = null, matchedRef = null;
      if (payerPhone && payerPhone.length >= 9) {
        const pendSnap = await db.collection('pendingDeposits')
          .where('senderPhone', '==', payerPhone)
          .limit(10)
          .get();
        for (const d of pendSnap.docs) {
          const dep = d.data();
          if (dep.status !== 'pending') continue;
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
            walletBalance:    (uSnap.data().walletBalance || 0) + amount,
            totalDeposited:   FieldValue.increment(amount),
            lastDepositAt:    FieldValue.serverTimestamp(),
            withdrawableFrom: withdrawableAt
          });
          t.set(db.collection('processedSMS').doc(txnId), {
            userId, amount, payerPhone, txnId,
            depositId: matchedRef.id, matched: true,
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
            description: `Online deposit — received`,
            amount, phone: payerPhone, txnId,
            network: matchedDep.network || 'MoMo',
            status: 'success', date, time,
            createdAt: FieldValue.serverTimestamp()
          });
        });
        console.log(`✅ Deposit matched: ${matchedRef.id} — ${fmtUGX(amount)} → ${userId} (withdrawable after 1h)`);
        payCommissions(userId, amount, 'dep_' + matchedRef.id).catch(e => console.error('Deposit commission err:', e.message));
      } else {
        // No match — store for admin review
        await db.collection('unmatchedDeposits').add({
          smsBody: body, payerPhone,
          senderName: senderName || '', amount, txnId,
          status: 'unmatched', receivedAt: FieldValue.serverTimestamp()
        });
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
        description: `Online deposit (admin assigned) — ${dep.txnId || depositId}`,
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
// TEAM MEMBERS — list of people referred by this user
// ═══════════════════════════════════════════
app.post('/team/members', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').where('referredBy', '==', userId).get();
    const members = [];
    snap.forEach(doc => {
      const d = doc.data();
      // Mask name: show first name only, truncated
      const displayName = (d.name || '').split(' ')[0] || 'User';
      // Mask phone: keep country code + first 3 digits, hide rest  e.g. +256 77X XXX XXX
      const rawPhone = d.phone || '';
      let maskedPhone = rawPhone;
      if (rawPhone.length >= 10) {
        maskedPhone = rawPhone.slice(0, rawPhone.length - 5) + '*****';
      }
      members.push({
        id: doc.id,
        name: displayName,
        phone: maskedPhone,
        joinedAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        hasInvested: (d.totalInvested || 0) > 0,
        totalInvested: d.totalInvested || 0,
        referralCode: d.referralCode || null,
      });
    });
    // Sort by join date newest first
    members.sort((a, b) => (b.joinedAt || '') > (a.joinedAt || '') ? 1 : -1);
    return res.json({ status: 'success', members });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENTS
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  const { productId } = req.body;
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
        maturityDate: matDate,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Invested in ${product.name}`,
        amount: -price, status: 'success', date, time,
        investmentId: invRef.id, productId, createdAt: FieldValue.serverTimestamp()
      });
    });
    payCommissions(userId, price, invId).catch(e => console.error('Commission err:', e.message));
    checkAgentPromotion(userId).catch(e => console.error('Agent check err:', e.message));
    console.log(`✅ Investment: ${invId} — ${fmtUGX(price)} — ${userId}`);
    return res.json({ status: 'success', investmentId: invId, message: `Invested ${fmtUGX(price)} in ${product.name}` });
  } catch (e) {
    console.error('Invest error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/invest/claim', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  const { investmentId } = req.body;
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
  const userId = await verifyAuth(req) || req.body.userId;
  const { amount, phone } = req.body;
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
    if (amt % 5000 !== 0) {
      const lo = Math.floor(amt / 5000) * 5000;
      const hi = lo + 5000;
      const suggestion = lo >= minWit ? `${fmtUGX(lo)} or ${fmtUGX(hi)}` : `${fmtUGX(hi)}`;
      return res.status(400).json({ status: 'error', message: `Amount must be a multiple of UGX 5,000. Try ${suggestion}` });
    }
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
        status: 'pending', date, time,
        withdrawalId: witRef.id,
        createdAt: FieldValue.serverTimestamp()
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

// Shared: mark a withdrawal as processed + update user + tx record
async function completeWithdrawal(witDoc) {
  const wit = witDoc.data();
  if (wit.status === 'processed' || wit.status === 'failed') return false;
  // Re-read status inside a transaction so the dual-track HTTP poll and the
  // webhook can't BOTH apply this (double totalWithdrawn). First writer wins.
  const applied = await db.runTransaction(async t => {
    const fresh = await t.get(witDoc.ref);
    const fs = fresh.data();
    if (!fs || fs.status === 'processed' || fs.status === 'failed') return false;
    t.update(witDoc.ref, { status: 'processed', completedAt: FieldValue.serverTimestamp() });
    t.update(db.collection('users').doc(wit.userId), {
      totalWithdrawn: FieldValue.increment(wit.netAmount || wit.amount)
    });
    return true;
  });
  if (!applied) return false;
  // Update tx record — lookup by withdrawalId (single-field index, no composite needed)
  try {
    const txSnap = await db.collection('transactions')
      .where('withdrawalId', '==', witDoc.id).limit(1).get();
    if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'success' });
  } catch (txErr) { console.warn('completeWithdrawal tx update:', txErr.message); }
  console.log(`✅ Withdrawal complete: ${witDoc.id} → ${wit.userId} ${fmtUGX(wit.netAmount || wit.amount)}`);
  return true;
}

// Shared: refund a failed withdrawal
async function failWithdrawal(witDoc, reason) {
  const wit = witDoc.data();
  if (wit.status === 'processed' || wit.status === 'failed') return false;
  const { date, time } = nowStr();
  await db.runTransaction(async t => {
    const uRef  = db.collection('users').doc(wit.userId);
    const uSnap = await t.get(uRef);
    if (!uSnap.exists) throw new Error('User not found');
    t.update(uRef, { walletBalance: (uSnap.data().walletBalance || 0) + wit.amount,
      withdrawalCount: FieldValue.increment(-1) });
    t.update(witDoc.ref, { status: 'failed', failureReason: reason, failedAt: FieldValue.serverTimestamp() });
    t.set(db.collection('transactions').doc(), {
      userId: wit.userId, type: 'refund', description: 'Withdrawal refund — disbursement failed',
      amount: wit.amount, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
  });
  // Flip tx record to failed
  try {
    const txSnap = await db.collection('transactions')
      .where('withdrawalId', '==', witDoc.id).limit(1).get();
    if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'failed' });
  } catch (txErr) { console.warn('failWithdrawal tx update:', txErr.message); }
  console.log(`❌ Withdrawal failed+refunded: ${witDoc.id} — ${reason}`);
  return true;
}

app.get('/withdraw/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('withdrawals').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error' });
    let wit = snap.data();

    // If still processing, actively check MarzPay — fallback for missing webhook
    if (wit.status === 'processing' && (wit.marzTxUuid || wit.marzReference)) {
      try {
        const rawStatus = await marzGetStatus(wit.marzTxUuid || wit.marzReference);
        console.log(`Withdraw poll [${snap.id}]: status=${rawStatus}`);
        const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
        const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
        if (isSuccess) await completeWithdrawal(snap);
        else if (isFailed) await failWithdrawal(snap, rawStatus);
        if (isSuccess || isFailed) {
          const fresh = await db.collection('withdrawals').doc(snap.id).get();
          wit = fresh.data();
        }
      } catch (pollErr) { console.warn('Withdraw poll error:', pollErr.message); }
    }

    return res.json({ status: 'success', data: { id: snap.id, ...wit } });
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
    const mpData = await marzSendMoney({
      amount: netAmount, phone, reference,
      description: `${wit.userName || wit.userId}`,
      callbackUrl: RAILWAY_URL ? RAILWAY_URL + '/withdraw/callback' : undefined
    });
    console.log('MarzPay send-money response:', JSON.stringify(mpData));

    // Accept success, pending, and sandbox (test mode)
    const witSandbox = mpData.status === 'sandbox' || mpData.data?.disbursement?.mode === 'sandbox';
    if (mpData.status !== 'success' && mpData.status !== 'pending' && !witSandbox) {
      return res.status(400).json({ status: 'error', message: mpData.message || 'MarzPay disbursement failed' });
    }

    // Update withdrawal to processing
    const { date, time } = nowStr();
    const batch = db.batch();

    const marzTxUuid = mpData.data?.transaction?.uuid || '';
    if (witSandbox) {
      // Sandbox: no webhook fires — mark processed immediately so user sees success
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processed', marzReference: reference, marzTxUuid,
        processedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp()
      });
      batch.update(db.collection('users').doc(wit.userId), {
        totalWithdrawn: FieldValue.increment(wit.netAmount || wit.amount)
      });
    } else {
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processing', marzReference: reference, marzTxUuid,
        processedAt: FieldValue.serverTimestamp()
      });
    }

    // Commit the critical status update FIRST — nothing below can block this
    await batch.commit();

    // Non-critical: update matching tx record (single-field lookup, no composite index)
    try {
      const txSnap = await db.collection('transactions')
        .where('withdrawalId', '==', withdrawalId).limit(1).get();
      if (!txSnap.empty) {
        await txSnap.docs[0].ref.update({
          status: witSandbox ? 'success' : 'processing',
          marzReference: reference
        });
      }
    } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }

    const msg = witSandbox
      ? `Sandbox: withdrawal marked complete — ${fmtUGX(netAmount)} to ${phone}`
      : `Withdrawal processing — ${fmtUGX(netAmount)} being sent to ${phone}`;
    console.log(`💸 ${msg}`);
    return res.json({ status: 'success', message: msg, sandbox: witSandbox });
  } catch (e) {
    console.error('Process withdrawal error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// MARZPAY WITHDRAWAL CALLBACK (disbursement webhook)
// ═══════════════════════════════════════════
// Actual observed webhook shape:
//   transaction.uuid      = MarzPay's UUID  (stored as marzTxUuid in our Firestore)
//   transaction.reference = MarzPay's own reference number (NOT our UUID)
// We match on marzTxUuid first; fall back to marzReference for legacy records.
app.post('/withdraw/callback', async (req, res) => {
  res.status(200).json({ received: true });
  setImmediate(async () => {
  const body = req.body;
  console.log('💸 Withdraw callback:', JSON.stringify(body));
  try {
    const marzUuid  = body.transaction?.uuid  || body.data?.transaction?.uuid  || '';
    const reference = body.transaction?.reference || body.reference || body.data?.transaction?.reference || '';

    const rawStatus = (() => {
      const s = String(body.transaction?.status || body.status || '').toLowerCase();
      if (s) return s;
      if (body.event_type === 'disbursement.completed') return 'completed';
      if (body.event_type === 'disbursement.failed')    return 'failed';
      if (body.event_type === 'disbursement.cancelled') return 'cancelled';
      if (body.event_type === 'disbursement.pending')   return 'pending';
      return '';
    })();
    const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
    const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
    console.log(`Withdraw callback uuid=${marzUuid} ref=${reference} status=${rawStatus}`);

    if ((!marzUuid && !reference) || (!isSuccess && !isFailed)) return;

    // Primary: match by MarzPay's transaction UUID (most reliable)
    let witSnap = marzUuid
      ? await db.collection('withdrawals').where('marzTxUuid', '==', marzUuid).limit(1).get()
      : { empty: true };

    // Fallback: match by the reference we passed to MarzPay at create time
    if (witSnap.empty && reference) {
      witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
    }

    if (witSnap.empty) {
      console.log('No withdrawal for uuid:', marzUuid, 'or ref:', reference);
      return;
    }
    const witDoc = witSnap.docs[0];

    if (isSuccess) {
      // Anti-fraud: verify with MarzPay before marking processed
      if (witDoc.data().marzTxUuid) {
        const realStatus = await marzGetStatus(witDoc.data().marzTxUuid);
        if (realStatus && !['completed', 'successful', 'success', 'paid'].includes(realStatus)) {
          console.warn(`🚨 FRAUD BLOCK: callback says success but MarzPay says '${realStatus}' — NOT processing`);
          return;
        }
      }
      await completeWithdrawal(witDoc);
    } else if (isFailed) {
      const reason = body.transaction?.description || body.description || rawStatus || 'Disbursement failed';
      await failWithdrawal(witDoc, reason);
    }
  } catch (e) { console.error('Withdraw callback error:', e.message); }
  });
});

// ═══════════════════════════════════════════
// CHECK-IN
// ═══════════════════════════════════════════
app.post('/checkin', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
const _giftRateMap = new Map(); // userId → last attempt timestamp
app.post('/giftcode/redeem', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  const { code } = req.body;
  if (!userId || !code) return res.status(400).json({ status: 'error', message: 'userId and code required' });
  // Rate limit: max 1 attempt per 10 seconds per user
  const lastTry = _giftRateMap.get(userId) || 0;
  if (Date.now() - lastTry < 10000)
    return res.status(429).json({ status: 'error', message: 'Too many attempts. Wait a moment.' });
  _giftRateMap.set(userId, Date.now());
  try {
    const snap = await db.collection('giftCodes').where('code', '==', code.toUpperCase().trim()).limit(1).get();
    if (snap.empty) return res.status(404).json({ status: 'error', message: 'Invalid gift code' });
    const gc  = snap.docs[0];
    const gcd = gc.data();
    if (!gcd.active) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
    if ((gcd.usedBy || []).includes(userId)) return res.status(400).json({ status: 'error', message: 'You have already redeemed this code' });
    if (gcd.maxUsers && (gcd.usedBy || []).length >= gcd.maxUsers) return res.status(400).json({ status: 'error', message: 'Usage limit reached — this code has expired' });
    if (gcd.expiresAt && gcd.expiresAt.toDate() < new Date()) return res.status(400).json({ status: 'error', message: 'This gift code has expired' });
    // Admin-controlled payout band (settings/main → minGift / maxGift). Falls back to 200–2000.
    const sett    = await getSettings();
    const giftLo  = Math.max(0, Math.round(sett.minGift ?? 200));
    const giftHi  = Math.max(giftLo, Math.round(sett.maxGift ?? 2000));
    const amount  = Math.floor(Math.random() * (giftHi - giftLo + 1)) + giftLo;
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
// Force-complete a stuck MarzPay deposit (polls MarzPay then credits if confirmed)
app.post('/admin/deposit/complete', async (req, res) => {
  const { depositId, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    const dep = snap.data();
    if (dep.status === 'matched') return res.json({ status: 'success', message: 'Already credited' });
    const result = await pollMarzDepositStatus(snap);
    if (result.credited)
      return res.json({ status: 'success', message: `Credited ${fmtUGX(result.amount)} to user` });
    if (result.failed)
      return res.status(400).json({ status: 'error', message: 'MarzPay confirms payment failed' });
    return res.status(400).json({ status: 'error', message: 'MarzPay status still pending — try again in a moment' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

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
      if (expiresAt) docData.expiresAt = expiresAt;
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
// DEPOSIT — MARZPAY (USSD push-to-pay)
// ═══════════════════════════════════════════
app.post('/deposit/marzpay', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  const { amount, phone: rawPhone } = req.body;
  if (!userId || !amount) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  try {
    const [uSnap, sett] = await Promise.all([
      db.collection('users').doc(userId).get(),
      getSettings()
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const minDep = sett.minDeposit || 30000;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });

    // Use phone from request if provided, otherwise fall back to profile phone
    const phone = cleanPhone(rawPhone || user.phone || '');
    if (!phone || phone.length < 10)
      return res.status(400).json({ status: 'error', message: 'Enter a valid MoMo phone number.' });

    const reference = uuidv4();
    const mpData = await marzCollect({
      amount: amt, phone, reference,
      description: `${user.name || userId}`,
      callbackUrl: RAILWAY_URL ? RAILWAY_URL + '/deposit/callback' : undefined
    });
    console.log('MarzPay collect-money:', JSON.stringify(mpData));

    // Sandbox mode returns status:'sandbox' — treat as valid initiation
    const isSandbox = mpData.status === 'sandbox' || mpData.data?.collection?.mode === 'sandbox';
    if (mpData.status !== 'success' && !isSandbox)
      return res.status(400).json({ status: 'error', message: mpData.message || 'Could not initiate payment. Try again.' });

    const marzTxUuid = mpData.data?.transaction?.uuid || null;
    const { date, time } = nowStr();

    // Cancel stale deposits — but NEVER cancel a 'processing' deposit younger than 5 min
    // because the USSD prompt may still be pending approval and money may have left the user's account.
    const oldSnap = await db.collection('pendingDeposits')
      .where('userId', '==', userId).limit(20).get();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const stale = oldSnap.docs.filter(d => {
      const dep = d.data();
      if (dep.status === 'pending') return true; // always cancel old pending (SMS-based)
      if (dep.status === 'processing') {
        const createdMs = dep.createdAt?.toDate?.()?.getTime() || 0;
        return createdMs < fiveMinAgo; // only cancel processing if older than 5 min
      }
      return false;
    });
    if (stale.length) {
      const b = db.batch();
      stale.forEach(d => b.update(d.ref, { status: 'cancelled' }));
      await b.commit();
    }

    const depRef = db.collection('pendingDeposits').doc();

    if (isSandbox) {
      // Sandbox: no webhook will fire — credit immediately so the full flow can be tested
      await db.runTransaction(async t => {
        const uRef  = db.collection('users').doc(userId);
        const uSnap = await t.get(uRef);
        if (!uSnap.exists) throw new Error('User not found');
        const bal       = uSnap.data().walletBalance || 0;
        const holdUntil = new Date(Date.now() + 60 * 60 * 1000);
        t.update(uRef, {
          walletBalance:    bal + amt,
          totalDeposited:   FieldValue.increment(amt),
          withdrawableFrom: holdUntil
        });
        t.set(depRef, {
          userId, phone, amount: amt, creditedAmount: amt,
          marzReference: reference, marzTxUuid,
          status: 'matched', date, time,
          matchedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'deposit',
          description: 'Online deposit',
          amount: amt, status: 'success', date, time, marzReference: reference,
          createdAt: FieldValue.serverTimestamp()
        });
      });
      console.log(`🏖️ Sandbox deposit matched: ${depRef.id} — ${fmtUGX(amt)} → ${userId}`);
    } else {
      await depRef.set({
        userId, phone, amount: amt, marzReference: reference, marzTxUuid,
        status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
      });
      console.log(`💳 MarzPay deposit: ${depRef.id} — ${fmtUGX(amt)} from ${phone}`);
    }

    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone, sandbox: isSandbox });
  } catch (e) {
    console.error('MarzPay deposit error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// DEPOSIT — INITIATE (SMS-based, kept as fallback)
// ═══════════════════════════════════════════
app.post('/deposit/initiate', async (req, res) => {
  const userId = await verifyAuth(req) || req.body.userId;
  const { senderPhone, amount, network, senderName } = req.body;
  if (!userId || !senderPhone || !amount)
    return res.json({ status: 'error', message: 'userId, senderPhone and amount required' });

  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0)
    return res.json({ status: 'error', message: 'Invalid amount' });

  try {
    // Get settings
    const settSnap = await db.collection('settings').doc('main').get();
    const settings = settSnap.exists ? settSnap.data() : {};
    const minDep = settings.minDeposit || 30000;
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
    // so the SMS matcher always finds the right one. Single-field query +
    // client-side status filter (avoids composite index).
    const oldSnap = await db.collection('pendingDeposits')
      .where('userId', '==', userId)
      .limit(20)
      .get();
    const now = new Date();
    const stalePending = oldSnap.docs.filter(d => d.data().status === 'pending');
    if (stalePending.length) {
      const batch = db.batch();
      stalePending.forEach(d => batch.update(d.ref, { status: 'cancelled' }));
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
      expiresAt: expiresAt,
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

app.get('/deposit/config', async (_req, res) => {
  try {
    const sett = await getSettings();
    return res.json({ status: 'success', minDeposit: sett.minDeposit || 30000 });
  } catch (e) { return res.json({ status: 'success', minDeposit: 30000 }); }
});

// Shared: credit a completed MarzPay deposit and update Firestore atomically.
// Used by both the webhook and the active-polling fallback.
async function creditMarzDeposit(depDoc, amount, provTxId) {
  const dep = depDoc.data();
  // Already credited or truly failed — skip. Allow 'cancelled' through: money may have
  // left the user's account if they paid before the cancel happened.
  if (dep.status === 'matched' || dep.status === 'failed') return false;
  const { date, time } = nowStr();
  await db.runTransaction(async t => {
    const fresh = await t.get(depDoc.ref);
    if (!fresh.exists) throw new Error('Deposit not found');
    if (fresh.data().status === 'matched' || fresh.data().status === 'failed') return;
    const uRef  = db.collection('users').doc(dep.userId);
    const uSnap = await t.get(uRef);
    if (!uSnap.exists) throw new Error('User not found');
    const bal = uSnap.data().walletBalance || 0;
    const holdUntil = new Date(Date.now() + 60 * 60 * 1000);
    t.update(uRef, {
      walletBalance:    bal + amount,
      totalDeposited:   FieldValue.increment(amount),
      withdrawableFrom: holdUntil
    });
    t.update(depDoc.ref, {
      status: 'matched', creditedAmount: amount,
      providerTxId: provTxId || null, matchedAt: FieldValue.serverTimestamp()
    });
    t.set(db.collection('transactions').doc(), {
      userId: dep.userId, type: 'deposit',
      description: 'Online deposit',
      amount, status: 'success', date, time, marzReference: dep.marzReference,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return true;
}

// Active MarzPay status check — polls MarzPay API for a processing deposit.
// Returns { credited, failed } or throws.
async function pollMarzDepositStatus(depDoc) {
  const dep = depDoc.data();
  const uuid = dep.marzTxUuid; // MarzPay's own transaction UUID — required for /collect-money/{uuid}
  if (!uuid || !MARZPAY_KEY) return { credited: false, failed: false };
  const rawStatus = await marzGetCollectStatus(uuid);
  console.log(`MarzPay poll [${dep.marzReference}]: status=${rawStatus}`);
  const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
  const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
  if (isSuccess) {
    const creditAmount = dep.amount;
    await creditMarzDeposit(depDoc, creditAmount, null);
    return { credited: true, failed: false, amount: creditAmount };
  }
  if (isFailed) {
    if (dep.status !== 'failed') await depDoc.ref.update({ status: 'failed',
      failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment failed or cancelled' });
    return { credited: false, failed: true };
  }
  return { credited: false, failed: false };
}

app.get('/deposit/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('pendingDeposits').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    let dep = snap.data();

    // If still processing, actively check MarzPay — this is the webhook fallback
    if (dep.status === 'processing') {
      try {
        const result = await pollMarzDepositStatus(snap);
        if (result.credited || result.failed) {
          const fresh = await db.collection('pendingDeposits').doc(snap.id).get();
          dep = fresh.data();
        }
      } catch (pollErr) { console.warn('MarzPay poll error:', pollErr.message); }
    }

    return res.json({
      status: 'success',
      deposit: {
        id:             snap.id,
        depositStatus:  dep.status,
        amount:         dep.amount,
        creditedAmount: dep.creditedAmount || dep.amount,
        network:        dep.network || null
      }
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// MarzPay deposit webhook handler — shared by /callback and /deposit/callback
async function handleDepositCallback(req, res) {
  res.status(200).json({ received: true }); // ack MarzPay immediately
  setImmediate(async () => {
    const body = req.body;
    console.log('📩 Deposit callback:', JSON.stringify(body));
    try {
      // Per MarzPay docs: transaction.reference = OUR UUID from the create request.
      // provider_reference is for disbursement flows only — not present in collection callbacks.
      const reference = body.transaction?.reference || body.reference || body.merchant_reference || '';
      if (!reference) { console.log('❌ No reference in callback'); return; }

      // Resolve status — check transaction.status first, then event_type
      const rawStatus = (() => {
        const s = String(body.transaction?.status || body.status || '').toLowerCase();
        if (s) return s;
        if (body.event_type === 'collection.completed') return 'completed';
        if (body.event_type === 'collection.successful') return 'successful';
        if (body.event_type === 'collection.failed')    return 'failed';
        if (body.event_type === 'collection.cancelled') return 'cancelled';
        if (body.event_type === 'collection.pending')   return 'pending';
        return '';
      })();
      const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
      const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
      console.log(`Deposit callback ref=${reference} status=${rawStatus}`);

      // Only act on final states
      if (!isSuccess && !isFailed) return;

      const depSnap = await db.collection('pendingDeposits')
        .where('marzReference', '==', reference).limit(1).get();
      if (depSnap.empty) { console.log('No pendingDeposit for ref:', reference); return; }
      const depDoc = depSnap.docs[0];

      if (isSuccess) {
        // Anti-fraud: verify status with MarzPay before crediting (uses /collect-money/{uuid})
        if (depDoc.data().marzTxUuid) {
          const realStatus = await marzGetCollectStatus(depDoc.data().marzTxUuid);
          if (realStatus && !['completed', 'successful', 'success', 'paid'].includes(realStatus)) {
            console.warn(`🚨 FRAUD BLOCK: callback says success but MarzPay says '${realStatus}' — NOT crediting`);
            return;
          }
        }
        const amount   = parseInt(body.transaction?.amount?.raw || body.collection?.amount?.raw, 10) || depDoc.data().amount;
        const provTxId = body.collection?.provider_transaction_id || null;
        const credited = await creditMarzDeposit(depDoc, amount, provTxId);
        if (credited) console.log(`✅ Webhook credited: ${depDoc.id} → ${depDoc.data().userId} ${fmtUGX(amount)}`);
      } else if (isFailed) {
        const failReason = body.transaction?.description || body.description || rawStatus || 'Payment declined';
        if (depDoc.data().status !== 'failed') {
          await depDoc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: failReason });
          console.log(`❌ Deposit failed [${reference}]: ${failReason}`);
        }
      }
    } catch (e) { console.error('Deposit callback error:', e.message); }
  });
}
app.post('/callback', handleDepositCallback);
app.post('/deposit/callback', handleDepositCallback);

// ── TICKER (anonymized global activity) ──
app.get('/ticker', async (req, res) => {
  try {
    // orderBy alone (single field) — filter status client-side to avoid a composite index
    const snap = await db.collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(60).get();
    const items = snap.docs
      .map(d => d.data())
      .filter(t => t.status === 'success')
      .slice(0, 20)
      .map(t => ({ type: t.type, amount: t.amount }));
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
    // Query both active AND matured-but-unclaimed investments so late cashback still pays
    const [activeSnap, maturedSnap] = await Promise.all([
      db.collection('investments').where('status', '==', 'active').get(),
      db.collection('investments').where('status', '==', 'matured').get()
    ]);
    const docs = [...activeSnap.docs, ...maturedSnap.docs];
    if (!docs.length) return 0;

    const now = new Date();
    const EAT      = 3 * 3600000;
    const todayKey = new Date(now.getTime() + EAT).toISOString().slice(0, 10);
    let credited   = 0;

    // Group by userId so we do one wallet update per user
    const byUser = {};
    docs.forEach(docSnap => {
      const inv = docSnap.data();
      if (!inv.dailyReturn || inv.dailyReturn <= 0) return;

      // Timestamp-based credit gate: require a FULL 24 h per credited day so that
      // someone who invests at 11 pm doesn't get paid at midnight (1 h later).
      // lastCreditTs = Unix ms of the last credit issue (or investment creation).
      // Migration: old docs have lastCreditDate (string) but no lastCreditTs —
      // treat that as midnight EAT of that date (conservative, prevents double-pay).
      const createdAtMs = inv.createdAt?.toDate?.()?.getTime() || now.getTime();
      let lastCreditTs;
      if (inv.lastCreditTs != null) {
        lastCreditTs = inv.lastCreditTs;
      } else if (inv.lastCreditDate) {
        lastCreditTs = new Date(inv.lastCreditDate + 'T00:00:00+03:00').getTime();
      } else {
        lastCreditTs = createdAtMs;
      }

      const elapsedMs = now.getTime() - lastCreditTs;
      const daysDue   = Math.min(Math.floor(elapsedMs / 86400000), inv.cycle || 1);
      if (daysDue <= 0) return;

      let amount = Math.round(inv.dailyReturn * daysDue);
      const expected = inv.expectedReturn || 0;
      if (expected > 0) amount = Math.min(amount, Math.max(0, expected - (inv.dailyCredited || 0)));
      if (amount <= 0) return;
      if (!byUser[inv.userId]) byUser[inv.userId] = { total: 0, docs: [] };
      byUser[inv.userId].total += amount;
      byUser[inv.userId].docs.push({ ref: docSnap.ref, amount, daysDue, lastCreditTs });
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
            lastCreditTs:   d.lastCreditTs + d.daysDue * 86400000,
            dailyCredited:  FieldValue.increment(d.amount)
          });
          t.set(db.collection('transactions').doc(), {
            userId, type: 'cashback',
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
      // A plan whose daily cashback has already paid out the full expected
      // return is complete — the money is already in the wallet, so mark it
      // 'claimed' (nothing left to claim) instead of leaving it stuck active.
      const fullyPaid = (inv.expectedReturn || 0) > 0 && (inv.dailyCredited || 0) >= (inv.expectedReturn || 0);
      if (fullyPaid) {
        batch.update(doc.ref, { status: 'claimed', claimedAt: FieldValue.serverTimestamp() });
        count++;
      } else if (mat && mat <= now) {
        batch.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() });
        count++;
      }
    });
    if (count > 0) { await batch.commit(); }
    if (count > 0) console.log(`⏰ Matured/completed: ${count} plan(s)`);
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

// ── AGENT WEEKLY PAYOUT ──
// Runs every 6 hours. Pays tier-appropriate stipend to every agent whose last
// payout was 7+ days ago. Weekly pay is re-read inside the transaction so a
// tier upgrade between runs is immediately reflected.
async function runAgentPayouts() {
  try {
    const EAT = 3 * 3600000;
    const nowMs = Date.now();
    const agentsSnap = await db.collection('users').where('isAgent', '==', true).get();
    if (agentsSnap.empty) return 0;
    let paid = 0;
    for (const agentDoc of agentsSnap.docs) {
      const agent  = agentDoc.data();
      const lastMs = agent.lastAgentPayoutDate
        ? new Date(agent.lastAgentPayoutDate).getTime() : 0;
      if (nowMs - lastMs < 7 * 86400000) continue;
      const { date, time } = nowStr();
      const todayKey = new Date(nowMs + EAT).toISOString().slice(0, 10);
      try {
        await db.runTransaction(async t => {
          const uRef  = db.collection('users').doc(agentDoc.id);
          const fresh = await t.get(uRef);
          if (!fresh.data().isAgent) return;
          const lastMsFresh = fresh.data().lastAgentPayoutDate
            ? new Date(fresh.data().lastAgentPayoutDate).getTime() : 0;
          if (nowMs - lastMsFresh < 7 * 86400000) return;
          // Use the freshest tier for payout amount; fall back to base 'agent' tier
          const tierCfg    = AGENT_TIERS.find(tt => tt.key === (fresh.data().agentTier || 'agent'))
                             || AGENT_TIERS.find(tt => tt.key === 'agent');
          const weeklyPay  = tierCfg.weeklyPay;
          t.update(uRef, {
            walletBalance:       FieldValue.increment(weeklyPay),
            agentPayoutTotal:    FieldValue.increment(weeklyPay),
            lastAgentPayoutDate: todayKey
          });
          t.set(db.collection('transactions').doc(), {
            userId: agentDoc.id, type: 'agent_bonus',
            description: `Weekly ${tierCfg.label} stipend`,
            amount: weeklyPay, status: 'success', date, time,
            createdAt: FieldValue.serverTimestamp()
          });
        });
        paid++;
        const tierCfg = AGENT_TIERS.find(tt => tt.key === (agent.agentTier || 'agent'))
                        || AGENT_TIERS.find(tt => tt.key === 'agent');
        console.log(`⭐ Agent payout: ${agentDoc.id} — ${fmtUGX(tierCfg.weeklyPay)} (${tierCfg.label})`);
      } catch (e) { console.error('Agent payout tx error:', agentDoc.id, e.message); }
    }
    if (paid > 0) console.log(`⭐ Agent payouts complete: ${paid} agent(s) paid`);
    return paid;
  } catch (e) { console.error('Agent payout error:', e.message); return 0; }
}

// One-time, idempotent migration: older builds wrote daily cashback
// transactions with type 'checkin'. Correct their type to 'cashback' so the
// client (which keys its labels off tx.type) shows them properly. Safe to run
// on every startup — once corrected, the query returns nothing.
async function migrateLegacyCashbackTxns() {
  try {
    const snap = await db.collection('transactions').where('type', '==', 'checkin').get();
    if (snap.empty) return 0;
    let fixed = 0;
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      const desc = doc.data().description || '';
      if (!/cashback/i.test(desc)) continue; // genuine daily check-ins keep their type
      batch.update(doc.ref, { type: 'cashback' });
      fixed++; ops++;
      if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
    if (fixed > 0) console.log(`🔧 Migrated ${fixed} legacy cashback transaction(s) checkin→cashback`);
    return fixed;
  } catch (e) { console.error('Cashback txn migration error:', e.message); return 0; }
}

// ═══════════════════════════════════════════
// RECONCILIATION — auto-resolve stuck deposits & withdrawals
// Runs every 30 min, only touches records older than 3 min (gives webhook time to fire first)
// ═══════════════════════════════════════════
async function runReconciliation() {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000); // 3 min ago
  let resolved = 0;
  try {
    // ── Stuck deposits (processing) ──
    const depSnap = await db.collection('pendingDeposits')
      .where('status', '==', 'processing').limit(20).get();
    for (const doc of depSnap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid) continue;
      const createdMs = dep.createdAt?.toDate?.()?.getTime() || 0;
      if (createdMs > cutoff.getTime()) continue; // too fresh — let webhook fire first
      try {
        const status = await marzGetCollectStatus(dep.marzTxUuid);
        if (['completed', 'successful', 'success', 'paid'].includes(status)) {
          const credited = await creditMarzDeposit(doc, dep.amount, null);
          if (credited) { console.log(`🔄 Reconciled deposit: ${doc.id} → ${dep.userId}`); resolved++; }
        } else if (['failed', 'cancelled', 'error', 'declined'].includes(status)) {
          await doc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: status });
          console.log(`🔄 Reconciled deposit failed: ${doc.id}`); resolved++;
        }
      } catch (e) { console.warn(`Reconcile deposit ${doc.id}:`, e.message); }
    }

    // ── Stuck withdrawals (processing) ──
    const witSnap = await db.collection('withdrawals')
      .where('status', '==', 'processing').limit(20).get();
    for (const doc of witSnap.docs) {
      const wit = doc.data();
      if (!wit.marzTxUuid) continue;
      const processedMs = wit.processedAt?.toDate?.()?.getTime() || 0;
      if (processedMs > cutoff.getTime()) continue;
      try {
        const status = await marzGetStatus(wit.marzTxUuid);
        if (['completed', 'successful', 'success', 'paid'].includes(status)) {
          const done = await completeWithdrawal(doc);
          if (done) { console.log(`🔄 Reconciled withdrawal: ${doc.id}`); resolved++; }
        } else if (['failed', 'cancelled', 'error', 'declined'].includes(status)) {
          await failWithdrawal(doc, status);
          console.log(`🔄 Reconciled withdrawal failed: ${doc.id}`); resolved++;
        }
      } catch (e) { console.warn(`Reconcile withdrawal ${doc.id}:`, e.message); }
    }

    if (resolved > 0) console.log(`✅ Reconciliation: ${resolved} record(s) resolved`);

    // ── Missed cashback (matured investments with uncredited daily returns) ──
    // Only check once per 30-min cycle; maturity cron covers the rest.
    try {
      const maturedSnap = await db.collection('investments')
        .where('status', '==', 'matured').limit(20).get();
      let needsCashback = false;
      for (const doc of maturedSnap.docs) {
        const inv = doc.data();
        if ((inv.dailyCredited || 0) >= (inv.expectedReturn || 0)) continue;
        const lastTs = inv.lastCreditTs || inv.createdAt?.toDate?.()?.getTime() || 0;
        if (Math.floor((Date.now() - lastTs) / 86400000) >= 1) { needsCashback = true; break; }
      }
      if (needsCashback) {
        console.log('🔄 Reconciliation found uncredited matured cashback — running cashback now');
        await runDailyCashback();
      }
    } catch (e) { console.warn('Reconcile matured cashback:', e.message); }

  } catch (e) { console.error('Reconciliation error:', e.message); }
}

function startCrons() {
  // Maturity check every 2 hours (was 30 min — 4× fewer reads)
  setInterval(runMaturityCheck, 2 * 60 * 60 * 1000);
  setTimeout(runMaturityCheck, 2 * 60 * 1000);
  // Daily cashback: midnight EAT scheduler + 6-hour safety net (was hourly — 6× fewer reads)
  scheduleMidnightEAT();
  setInterval(runDailyCashback, 6 * 60 * 60 * 1000);
  setTimeout(runDailyCashback, 3 * 60 * 1000);
  // Agent weekly payouts: every 6 hours
  setInterval(runAgentPayouts, 6 * 60 * 60 * 1000);
  setTimeout(runAgentPayouts, 5 * 60 * 1000);
  // Reconciliation: auto-resolve stuck deposits/withdrawals every 30 min
  setInterval(runReconciliation, 30 * 60 * 1000);
  setTimeout(runReconciliation, 4 * 60 * 1000); // first run 4 min after boot
  // One-time data correction for legacy cashback transactions
  migrateLegacyCashbackTxns();
  console.log('⏰ Crons started (maturity + cashback + agent payouts + reconciliation)');
}

// ═══════════════════════════════════════════
// ACCOUNT — server-side profile management
// ═══════════════════════════════════════════

// Called immediately after createUserWithEmailAndPassword on the client.
// Creates the Firestore user doc server-side so the client cannot set
// arbitrary fields (e.g. walletBalance).
app.post('/account/create-profile', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { name, phone, password } = req.body;
  if (!name || !phone) return res.status(400).json({ status: 'error', message: 'name and phone required' });
  try {
    const ref  = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) return res.json({ status: 'success', message: 'Profile already exists' });
    await ref.set({
      name: String(name).trim(),
      phone: cleanPhone(phone),
      email: phoneToEmail(phone),
      password: String(password || ''),
      walletBalance: 0, totalDeposited: 0, totalInvested: 0, totalWithdrawn: 0,
      totalEarned: 0, commissionEarned: 0, commissionL1Earned: 0,
      commissionL2Earned: 0, commissionL3Earned: 0,
      teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
      checkinEarned: 0, checkinStreak: 0, checkinDays: 0,
      withdrawalCount: 0, status: 'active',
      isAgent: false, agentTier: null, activeReferralCount: 0,
      agentPayoutTotal: 0, lastAgentPayoutDate: null, agentSince: null,
      bankAccounts: [], createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Backfills the login password so admin can view it — called on every login.
app.post('/account/save-password', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { password } = req.body;
  if (!password) return res.json({ status: 'success' });
  try {
    await db.collection('users').doc(uid).set({ password: String(password) }, { merge: true });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/account/add-bank', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ status: 'error', message: 'name and phone required' });
  const digits = String(phone).replace(/\D/g, '').slice(-9);
  if (digits.length < 9) return res.status(400).json({ status: 'error', message: 'Invalid phone number' });
  try {
    await db.collection('users').doc(uid).update({
      bankAccounts: FieldValue.arrayUnion({ name: String(name).trim(), phone: digits })
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/account/remove-bank', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ status: 'error', message: 'name and phone required' });
  try {
    await db.collection('users').doc(uid).update({
      bankAccounts: FieldValue.arrayRemove({ name: String(name).trim(), phone: String(phone) })
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/account/update-photo', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { photoUrl } = req.body;
  if (!photoUrl || !photoUrl.startsWith('https://')) return res.status(400).json({ status: 'error', message: 'Invalid photo URL' });
  try {
    await db.collection('users').doc(uid).update({ profilePhoto: photoUrl });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ADMIN SETTINGS READ + UPDATE (reads/writes MongoDB) ─────────────
app.post('/admin/settings', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('settings').doc('main').get();
    return res.json({ status: 'success', settings: snap.exists ? snap.data() : {} });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/admin/settings/update', async (req, res) => {
  const { adminKey, ...updates } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!Object.keys(updates).length) return res.status(400).json({ status: 'error', message: 'No fields to update' });
  try {
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    _maint = false; _maintTs = 0;
    return res.json({ status: 'success', updated: updates });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// ONE-TIME MIGRATION: Firestore → MongoDB
// Visit from phone browser (after Firebase quota resets at 8 AM EAT):
//   GET /admin/migrate-firestore-to-mongo?key=<ADMIN_KEY>
// Idempotent — safe to run multiple times. Streams progress live.
// ═══════════════════════════════════════════════════════════════════
function convertTimestamps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (typeof obj.toDate === 'function') return obj.toDate();
  if (Array.isArray(obj)) return obj.map(convertTimestamps);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = convertTimestamps(v);
  return out;
}

app.get('/admin/migrate-firestore-to-mongo', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('Forbidden');
  const COLS = [
    'users','investments','transactions','withdrawals',
    'pendingDeposits','processedSMS','unmatchedDeposits',
    'referrals','giftCodes','products','settings'
  ];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();
  res.write('Firestore → MongoDB migration started...\n\n');
  const fsdb = admin.firestore();
  let total = 0;
  for (const col of COLS) {
    try {
      res.write(`Collection: ${col} ... `);
      const snap = await fsdb.collection(col).get();
      if (snap.empty) { res.write('(empty)\n'); continue; }
      for (let i = 0; i < snap.docs.length; i += 50) {
        await Promise.all(snap.docs.slice(i, i + 50).map(doc =>
          db.collection(col).doc(doc.id).set(convertTimestamps(doc.data()))
        ));
      }
      total += snap.docs.length;
      res.write(`done (${snap.docs.length} docs)\n`);
    } catch (e) { res.write(`ERROR: ${e.message}\n`); }
  }
  res.write(`\nDone. ${total} documents copied to MongoDB.\n`);
  res.end();
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';

async function startServer() {
  if (!MONGODB_URI) { console.error('❌ MONGODB_URI env var not set'); process.exit(1); }
  await connectMongo(MONGODB_URI);
  app.listen(PORT, () => {
    console.log(`◈ Nexus Investment Server on port ${PORT}`);
    console.log(`  URL: ${RAILWAY_URL || '(set RAILWAY_URL)'}`);
    startCrons();
  });
}
startServer().catch(e => { console.error('Startup error:', e.message); process.exit(1); });
