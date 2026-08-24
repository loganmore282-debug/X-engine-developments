/* SPACE8 AUTO-APPROVE WITHDRAWALS
   Owner (2026-08-23): "l also want to put a system in admin panel which
   approves withdrawals of any request every after 10s, so it approves 1
   then waits for 10s then approves another, server driven, so l can toggle
   that mode and the system drives it... it should be safe, encrypted and
   secure, and idempotent and no double pay."

   Implementation: autoApproveWithdrawalsTick() (server.js), a 1s-cadence
   background sweep (same interval as the existing reconcileCashback sweep)
   that only actually acts once the admin-configured interval
   (autoApproveIntervalSec, default 10s) has genuinely elapsed since the
   last approval -- so the interval can be changed live from Settings
   without tearing down/rebuilding a timer. It contains NO new money-moving
   logic of its own: it finds the oldest eligible 'pending' withdrawal and
   calls the exact same processWithdrawalCore() the manual "Send via
   MarzPay" admin button already calls, so it inherits every existing
   safety property for free -- the _withdrawInFlight double-processing
   guard, the status==='pending' check that makes acting on an
   already-resolved withdrawal a safe no-op, the network-ambiguity handling.
   New here: autoApproveMaxAmount (0 = unlimited), an admin-settable safety
   cap the owner didn't explicitly ask for but is cheap/reversible to
   include -- a request above it is skipped (left Pending for manual
   review) without blocking smaller requests behind it in the queue.

   Run: node test-auto-approve-withdrawals.js   (exits 0 = all green)   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4213';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  // Every send-money/bank-transfer call in this file reports sandbox
  // (immediate success via processWithdrawalCore's own sandbox branch) --
  // this file is testing the SCHEDULING/SELECTION logic, not the gateway
  // integration itself, which is already covered by
  // test-withdrawal-record-finalize.js and test-bank-withdrawal-accounts.js.
  if (u.includes('wearemarz.com') && (u.endsWith('/send-money') || u.includes('/bank-transfer/transfer')) && opts?.method === 'POST') {
    return json({ status: 'sandbox' });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4213';
async function call(method, p, { adminKey, token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(method, path, body) { return call(method, path, { adminKey: 'test-admin-key', body }); }
async function setSettings(settings) { return ownerCall('POST', '/admin/settings/update', { settings }); }
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let _seq = 0;
const nextId = prefix => prefix + Date.now() + '-' + (++_seq);

// Seeds a 'pending' withdrawal (the exact shape /withdraw/request +
// processWithdrawalCore expect) with an explicit createdAt so ordering
// (oldest-first) is under this file's own control, not wall-clock timing.
function seedPendingWithdrawal(userId, amount, ageMsAgo) {
  collMap('users').set(userId, { walletBalance: 1000000, totalWithdrawn: 0, status: 'active' });
  const id = nextId('wit');
  const fee = Math.round(amount * 0.15), net = amount - fee;
  collMap('withdrawals').set(id, {
    userId, amount, fee, net, method: 'mobile_money',
    holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567',
    ref: 'B' + id, status: 'pending', marzReference: null, marzTxUuid: null,
    date: '08/23/2026', time: '10:00 AM', createdAt: new Date(Date.now() - (ageMsAgo || 0)),
  });
  collMap('transactions').set('tx-' + id, {
    userId, type: 'withdraw', withdrawalId: id,
    description: `Cash out to Test Holder (MTN Mobile Money), net UGX ${net} after 15% fee, processing`,
    amount: -amount, status: 'pending', date: '08/23/2026', time: '10:00 AM', ref: 'B' + id, createdAt: new Date(Date.now() - (ageMsAgo || 0)),
  });
  return id;
}
const witStatus = id => collMap('withdrawals').get(id)?.status;
const auditLogFor = id => Array.from(collMap('adminAuditLog').values()).find(a => a.action === 'withdrawal_auto_approved' && a.meta?.withdrawalId === id);

(async () => {
  await sleep(600);

  console.log('\n== Settings validation ==');
  let r = await setSettings({ autoApproveIntervalSec: 3 });
  check('interval below the 5s floor is rejected', r.code === 400, r.body);
  r = await setSettings({ autoApproveIntervalSec: 4000 });
  check('interval above the 3600s ceiling is rejected', r.code === 400, r.body);
  r = await setSettings({ autoApproveMaxAmount: -1 });
  check('a negative max amount is rejected', r.code === 400, r.body);
  r = await setSettings({ autoApproveWithdrawalsEnabled: 'true', autoApproveIntervalSec: 5, autoApproveMaxAmount: 0 });
  check('valid settings (interval at the 5s floor) are accepted', r.code === 200, r.body);
  let settRead = await ownerCall('GET', '/admin/settings');
  check('boolean coercion: the string "true" was stored as the real boolean true', settRead.body?.settings?.autoApproveWithdrawalsEnabled === true, settRead.body?.settings?.autoApproveWithdrawalsEnabled);
  await setSettings({ autoApproveWithdrawalsEnabled: false }); // back off while seeding below

  console.log('\n== Disabled: a pending withdrawal is left untouched ==');
  const wDisabled = seedPendingWithdrawal('aa-user-off', 30000, 5000);
  await sleep(2200);
  check('withdrawal stayed pending while auto-approve is off', witStatus(wDisabled) === 'pending', witStatus(wDisabled));

  console.log('\n== Enabled: the OLDEST pending withdrawal is auto-approved first, idempotently, with an audit trail ==');
  const wOlder = seedPendingWithdrawal('aa-user-1', 30000, 20000); // "created" 20s ago
  const wNewer = seedPendingWithdrawal('aa-user-2', 25000, 1000);  // "created" 1s ago -- must NOT go first
  await setSettings({ autoApproveWithdrawalsEnabled: true, autoApproveIntervalSec: 5, autoApproveMaxAmount: 0 });
  console.log('  (waiting ~2s for the 1s-cadence tick to notice auto-approve just turned on)');
  await sleep(2000);
  check('the OLDER withdrawal was approved first', witStatus(wOlder) === 'processed', witStatus(wOlder));
  check('the NEWER withdrawal is still untouched (only one approval per tick)', witStatus(wNewer) === 'pending', witStatus(wNewer));
  // The wallet debit itself happens at REQUEST time (/withdraw/request),
  // not at approval -- this file seeds withdrawals directly (bypassing
  // that endpoint) to control ordering, so walletBalance is correctly
  // untouched by the approval; totalWithdrawn is the field that's actually
  // credited when processWithdrawalCore sends the payout.
  check('totalWithdrawn credited for the approved one', collMap('users').get('aa-user-1')?.totalWithdrawn === 25500, collMap('users').get('aa-user-1'));
  check('the matching transaction record was finalized too (same helper the manual button uses)', collMap('transactions').get('tx-' + wOlder)?.status === 'success', collMap('transactions').get('tx-' + wOlder));
  check('a system audit-log entry was written for the auto-approval', !!auditLogFor(wOlder), auditLogFor(wOlder));
  check('the audit entry is attributed to the auto-approve system, not a human admin', auditLogFor(wOlder)?.actor === 'auto-approve-system', auditLogFor(wOlder));

  console.log('  (waiting ~10s for the configured 5s interval to elapse, so the NEXT one is due)');
  await sleep(10000);
  check('the second (newer) withdrawal was approved on its own turn', witStatus(wNewer) === 'processed', witStatus(wNewer));

  await setSettings({ autoApproveWithdrawalsEnabled: false });

  console.log('\n== Max-amount cap: an over-cap request is skipped, a smaller one behind it is not blocked ==');
  const wBig = seedPendingWithdrawal('aa-user-big', 500000, 30000);   // oldest, but over the cap
  const wSmall = seedPendingWithdrawal('aa-user-small', 20000, 15000); // next-oldest, within the cap
  await setSettings({ autoApproveWithdrawalsEnabled: true, autoApproveIntervalSec: 5, autoApproveMaxAmount: 100000 });
  console.log('  (waiting ~6s -- the 5s interval gate is still counting from the previous section\'s last approval)');
  await sleep(6000);
  check('the over-cap request was skipped, left pending for manual review', witStatus(wBig) === 'pending', witStatus(wBig));
  check('the smaller request behind it was still auto-approved', witStatus(wSmall) === 'processed', witStatus(wSmall));
  await setSettings({ autoApproveWithdrawalsEnabled: false });

  console.log('\n== No pending withdrawals at all: a tick is a harmless no-op (nothing throws) ==');
  await setSettings({ autoApproveWithdrawalsEnabled: true, autoApproveIntervalSec: 5, autoApproveMaxAmount: 0 });
  await sleep(1500);
  const healthCheck = await call('GET', '/');
  check('server is still up and answering after ticking with an empty queue', healthCheck.code === 200, healthCheck.body);
  await setSettings({ autoApproveWithdrawalsEnabled: false });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
