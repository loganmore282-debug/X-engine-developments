/* SPACE8 BANK WITHDRAWAL ACCOUNTS
   Owner: "we are adding banks, no need to make different area, let it
   remain the same, same terms, only l want when one selects network
   mtn,airtel,plus all supported banks, so one can tap network and inputs
   account number... no making another category it has remained the same!"

   Bank-transfer withdrawal infrastructure (marzValidateBankAccount,
   marzBankTransfer, getMarzBanks, processWithdrawalCore's isBank branch)
   already existed in server.js from an earlier, later-removed feature --
   this round reactivates it, but merged into the SAME bind-then-pick
   Withdrawal Accounts flow mobile money already used, not the old
   separate "type bank details fresh every withdrawal" design.

   Boots the REAL server.js against an in-memory mock database with
   MarzPay's bank-transfer/validate, bank-transfer/banks, and bank-transfer
   endpoints stubbed over global.fetch, then proves end to end:
     - /bank/save accepts a bank name as `network`, validates the
       (bank, account number) pair live against MarzPay before ever
       saving, and stores isBank:true
     - a bank name MarzPay itself rejects (invalid account) is never saved
     - a malformed account number is rejected WITHOUT ever calling MarzPay
       (cheap format check first)
     - duplicate detection for a bank account is scoped by (network, phone)
       together, not phone alone -- unlike mobile money's deliberate
       phone-only scoping, so the same raw digit string at two DIFFERENT
       banks is correctly treated as two distinct accounts, not a duplicate
     - GET /bank/list returns the bank account with isBank:true
     - GET /public/banks exposes the live MarzPay bank list
     - /withdraw/request against a bound bank account creates a withdrawal
       with method:'bank' and bankName/accountNumber/accountName populated
       from the BOUND account (not fresh request-body fields)
     - /withdraw/request against an UNBOUND bank destination is rejected
       (UNBOUND_ACCOUNT), same protection mobile money already had
     - a forged bankAccounts row (network not in NETWORK_NAMES, no
       isBank:true flag) can never be treated as a valid bank destination,
       even though a "bound" row technically matches -- defense in depth
     - /admin/withdraw/process correctly drives the isBank branch
       (marzBankTransfer, not marzSendMoney), sets marzBankReference,
       credits totalWithdrawn, and finalizes the Records row
     - mobile-money bind + withdraw is completely unaffected (regression
       check; test-payout-phone-validation.js covers phone validation in
       full depth separately)

   Run: node test-bank-withdrawal-accounts.js   (exits 0 = all green)     */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4231';

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
let validateCalls = 0;
let bankTransferCalls = 0;
// account numbers that MarzPay's live validate should report as real.
const VALID_ACCOUNTS = new Set(['60001256421', '70009988776']);
let nextBankTransferOutcome = { status: 'success', reference: 'BT-1' };
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/bank-transfer/validate')) {
    validateCalls++;
    const body = JSON.parse(opts.body);
    if (VALID_ACCOUNTS.has(body.account_number)) return json({ status: 'success', data: { valid: true } });
    return json({ status: 'error', message: 'Account not found' });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/bank-transfer/banks')) {
    return json({ status: 'success', data: { banks: ['Equity Bank', 'Stanbic Bank', 'Centenary Bank'] } });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/bank-transfer') && opts?.method === 'POST') {
    bankTransferCalls++;
    const outcome = nextBankTransferOutcome;
    if (outcome.status === 'error') return json({ status: 'error', message: 'Bank transfer rejected' });
    return json({
      status: outcome.status,
      message: 'Bank transfer is being processed.',
      data: { bank_transfer: { reference: outcome.reference, transaction_uuid: outcome.reference, status: 'processing' } }
    });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-mm', status: 'pending' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4231';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(method, p, body) { return call(method, p, { adminKey: 'test-admin-key', body }); }
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
const bankAccountsOf = uid => [...collMap('bankAccounts').values()].filter(b => b.userId === uid);
const withdrawalsOf = uid => [...collMap('withdrawals').values()].filter(w => w.userId === uid);

