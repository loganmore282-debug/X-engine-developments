#!/usr/bin/env node
/**
 * The Home activity ticker shows the REGION's own money, in its own currency.
 *
 * Owner: "make sure on currency change, the activity checker should be
 * changing currency too basing on the products and values of the system."
 *
 * Two separate faults were behind that, and the first one hid the second:
 *
 *   1. ONE module-level cache for every country. buildActivityFeed() was
 *      already region-correct inside -- getSettings(), getProducts() and
 *      maskedMsisdn() all read the request's region out of AsyncLocalStorage
 *      -- but whichever country's request built the array first won, and
 *      every other country was served that one for the life of the process.
 *   2. TWO HARDCODED LADDERS. Deposits came from a fixed list running 30,000
 *      to 4,500,000 and withdrawals stepped 5,000 to 900,000: Ugandan
 *      amounts, handed to every market. On one where a product costs 500 the
 *      ticker scrolled figures sixty times too large.
 *
 * It reads WORSE than an obviously wrong number, because the client labels
 * the amount with its OWN currency (fmtUGX -> cur()): a Kenyan member saw
 * Ugandan prices with "KES" in front of them.
 *
 * This runs the REAL activityPools(), maskedMsisdn(), buildActivityFeed() and
 * the real route handler against two countries whose money does not overlap,
 * so "it used the right country's figures" is answered from the output rather
 * than from reading the code.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const grab = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j <= i) throw new Error(`grab(): marker missing -- ${i < 0 ? a : b}`);
  return src.slice(i, j);
};

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// Two countries with deliberately NON-OVERLAPPING money. That is the whole
// design of the fixture: any figure in one country's feed can be traced to
// exactly one country, so a leak cannot be mistaken for a coincidence.
const WORLD = {
  ug: {
    region: { key: 'ug', dialCode: '256' },
    settings: { minDeposit: 30000, minWithdraw: 20000, withdrawMultiple: 5000 },
    products: [{ price: 30000, active: true }, { price: 90000, active: true },
               { price: 270000, active: true }],
  },
  ke: {
    region: { key: 'ke', dialCode: '254' },
    settings: { minDeposit: 500, minWithdraw: 300, withdrawMultiple: 100 },
    products: [{ price: 500, active: true }, { price: 1500, active: true },
               { price: 4000, active: true }],
  },
};
let WHERE = 'ug';

const sandbox = {
  currentRegion: () => WORLD[WHERE].region,
  currentRegionKey: () => WORLD[WHERE].region.key,
  DEFAULT_REGION_KEY: 'ug',
  getSettings: async () => WORLD[WHERE].settings,
  getProducts: async () => WORLD[WHERE].products,
  finiteMoney: v => { const n = Number(v); return Number.isFinite(n) ? n : 0; },
  console,
};
const api = new Function('sandbox', `
  const { currentRegion, currentRegionKey, DEFAULT_REGION_KEY, getSettings,
          getProducts, finiteMoney, console } = sandbox;
  ${grab('function maskedMsisdn', 'function activityPools')}
  ${grab('function activityPools', 'const _activityCache')}
  ${grab('const _activityCache', "app.get('/public/activity-feed'")}
  let handler;
  const app = { get: (p, h) => { if (p === '/public/activity-feed') handler = h; } };
  ${grab("app.get('/public/activity-feed'", '// ═══════════════════════════════════════════\n// REGISTRATION')}
  return { handler, cache: _activityCache, activityPools, buildActivityFeed };
`)(sandbox);

const call = async () => {
  let out = null;
  await api.handler({}, { json: o => { out = o; } });
  return out;
};

(async () => {
  console.log('— the pools are built from that country, and nothing else —');
  for (const key of ['ug', 'ke']) {
    WHERE = key;
    const w = WORLD[key];
    const { deposits, withdrawals } = api.activityPools(w.settings, w.products);
    const prices = w.products.map(p => p.price);
    ck(prices.every(p => deposits.includes(p)),
      `${key}: every product price is a deposit the ticker can show (${deposits.join(', ')})`);
    ck(deposits.every(d => d >= w.settings.minDeposit),
      `${key}: and none is below its own minimum recharge`);
    ck(withdrawals.length > 0 && withdrawals.every(a => a % w.settings.withdrawMultiple === 0),
      `${key}: every cash-out is a LEGAL amount there (multiple of ${w.settings.withdrawMultiple})`);
    ck(withdrawals.every(a => a >= w.settings.minWithdraw),
      `${key}: and none is below its own minimum cash-out`);
    ck(deposits.length <= 40 && withdrawals.length <= 40,
      `${key}: the pools are bounded (${deposits.length} / ${withdrawals.length})`);
  }

  // The specific defect: Uganda's figures must not be reachable in Kenya.
  const ugOnly = [30000, 90000, 270000, 4500000, 900000];
  const keOnly = [500, 1500, 4000];
  WHERE = 'ke';
  const kePools = api.activityPools(WORLD.ke.settings, WORLD.ke.products);
  const keAll = kePools.deposits.concat(kePools.withdrawals);
  ck(!ugOnly.some(a => keAll.includes(a)),
    `no Ugandan figure can appear in a Kenyan feed (${keAll.slice(0, 8).join(', ')}…)`);
  WHERE = 'ug';
  const ugPools = api.activityPools(WORLD.ug.settings, WORLD.ug.products);
  const ugAll = ugPools.deposits.concat(ugPools.withdrawals);
  ck(!keOnly.some(a => ugAll.includes(a)), 'and no Kenyan figure in a Ugandan one');

  console.log('\n— the cache carries the region, so the first caller cannot win —');
  WHERE = 'ug';
  const ug = await call();
  ck(ug.feed.length === 60, `Uganda's feed built (${ug.feed.length} rows)`);
  ck(ug.feed.every(r => r.phone.startsWith('256')), "every number carries Uganda's code");
  ck(ug.feed.every(r => ugAll.includes(r.amount)), 'and every amount comes from Uganda');

  WHERE = 'ke';
  const ke = await call();      // THE BUG: this used to be Uganda's array.
  ck(ke.feed.every(r => r.phone.startsWith('254')), "every number carries Kenya's code");
  ck(ke.feed.every(r => keAll.includes(r.amount)),
    'and every amount comes from Kenya, not from the cached Ugandan feed');
  ck(!ke.feed.some(r => ugOnly.includes(r.amount)), 'no Ugandan amount leaked across');

  WHERE = 'ug';
  const ug2 = await call();     // and Kenya must not have overwritten Uganda
  ck(ug2.feed.every(r => r.phone.startsWith('256') && ugAll.includes(r.amount)),
    'Uganda is still Ugandan after Kenya has been served');
  ck(api.cache.size === 2, `the cache is keyed per country (${api.cache.size} entries)`);

  console.log('\n— nothing in here is a hardcoded amount any more —');
  const feedSrc = grab('function activityPools', 'const _activityCache')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const bigNumbers = (feedSrc.match(/\b\d{4,}\b/g) || []);
  ck(bigNumbers.length === 0,
    `activityPools contains no money-sized literal (${bigNumbers.join(', ') || 'none'})`);
  ck(!/_DEPOSIT_LADDER|_WIRE_STEP|_WIRE_CAP/.test(
       src.replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'and the two Ugandan ladders are gone from server.js entirely');

  console.log('\n— a country with nothing configured still scrolls something —');
  WORLD.xx = { region: { key: 'xx', dialCode: '255' }, settings: {}, products: [] };
  WHERE = 'xx';
  const bare = api.activityPools({}, []);
  ck(bare.deposits.length > 0 && bare.withdrawals.length > 0,
    'empty settings and no products still give a non-empty pool');
  ck(bare.deposits.concat(bare.withdrawals).every(n => Number.isFinite(n) && n > 0),
    'and every figure in it is a real number -- an empty pool scrolls "NaN"');
  const bareFeed = await call();
  ck(bareFeed.feed.every(r => Number.isFinite(r.amount) && r.amount > 0),
    'the rendered feed carries no NaN');

  console.log(bad ? `\n${bad} FAILED` : '\nactivity feed: per-country, from its own figures');
  process.exit(bad ? 1 : 0);
})();
