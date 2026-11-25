'use strict';
// Locking products (stored as category 'wage', formerly "Daily wage" task products): priced and bought by members like any other product, but
// nothing is paid along the way -- the profit and the purchase price are released together when the cycle ends. The other category
// (Hourly income) pays its profit every hour and returns the purchase price with the last one.
const fs = require('node:fs'), assert = require('node:assert/strict'), vm = require('node:vm');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// the real sanitizer, run on its own
const a = src.indexOf('function sanitizeProductInput('), b = src.indexOf('\n}\n', a) + 3;
const ctx = { MAX_MONEY_AMOUNT: 1e9, MAX_SPINS_PER_PURCHASE: 50, hhmmToMin: v => (/^\d\d:\d\d$/.test(v) ? 1 : null) };
vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
const clean = (p, why) => vm.runInContext('sanitizeProductInput', ctx)(p, 0, why);
const lock = { key: 'locker', name: 'Locker', category: 'wage', price: 5000, cycle: 2, multiplier: 1.08, buyLimit: 0, vip: 2 };
const w = clean(lock); ok(w && w.category === 'wage' && w.price === 5000 && w.vip === 2 && w.multiplier === 1.08, 'a Locking product has a price, a multiplier and may give a VIP level');
ok(clean({ ...lock, price: 0 }) === null, 'a Locking product cannot cost 0 any more');
const why = {}; ok(clean({ ...lock, multiplier: 1 }, why) === null && why.field === 'Multiplier (×)', 'the total must be more than the price (it includes the money back)');
ok(clean({ ...lock, multiplier: '', expectedReturn: 5000 }, why) === null && why.field === 'Total payout', 'a total equal to the price is refused too');
ok(clean({ ...lock, multiplier: '', expectedReturn: 5400 }).expectedReturn === 5400, 'a typed total above the price is fine');
const inc = clean({ key: 'a', name: 'A', price: 30000, cycle: 8, multiplier: 3 }); ok(inc && inc.category === 'income', 'a normal product is Hourly income');
// the schedule of both categories (the real planSchedule)
const pa = src.indexOf('function planSchedule('), pb = src.indexOf('\n}\n', pa) + 3;
const pc = { productExpectedReturn: (p) => Math.round(p.price * p.multiplier) }; vm.createContext(pc); vm.runInContext(src.slice(pa, pb), pc);
const plan = (p) => vm.runInContext('planSchedule', pc)(p, { cycleDays: 8 });
let h = plan({ price: 5000, cycle: 2, multiplier: 1.08 });
ok(h.expectedReturn === 5400 && h.earnings === 400 && h.dailyPayout === 200 && h.total === 48 && h.periodMs === 3600000 && !h.locked, '5,000 for 2 days, total 5,400: 400 profit, 200 a day, 48 hourly payments');
let k = plan({ price: 5000, cycle: 2, multiplier: 1.08, category: 'wage' });
ok(k.locked && k.total === 1 && k.periodMs === 2 * 86400000 && k.dailyPayout === 200 && k.expectedReturn === 5400, 'Locking: one payment at the end of the 2 days, releasing the 5,400');
// the purchase route and the admin activation
ok(/if \(!\(Number\(tier\.price\) > 0\)\) return res\.status\(400\)\.json\(\{ status: 'error', code: 'SOLD_OUT'/.test(src) && !/tier\.category === 'wage'\) return res\.status\(400\)/.test(src), 'a Locking product can be bought; only a product with no price is "sold out"');
ok(/Locking products are bought by members, they cannot be activated from here/.test(src), 'the admin cannot activate a Locking product for a member');
ok(/payoutModel: 'principal-last', periodMs: plan\.periodMs, principal: liveTier\.price/.test(src), 'a purchase stores the new rule, its period and the price to give back');
// the admin panel and the app
const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), cli = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
ok(/id="newTask"/.test(adm) && /category: task\?'wage':'income'/.test(adm) && /Locking products \(/.test(adm), 'the admin has a separate Locking products section');
ok(!/Daily wage/.test(adm) && !/Daily wage/.test(cli.replace(/\/\/[^\n]*/g, '')), 'nothing in the panel or the app says Daily wage any more');
ok(/>Hourly Income<\/button>/.test(cli) && />Locking<\/button>/.test(cli), 'the two tabs read Hourly Income and Locking');
ok(/limit > 0 \? `<em class="v-badge">Times/.test(cli), 'the Times x/limit badge shows only when a purchase limit is set');
ok(/activated\$\/i\.test\(String\(t\.description/.test(cli) && /return 'Free \( '/.test(cli), 'a product the admin gave still reads "Free ( Gold )" in Balance Details');
ok(/if \(name === 'home' && prevPage !== 'home'\) STATE\.homeTab = 'income'/.test(cli) && /STATE\.homeTab === 'wage'\) \{ STATE\.homeTab = 'income'/.test(cli), 'Home always opens on Hourly income, also after leaving the app and coming back');
ok(!/data-move/.test(adm), 'no manual moving: the category decides itself');
ok(/p\.category = \(p\.category === 'wage' \|\| Number\(p\.price\) === 0\) \? 'wage' : 'income'/.test(src), 'the server always decides the category');
ok(/function ckIsWage\(p\)/.test(cli), 'the app has one rule for the two tabs');
ok(/const list = homeTabProducts\(\);\n\s+\$\('homeProducts'\)\.innerHTML/.test(cli), 'the live refresh of Home keeps only the open tab\'s products');
ok(/vOwnedCount\(p\.key\) >= limit\) return `<button class="v-buy" type="button" onclick="notify\('Investment Limit\.\.\.'\)"/.test(cli), 'at the purchase limit the Buy now button stays blue and says "Investment Limit..."');
console.log(`PASS: Locking and hourly products (${n} checks)`);
