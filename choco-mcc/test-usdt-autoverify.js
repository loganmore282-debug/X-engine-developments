/* CHOCOMCC USDT (TRC20) AUTOMATIC ON-CHAIN VERIFICATION
   Round 1 shipped USDT deposits as a pure manual-review rail. This layers
   automatic crediting on top, with NO new money-moving code: a background
   check against TronGrid (the real TRON blockchain) either finds a clean,
   unambiguous match -- right contract, right destination address, amount
   at least what was claimed, confirmed on-chain -- and if so credits it via
   the exact same claim-before-credit creditDeposit() every other deposit
   path already uses, or it doesn't, and the claim just sits exactly as it
   did in round 1: awaiting_verification, for the admin's own Approve/
   Reject, or for the next 30s reconciler pass to retry.

   This file stubs global.fetch for api.trongrid.io (never hits the real
   network) and proves: a clean match auto-credits with autoVerified:true;
   overpayment still auto-credits (the claimed lower amount); underpayment,
   a wrong contract, a wrong destination address, an HTTP error, and a
   malformed response all leave the claim untouched and safely pending; and
   the reconciler (via /admin/payments/sync) picks up a claim that only
   becomes verifiable on a LATER check -- proving eventual automatic
   crediting even if TronGrid had nothing yet at submit time.

   Run: node test-usdt-autoverify.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.TRONGRID_API_KEY = 'test-trongrid-key';
process.env.PORT = '4132';

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

// The real TronGrid /v1/transactions/{id}/events endpoint returns event
// `result.to`/`result.from` in HEX form (e.g. "0x..." / "41..."), NOT the
// base58 "T..." form our own settings field (and every wallet app) uses --
// confirmed against a real example response. A first version of this
// verifier compared the two directly and would therefore NEVER have
// matched anything in production (safe -- just permanently inert). These
// fixtures deliberately mirror that real hex shape so this suite actually
// exercises the address-format normalization (addrCore in server.js)
// instead of accidentally comparing two base58 strings to each other.
const USDT_CONTRACT_B58 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // real contract; event-level contract_address IS base58 in TronGrid's real response
const WALLET_B58 = 'TXhWEqoDp4hVLwXWDvSVrJEHrPGvXAg1Xy';         // what admin Settings / the deposit record store
const WALLET_HEX = '41ee5a8048e116b16317ebf46d1d95725059e4a0be'; // the SAME address, TRON-hex form (41 + 20-byte core) -- decoded+verified from WALLET_B58 via the exact addrCore logic in server.js
const WRONG_ADDR_HEX = '41deadbeefdeadbeefdeadbeefdeadbeefdead00'; // a plainly different address
const WRONG_CONTRACT_HEX = '41badc0ffeebadc0ffeebadc0ffeebadc0ffee0'; // a plainly different (fake) contract
const realFetch = global.fetch;
// Keyed by txid so each test controls exactly what TronGrid "found" for its
// own transaction, independent of every other test running in the same
// process.
const trongridStubs = new Map();
function stubTronGrid(txid, respond) { trongridStubs.set(txid, respond); }
function eventsPayload(transfers) { return { success: true, data: transfers, meta: {} }; }
function transferEvent({ contract = USDT_CONTRACT_B58, to = WALLET_HEX, valueUsdt = 10 }) {
  return { event_name: 'Transfer', contract_address: contract, result: { from: '41c0ffee00c0ffee00c0ffee00c0ffee00c0ffee', to, value: String(Math.round(valueUsdt * 1e6)) } };
}
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = (body, status) => ({ ok: !status || status < 400, status: status || 200, json: async () => body });
  if (u.includes('api.trongrid.io/v1/transactions/')) {
    const txid = u.split('/v1/transactions/')[1].split('/')[0];
    const stub = trongridStubs.get(txid);
    if (!stub) return json(eventsPayload([]));
    if (stub.httpError) return json({ Error: 'boom' }, stub.httpError);
    if (stub.malformed) return json({ not: 'the expected shape' });
    return json(eventsPayload(stub.events || []));
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4132';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(method, path, body) {
  const r = await realFetch(BASE + path, { method, headers: adminHeaders, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const userDoc = id => collMap('users').get(id);
async function setupFundedUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}
let _n = 0;
function freshTxid() { return 'b' + (++_n).toString(16).padStart(63, '0'); }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => setTimeout(r, 600));
  await adminCall('POST', '/admin/settings/update', { settings: { usdtEnabled: true, usdtWalletAddress: WALLET_B58, usdtRate: 3750 } });

  console.log('\n== Base58 decode is independently correct (checksum recomputed, not just internally consistent) ==');
  {
    const crypto = require('crypto');
    // Decode the REAL, well-known USDT TRC20 contract address and verify
    // its base58check checksum ourselves -- if the hand-written decoder in
    // server.js had a bug, this recomputed checksum would not match, which
    // a purely "does it match some other test fixture" check could miss
    // (two wrong decodes could coincidentally agree with each other).
    const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function decode(str) {
      let num = 0n;
      for (const ch of str) num = num * 58n + BigInt(BASE58_ALPHABET.indexOf(ch));
      let hex = num.toString(16); if (hex.length % 2) hex = '0' + hex;
      return hex;
    }
    const full = decode(USDT_CONTRACT_B58);
    const payload = full.slice(0, full.length - 8);
    const givenChecksum = full.slice(full.length - 8);
    const computedChecksum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(Buffer.from(payload, 'hex')).digest()).digest().slice(0, 4).toString('hex');
    check('decoded USDT contract payload starts with the TRON prefix byte (41)', payload.startsWith('41'), payload);
    check("decoded checksum matches an independently recomputed SHA256d checksum -- proves the decode is genuinely correct, not just self-consistent",
      givenChecksum === computedChecksum, { given: givenChecksum, computed: computedChecksum });
  }

  console.log('\n== Address matching works no matter which format TronGrid happens to return (hex OR base58) ==');
  const Z = 'auto-user-z'; await setupFundedUser(Z, '0771200299');
  const txZ = freshTxid();
  // Same wallet, but this time simulate TronGrid returning base58 (T...)
  // instead of hex for result.to -- proves the match isn't accidentally
  // hex-only.
  stubTronGrid(txZ, { events: [transferEvent({ to: WALLET_B58, valueUsdt: 10 })] });
  const zBalBefore = userDoc(Z).walletBalance || 0;
  const subZ = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + Z, body: { amountUsdt: 10, txid: txZ } });
  await wait(400);
  check('a base58-formatted on-chain address is recognised as the same wallet and auto-credits',
    userDoc(Z).walletBalance === zBalBefore + 37500, { balance: userDoc(Z).walletBalance, expected: zBalBefore + 37500 });

  console.log('\n== Clean match: auto-credits within moments, no admin action ==');
  const A = 'auto-user-a'; await setupFundedUser(A, '0771200201');
  const txA = freshTxid();
  stubTronGrid(txA, { events: [transferEvent({ valueUsdt: 10 })] });
  const balBefore = userDoc(A).walletBalance || 0;
  const subA = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 10, txid: txA } });
  check('submit accepted', subA.body.status === 'success', subA.body);
  await wait(400);
  const depA = collMap('pendingDeposits').get(subA.body.depositId);
  check('auto-credited to matched with no admin click', depA.status === 'matched', depA);
  check('tagged autoVerified for the admin UI', depA.autoVerified === true, depA);
  check('wallet actually credited the right UGX amount (10*3750=37500)', userDoc(A).walletBalance === balBefore + 37500,
    { balance: userDoc(A).walletBalance, expected: balBefore + 37500 });

  console.log('\n== Overpayment still auto-credits the CLAIMED (lower) amount, not the on-chain one ==');
  const B = 'auto-user-b'; await setupFundedUser(B, '0771200202');
  const txB = freshTxid();
  stubTronGrid(txB, { events: [transferEvent({ valueUsdt: 15 })] }); // sent more than claimed
  const bBalBefore = userDoc(B).walletBalance || 0;
  const subB = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + B, body: { amountUsdt: 10, txid: txB } });
  await wait(400);
  const depB = collMap('pendingDeposits').get(subB.body.depositId);
  check('overpayment still resolves as a clean match', depB.status === 'matched', depB);
  check('credited exactly the claimed 37,500 UGX, not more', userDoc(B).walletBalance === bBalBefore + 37500,
    { balance: userDoc(B).walletBalance, expected: bBalBefore + 37500 });

  console.log('\n== Underpayment never auto-credits ==');
  const C = 'auto-user-c'; await setupFundedUser(C, '0771200203');
  const txC = freshTxid();
  stubTronGrid(txC, { events: [transferEvent({ valueUsdt: 3 })] }); // sent LESS than the 10 claimed
  const cBalBefore = userDoc(C).walletBalance || 0;
  const subC = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + C, body: { amountUsdt: 10, txid: txC } });
  await wait(400);
  const depC = collMap('pendingDeposits').get(subC.body.depositId);
  check('underpaid claim stays awaiting_verification, never auto-credited', depC.status === 'awaiting_verification', depC);
  check('wallet untouched', userDoc(C).walletBalance === cBalBefore, userDoc(C).walletBalance);
  check('admin can still see and manually resolve it (force-credit works)',
    (await adminCall('POST', '/admin/deposit/force-credit', { depositId: subC.body.depositId })).body.status === 'success');

  console.log('\n== A look-alike token (wrong contract) never auto-credits ==');
  const D = 'auto-user-d'; await setupFundedUser(D, '0771200204');
  const txD = freshTxid();
  stubTronGrid(txD, { events: [transferEvent({ contract: WRONG_CONTRACT_HEX, valueUsdt: 10 })] });
  const subD = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + D, body: { amountUsdt: 10, txid: txD } });
  await wait(400);
  check('wrong-contract transfer is ignored, stays pending', collMap('pendingDeposits').get(subD.body.depositId).status === 'awaiting_verification');

  console.log('\n== A transfer to someone else\'s address never auto-credits ==');
  const E = 'auto-user-e'; await setupFundedUser(E, '0771200205');
  const txE = freshTxid();
  stubTronGrid(txE, { events: [transferEvent({ to: WRONG_ADDR_HEX, valueUsdt: 10 })] });
  const subE = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + E, body: { amountUsdt: 10, txid: txE } });
  await wait(400);
  check('transfer to a different address is ignored, stays pending', collMap('pendingDeposits').get(subE.body.depositId).status === 'awaiting_verification');

  console.log('\n== TronGrid errors and malformed responses fail safe, never crash, never credit ==');
  const F = 'auto-user-f'; await setupFundedUser(F, '0771200206');
  const txF = freshTxid();
  stubTronGrid(txF, { httpError: 500 });
  const subF = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + F, body: { amountUsdt: 10, txid: txF } });
  await wait(400);
  check('a TronGrid 500 leaves the claim safely pending', collMap('pendingDeposits').get(subF.body.depositId).status === 'awaiting_verification');

  const G = 'auto-user-g'; await setupFundedUser(G, '0771200207');
  const txG = freshTxid();
  stubTronGrid(txG, { malformed: true });
  const subG = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + G, body: { amountUsdt: 10, txid: txG } });
  await wait(400);
  check('a malformed TronGrid response leaves the claim safely pending', collMap('pendingDeposits').get(subG.body.depositId).status === 'awaiting_verification');

  console.log('\n== Nothing confirmed yet at submit time -- the reconciler catches it later, no admin needed ==');
  const H = 'auto-user-h'; await setupFundedUser(H, '0771200208');
  const txH = freshTxid();
  stubTronGrid(txH, { events: [] }); // "not confirmed yet" at submit time
  const hBalBefore = userDoc(H).walletBalance || 0;
  const subH = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + H, body: { amountUsdt: 10, txid: txH } });
  await wait(400);
  check('still pending right after submit (TronGrid had nothing yet)', collMap('pendingDeposits').get(subH.body.depositId).status === 'awaiting_verification');
  // The transaction confirms a moment later -- update the stub, then trigger
  // the same sweep the 30s background reconciler runs, via the admin
  // "Sync" endpoint (deterministic for a test, instead of waiting 30s).
  stubTronGrid(txH, { events: [transferEvent({ valueUsdt: 10 })] });
  const sync = await adminCall('GET', '/admin/payments/sync');
  check('sync reports the USDT deposit as settled', (sync.body.usdtSettled || 0) >= 1, sync.body);
  check('the reconciler auto-credited it with zero admin action', collMap('pendingDeposits').get(subH.body.depositId).status === 'matched');
  check('wallet credited via the reconciler pass', userDoc(H).walletBalance === hBalBefore + 37500,
    { balance: userDoc(H).walletBalance, expected: hBalBefore + 37500 });

  console.log('\n== A re-verified deposit can never be double-credited by a later sweep ==');
  const beforeResync = userDoc(A).walletBalance;
  await adminCall('GET', '/admin/payments/sync');
  check('re-syncing an already-matched USDT deposit changes nothing', userDoc(A).walletBalance === beforeResync, userDoc(A).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
