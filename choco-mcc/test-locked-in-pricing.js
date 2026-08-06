/* CHOCOMCC "ALREADY-BOUGHT INVESTMENT SURVIVES A LATER PRICE CHANGE" TEST
   Direct owner question after the 20x -> 25x rate bump: "I bought these
   before the price changed -- will I still get exactly what was stamped
   when I bought?" This proves the answer is yes, with real money moving,
   not just a code-reading argument:

     1. Buy a tier at the OLD rate (simulating "bought before the change").
     2. Change that tier's live price/expectedReturn to a NEW rate via the
        real admin endpoint (simulating the owner editing pricing later) --
        and separately, change the GLOBAL returnMultiple/cycleDays fallback
        too, since a buyer might worry either one could retroactively touch
        their deal.
     3. Prove the ALREADY-BOUGHT investment's own stored price/cycle/
        expectedReturn/dailyPayout are completely unchanged by either edit,
        and that daily cashback settlement still pays the OLD daily figure,
        and maturity still pays out the OLD total -- never the new one.
     4. Prove a FRESH purchase of the same tier, made AFTER the price
        change, correctly gets the NEW rate -- so this isn't "nothing ever
        updates", it's specifically "an existing deal is locked in, new
        purchases see the new price", the intended behavior either way.

   This is only possible because settleInvestmentIfDue() (server.js) reads
   exclusively from the investment document's own persisted fields and
   never re-looks-up live product/settings data -- confirmed here by
   changing the live config and proving zero effect on the existing deal.

   Run: node test-locked-in-pricing.js   (exits 0 = all green)             */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4111';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4111';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function adminCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
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
const users = () => collMap('users');
const userDoc = id => users().get(id);
const investments = () => collMap('investments');

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Step 1: buy Hershey\'s at today\'s rate (30,000 -> 1,200,000, the "before the change" purchase) ==');
  const A = 'early-buyer-uid';
  await setupFundedUser(A, '0771000095', 10000000);
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'hersheys' } });
  check('purchase succeeds', r.body?.status === 'success', r.body);
  const oldInvId = r.body?.investmentId;
  const oldInv = investments().get(oldInvId);
  check('locked in at 1,200,000 total, 30,000 price', oldInv?.expectedReturn === 1200000 && oldInv?.amount === 30000, oldInv);
  const oldDaily = oldInv.dailyPayout;
  check('locked-in daily figure is 6,667', oldDaily === 6667, oldInv);

  console.log('\n-- Step 2: the owner changes Hershey\'s pricing AND the global rate, after the purchase --');
  const saveR = await adminCall('/admin/products/save', {
    products: [{ key: 'hersheys', name: "Hershey's Milk Chocolate", price: 50000, cycle: 90, expectedReturn: 999999, order: 0 }],
  });
  check('admin price/cycle/total-payout edit succeeds', saveR.body?.status === 'success', saveR.body);
  const settingsR = await adminCall('/admin/settings/update', { settings: { returnMultiple: 999, cycleDays: 1 } });
  check('global returnMultiple/cycleDays edit succeeds (deliberately absurd values, to make any leak obvious)', settingsR.body?.status === 'success', settingsR.body);

  console.log('\n-- Step 3: the ALREADY-BOUGHT investment is completely untouched by either edit --');
  const untouchedInv = investments().get(oldInvId);
  check('price is still 30,000 (not the new 50,000)', untouchedInv.amount === 30000, untouchedInv);
  check('expectedReturn is still 1,200,000 (not the new 999,999)', untouchedInv.expectedReturn === 1200000, untouchedInv);
  check('cycle is still 180 (not the new 90)', untouchedInv.cycle === 180, untouchedInv);
  check('dailyPayout is still 6,667 (not re-derived from the new global returnMultiple/cycleDays)', untouchedInv.dailyPayout === 6667, untouchedInv);

  console.log('\n-- Cashback settlement on the old investment still pays the OLD daily figure --');
  untouchedInv.createdAt = new Date(Date.now() - 3 * 86400000);
  const balBefore = userDoc(A).walletBalance;
  await call('GET', '/investments', { token: 'uid:' + A });
  const expected = oldDaily * 3;
  check('3 elapsed days pays exactly 3 x 6,667 = 20,001, not any new-rate figure',
    userDoc(A).walletBalance === balBefore + expected,
    { balance: userDoc(A).walletBalance, expected: balBefore + expected });

  console.log('\n-- Maturity on the old investment still pays out exactly the original 1,200,000 total --');
  const freshOld = investments().get(oldInvId);
  freshOld.createdAt = new Date(Date.now() - 400 * 86400000);
  await call('GET', '/investments', { token: 'uid:' + A });
  const maturedOld = investments().get(oldInvId);
  check('matures at exactly 1,200,000 paid out, never the new total-payout figure', maturedOld.status === 'matured' && maturedOld.paidOut === 1200000, maturedOld);

  console.log('\n== Step 4: a FRESH purchase of the same tier, made AFTER the change, correctly gets the NEW numbers ==');
  const B = 'late-buyer-uid';
  await setupFundedUser(B, '0771000096', 10000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'hersheys' } });
  check('purchase succeeds', r.body?.status === 'success', r.body);
  const newInv = investments().get(r.body?.investmentId);
  check('new purchase reflects the NEW price (50,000), not the old buyer\'s locked-in 30,000', newInv?.amount === 50000, newInv);
  check('new purchase reflects the NEW total payout (999,999), not the old 1,200,000', newInv?.expectedReturn === 999999, newInv);
  check('new purchase reflects the NEW cycle (90 days), not the old 180', newInv?.cycle === 90, newInv);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
