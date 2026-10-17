'use strict';
// Task products ("Daily wage"): price 0, never bought (the server answers "sold out"), no VIP, activated for a member by the admin.
const fs = require('node:fs'), assert = require('node:assert/strict'), vm = require('node:vm');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// the real sanitizer, run on its own
const a = src.indexOf('function sanitizeProductInput('), b = src.indexOf('\n}\n', a) + 3;
const ctx = { MAX_MONEY_AMOUNT: 1e9, MAX_SPINS_PER_PURCHASE: 50, hhmmToMin: v => (/^\d\d:\d\d$/.test(v) ? 1 : null) };
vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
const clean = (p, why) => vm.runInContext('sanitizeProductInput', ctx)(p, 0, why);
const wage = { key: 'silver', name: 'Silver', category: 'wage', price: 0, cycle: 360, expectedReturn: 360000, buyLimit: 0, vip: 5, multiplier: 3 };
const w = clean(wage); ok(w && w.category === 'wage' && w.price === 0 && w.vip === 0 && w.multiplier === null && w.expectedReturn === 360000, 'a task product keeps price 0, no VIP, no multiplier');
const why = {}; ok(clean({ ...wage, expectedReturn: '' }, why) === null && why.field === 'Total payout', 'a task product needs its total payout');
ok(clean({ key: 'a', name: 'A', price: 0, cycle: 8, multiplier: 3 }) === null, 'a normal product still cannot cost 0');
const inc = clean({ key: 'a', name: 'A', price: 30000, cycle: 8, multiplier: 3 }); ok(inc && inc.category === 'income', 'a normal product is Daily income');
// the purchase route and the admin activation
ok(/if \(tier\.category === 'wage'\) return res\.status\(400\)\.json\(\{ status: 'error', code: 'SOLD_OUT', message: 'The product has been sold out' \}\)/.test(src), 'buying a task product is always "sold out"');
ok(/const isTask = tier\.category === 'wage';[\s\S]{0,200}!\(price > 0\) && !isTask/.test(src), 'the admin can activate a free task product');
ok(/if \(!isTask\) await uRef\.update\(\{ totalInvested/.test(src), 'a free task product does not count as a first purchase');
// the admin panel and the app
const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), cli = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
ok(/id="newTask"/.test(adm) && /category: task\?'wage':'income'/.test(adm), 'the admin has a separate Task products section');
ok(/ckIsWage\(p\)\) \? `<em class="v-badge">Times/.test(cli), 'task products always show Times 0/0');
ok(/result\.code === 'SOLD_OUT'\) closeConfirm\(\)/.test(cli) && /ckLoadBegin\(\);\n    try \{ result = await api\('\/invest\/create'/.test(cli), 'the purchase waits behind the loading box and a sold-out answer closes the dialog');
ok(/activated\$\/i\.test\(String\(t\.description/.test(cli) && /return 'Free \( '/.test(cli), 'an activated task product reads "Free ( Gold )" in Balance Details');
ok(/amt === 0 && t\.type === 'investment'\)\) \? '-'/.test(cli), 'with "- 0.00", as in the screenshot');
ok(/if \(name === 'home' && prevPage !== 'home'\) STATE\.homeTab = 'income'/.test(cli) && /STATE\.homeTab === 'wage'\) \{ STATE\.homeTab = 'income'/.test(cli), 'Home always opens on Daily income, also after leaving the app and coming back');
ok(!/data-move/.test(adm), 'no manual moving: the category decides itself');
ok(/p\.category = \(p\.category === 'wage' \|\| Number\(p\.price\) === 0\) \? 'wage' : 'income'/.test(src), 'the server always decides the category: a task product, or anything free, is Daily wage');
ok(/function ckIsWage\(p\)/.test(cli) && !/p\.category === 'wage' \? 'wage'/.test(cli), 'the app uses that same rule for Daily income / Daily wage');
ok(/const list = homeTabProducts\(\);\n\s+\$\('homeProducts'\)\.innerHTML/.test(cli), 'the live refresh of Home keeps only the open tab\'s products (it used to put every product back, mixing the two)');
console.log(`PASS: task products (${n} checks)`);
