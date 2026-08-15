/* SPACE8 ALL-TIERS PRICING ACCURACY TEST
   Prompted by a real incident: the code's pricing table was bumped from
   20x to 25x, but 9 of the 10 tiers had a saved `products` doc from an
   earlier admin edit that permanently overrides DEFAULT_PRODUCTS for that
   key -- so only the one never-touched tier (Hershey's) actually reflected
   the new rate; the other 9 stayed silently stuck on the old numbers.
   Existing tests (test-investments.js) only ever exercised hersheys and
   mars, so this class of "every tier except the checked ones is quietly
   wrong" bug had no test that would have caught it across the full table.

   This buys a purchase in EVERY one of the 15 default tiers and proves,
   for each: expectedReturn is exactly price*42, dailyPayout is exactly
   round(expectedReturn/210) (matching the owner's reference table to the
   digit, including the ones that don't divide evenly), and daily cashback
   settlement actually pays that exact daily figure for a backdated
   investment -- not just that the numbers are stored right, but that the
   money that moves matches them.

   Run: node test-all-tiers-pricing.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4110';

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

const BASE = 'http://127.0.0.1:4110';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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

// The owner's own reference table (Space8_Investment_Plans_and_Variables.pdf)
// -- every tier, at the real 42x/210-day rate. If DEFAULT_PRODUCTS in
// server.js ever drifts from this (or a saved doc silently overrides one
// tier again), this test fails on that exact tier instead of the mismatch
// going unnoticed.
const REFERENCE_TABLE = [
  { key: 'sputnik1',   price: 15000,    expectedReturn: 630000     },
  { key: 'explorer1',  price: 30000,    expectedReturn: 1260000    },
  { key: 'vanguard1',  price: 50000,    expectedReturn: 2100000    },
  { key: 'tiros1',     price: 100000,   expectedReturn: 4200000    },
  { key: 'telstar1',   price: 180000,   expectedReturn: 7560000    },
  { key: 'landsat1',   price: 250000,   expectedReturn: 10500000   },
  { key: 'meteosat1',  price: 350000,   expectedReturn: 14700000   },
  { key: 'hubble',     price: 500000,   expectedReturn: 21000000   },
  { key: 'terra',      price: 850000,   expectedReturn: 35700000   },
  { key: 'aqua',       price: 1000000,  expectedReturn: 42000000   },
  { key: 'sentinel1a', price: 1500000,  expectedReturn: 63000000   },
  { key: 'goes16',     price: 3000000,  expectedReturn: 126000000  },
  { key: 'sentinel6',  price: 5000000,  expectedReturn: 210000000  },
  { key: 'landsat9',   price: 10000000, expectedReturn: 420000000  },
  { key: 'jwst',       price: 20000000, expectedReturn: 840000000  },
];

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log(`\n== Every one of the ${REFERENCE_TABLE.length} default tiers matches the owner's reference table exactly ==`);
  const A = 'pricing-check-uid';
  await setupFundedUser(A, '0771000090', 500000000);

  const boughtIds = {};
  for (const tier of REFERENCE_TABLE) {
    const expectedDaily = Math.round(tier.expectedReturn / 210);
    const r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: tier.key } });
    check(`${tier.key}: purchase succeeds`, r.body?.status === 'success', r.body);
    const inv = investments().get(r.body?.investmentId);
    boughtIds[tier.key] = r.body?.investmentId;
    check(`${tier.key}: price is ${tier.price.toLocaleString()}`, inv?.amount === tier.price, inv);
    check(`${tier.key}: expectedReturn is exactly price x42 (${tier.expectedReturn.toLocaleString()})`, inv?.expectedReturn === tier.expectedReturn, inv);
    check(`${tier.key}: cycle is 210 days`, inv?.cycle === 210, inv);
    check(`${tier.key}: dailyPayout is round(expectedReturn/210) = ${expectedDaily.toLocaleString()}`, inv?.dailyPayout === expectedDaily, inv);
  }

  console.log('\n== Daily cashback settlement pays the exact per-tier daily figure, for every tier ==');
  const B = 'cashback-check-uid';
  await setupFundedUser(B, '0771000091', 500000000);
  for (const tier of REFERENCE_TABLE) {
    const r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: tier.key } });
    const invId = r.body?.investmentId;
    const inv = investments().get(invId);
    // Backdate 3 days so 3 elapsed cycles are due -- same pattern the
    // existing settle-on-read tests use, just run across every tier here
    // instead of only hersheys.
    inv.createdAt = new Date(Date.now() - 3 * 86400000);
    const balBefore = userDoc(B).walletBalance;
    await call('GET', '/investments', { token: 'uid:' + B });
    const expected3Days = inv.dailyPayout * 3;
    check(`${tier.key}: 3 elapsed days pays exactly 3x its own daily figure (${expected3Days.toLocaleString()})`,
      userDoc(B).walletBalance === balBefore + expected3Days,
      { balance: userDoc(B).walletBalance, expected: balBefore + expected3Days, dailyPayout: inv.dailyPayout });
  }

  console.log('\n== Maturity pays the exact total (expectedReturn), never a rounding-drift over/under-pay, for every tier ==');
  const C = 'maturity-check-uid';
  await setupFundedUser(C, '0771000092', 500000000);
  for (const tier of REFERENCE_TABLE) {
    const r = await call('POST', '/invest/create', { token: 'uid:' + C, body: { tierKey: tier.key } });
    const invId = r.body?.investmentId;
    const inv = investments().get(invId);
    inv.createdAt = new Date(Date.now() - 400 * 86400000); // far past the 210-day cycle
    await call('GET', '/investments', { token: 'uid:' + C });
    const fresh = investments().get(invId);
    check(`${tier.key}: matures and pays out exactly expectedReturn (${tier.expectedReturn.toLocaleString()}), no rounding drift`,
      fresh.status === 'matured' && fresh.paidOut === tier.expectedReturn, fresh);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