let n = 0;
async function freshFundedUser() {
  const uid = 'bank-wit-' + (++n);
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '0771000000' } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = 1000000;
  userDoc(uid).totalInvested = 1000000; // clears requireInvestToWithdraw
  return uid;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== /bank/save accepts a bank as network, validates live before saving ==');
  const A = await freshFundedUser();
  let r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Alice Bank', network: 'Equity Bank', phone: '60001256421', pin: '1234' } });
  check('bank account save succeeds', r.body?.status === 'success', r.body);
  let acctsA = bankAccountsOf(A);
  check('exactly one account saved', acctsA.length === 1, acctsA);
  check('stored network is the bank name', acctsA[0]?.network === 'Equity Bank', acctsA[0]);
  check('stored phone is the digits-only account number', acctsA[0]?.phone === '60001256421', acctsA[0]);
  check('isBank flag stored true', acctsA[0]?.isBank === true, acctsA[0]);
  check('validate was actually called live', validateCalls >= 1, validateCalls);

  console.log('\n== /bank/save rejects a bank account MarzPay itself says is invalid ==');
  const B = await freshFundedUser();
  const validateCallsBefore = validateCalls;
  r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'Bob Bank', network: 'Stanbic Bank', phone: '99999999999', pin: '1234' } });
  check('save rejected (MarzPay says account not found)', r.code === 400, r.body);
  check('nothing saved', bankAccountsOf(B).length === 0, bankAccountsOf(B));
  check('validate WAS called (this is a real live check, not a static guess)', validateCalls > validateCallsBefore, validateCalls);

  console.log('\n== /bank/save rejects a malformed account number without ever calling MarzPay ==');
  const C = await freshFundedUser();
  const validateCallsBefore2 = validateCalls;
  r = await call('POST', '/bank/save', { token: 'uid:' + C, body: { holder: 'Carol Bank', network: 'Equity Bank', phone: '123', pin: '1234' } });
  check('save rejected (account number too short)', r.code === 400, r.body);
  check('MarzPay was never called for an obviously-malformed number', validateCalls === validateCallsBefore2, validateCalls);

  console.log('\n== Duplicate detection for bank accounts is scoped by (network, phone), not phone alone ==');
  const D = await freshFundedUser();
  r = await call('POST', '/bank/save', { token: 'uid:' + D, body: { holder: 'Dora Bank', network: 'Equity Bank', phone: '70009988776', pin: '1234' } });
  check('first bind succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/bank/save', { token: 'uid:' + D, body: { holder: 'Dora Bank', network: 'Equity Bank', phone: '70009988776', pin: '1234' } });
  check('exact same (bank, account number) rejected as duplicate', r.code === 400, r.body);
  r = await call('POST', '/bank/save', { token: 'uid:' + D, body: { holder: 'Dora Bank', network: 'Stanbic Bank', phone: '70009988776', pin: '1234' } });
  check('SAME account number at a DIFFERENT bank is NOT treated as a duplicate', r.body?.status === 'success', r.body);
  check('both rows now exist for Dora', bankAccountsOf(D).length === 2, bankAccountsOf(D));

  console.log('\n== GET /bank/list and GET /public/banks ==');
  r = await call('GET', '/bank/list', { token: 'uid:' + A });
  check('bank/list returns the bank account', (r.body?.accounts || []).some(a => a.network === 'Equity Bank' && a.isBank === true), r.body);
  r = await call('GET', '/public/banks');
  check('public/banks exposes the live MarzPay bank list', r.body?.status === 'success' && Array.isArray(r.body.banks) && r.body.banks.includes('Equity Bank'), r.body);

  console.log('\n== /withdraw/request against a bound bank account ==');
  const E = await freshFundedUser();
  await call('POST', '/bank/save', { token: 'uid:' + E, body: { holder: 'Erin Bank', network: 'Equity Bank', phone: '60001256421', pin: '1234' } });
  const balBeforeE = userDoc(E).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + E, body: { amount: 50000, holder: 'Erin Bank', network: 'Equity Bank', phone: '60001256421', pin: '1234' } });
  check('bank withdrawal request succeeds', r.body?.status === 'success', r.body);
  check('balance was reserved', userDoc(E).walletBalance === balBeforeE - 50000, userDoc(E).walletBalance);
  const witE = withdrawalsOf(E)[0];
  check('withdrawal method is "bank"', witE?.method === 'bank', witE);
  check('bankName populated from the bound account', witE?.bankName === 'Equity Bank', witE);
  check('accountNumber populated from the bound account', witE?.accountNumber === '60001256421', witE);
  check('accountName populated from the bound account holder', witE?.accountName === 'Erin Bank', witE);

  console.log('\n== Codex-verified real gap: request-body holder is IGNORED, bound holder always wins ==');
  // A direct API call submitting a DIFFERENT holder than the one actually
  // bound must not be trusted -- the withdrawal record (and what would be
  // sent to MarzPay as bank_account_name) must always reflect the BOUND
  // account's real holder, never whatever the request claims.
  r = await call('POST', '/withdraw/request', { token: 'uid:' + E, body: { amount: 20000, holder: 'Mallory', network: 'Equity Bank', phone: '60001256421', pin: '1234' } });
  check('withdrawal against the same bound account still succeeds', r.body?.status === 'success', r.body);
  const witE2 = withdrawalsOf(E).find(w => w.amount === 20000);
  check('holder on the new withdrawal is the BOUND account holder, not the mismatched request body', witE2?.holder === 'Erin Bank', witE2);
  check('accountName sent for the bank transfer is also the bound holder, not "Mallory"', witE2?.accountName === 'Erin Bank', witE2);

  console.log('\n== /withdraw/request against an UNBOUND bank destination is rejected ==');
  const F = await freshFundedUser();
  const balBeforeF = userDoc(F).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + F, body: { amount: 50000, holder: 'Frank Bank', network: 'Equity Bank', phone: '60001256421', pin: '1234' } });
  check('unbound bank destination rejected', r.code === 400 && r.body?.code === 'UNBOUND_ACCOUNT', r.body);
  check('no balance reserved', userDoc(F).walletBalance === balBeforeF, userDoc(F).walletBalance);
  check('no withdrawal created', withdrawalsOf(F).length === 0, withdrawalsOf(F));

  console.log('\n== Defense in depth: a forged bankAccounts row (no isBank:true) is never trusted as a bank destination ==');
  const G = await freshFundedUser();
  collMap('bankAccounts').set('forged-1', { userId: G, holder: 'Forged', network: 'Not A Real Bank', phone: '11111111', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + G, body: { amount: 50000, holder: 'Forged', network: 'Not A Real Bank', phone: '11111111', pin: '1234' } });
  check('forged row rejected even though network+phone technically match a bound row', r.code === 400, r.body);
  check('no withdrawal created', withdrawalsOf(G).length === 0, withdrawalsOf(G));

  console.log('\n== /admin/withdraw/process drives the bank-transfer rail (not send-money) ==');
  nextBankTransferOutcome = { status: 'success', reference: 'BT-E1' };
  const bankTransferCallsBefore = bankTransferCalls;
  // witE came from a filtered array copy, not the map directly -- resolve
  // its real doc id by matching on `ref` (globally unique), not just
  // "the last withdrawal belonging to E" -- E now has more than one
  // withdrawal on their account (see the holder-mismatch test above), so
  // a bare userId match would silently grab the WRONG one.
  let witEId = null;
  for (const [id, w] of collMap('withdrawals').entries()) { if (w.userId === E && w.ref === witE.ref) witEId = id; }
  r = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witEId });
  check('process succeeds', r.body?.status === 'success', r.body);
  check('marzBankTransfer (not send-money) was actually called', bankTransferCalls > bankTransferCallsBefore, bankTransferCalls);
  const processedWitE = collMap('withdrawals').get(witEId);
  check('status advanced past pending', processedWitE?.status === 'processing' || processedWitE?.status === 'processed', processedWitE);
  check('marzBankReference recorded', processedWitE?.marzBankReference === 'BT-E1', processedWitE);
  // totalWithdrawn credits the NET amount actually sent (after the
  // platform's own withdrawFeePct, default 15%), not the gross request --
  // same accounting mobile-money withdrawals already use.
  check('totalWithdrawn credited (net of the platform fee)', (userDoc(E).totalWithdrawn || 0) === witE.net, userDoc(E).totalWithdrawn);
  const txE = [...collMap('transactions').values()].find(t => t.withdrawalId === witEId);
  check('matching transaction row exists and is no longer pending', txE && txE.status !== 'pending', txE);

  console.log('\n== Mobile-money bind + withdraw is completely unaffected (regression check) ==');
  const H = await freshFundedUser();
  r = await call('POST', '/bank/save', { token: 'uid:' + H, body: { holder: 'Henry MM', network: 'MTN Mobile Money', phone: '0771234567', pin: '1234' } });
  check('mobile-money bind still succeeds', r.body?.status === 'success', r.body);
  check('isBank NOT set for a mobile-money bind', bankAccountsOf(H)[0]?.isBank !== true, bankAccountsOf(H));
  const balBeforeH = userDoc(H).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + H, body: { amount: 30000, holder: 'Henry MM', network: 'MTN Mobile Money', phone: '0771234567', pin: '1234' } });
  check('mobile-money withdraw request still succeeds', r.body?.status === 'success', r.body);
  const witH = withdrawalsOf(H)[0];
  check('withdrawal method is "mobile_money"', witH?.method === 'mobile_money', witH);
  check('bankName/accountNumber NOT set for a mobile-money withdrawal', !witH?.bankName && !witH?.accountNumber, witH);
  check('balance correctly reserved', userDoc(H).walletBalance === balBeforeH - 30000, userDoc(H).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
