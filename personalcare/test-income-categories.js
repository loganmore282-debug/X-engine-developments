'use strict';
// Income page: a bought hourly product lives in Hourly income, a bought Locking product lives in Locking, never mixed, whatever
// later happens to the product (edited, switched off, removed).
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = mod.indexOf('function invCategory(i){'), b = mod.indexOf('\n', a);
const c = {}; vm.createContext(c); vm.runInContext(mod.slice(a, b) + '\nthis.invCategory = invCategory;', c);
const cat = c.invCategory;
ok(cat({ category: 'income', amount: 30000, granted: false }) === 'income', 'a bought product is Hourly income');
ok(cat({ category: 'wage', amount: 5000, granted: false }) === 'wage', 'a bought Locking product is Locking');
ok(cat({ category: 'income', amount: 90000, granted: true }) === 'income', 'an ordinary product the admin gives is Hourly income');
ok(cat({ amount: 30000 }) === 'income' && cat({ amount: 0 }) === 'wage', 'an older plan without the stamp is read from what it cost');
ok(cat({ category: 'income', amount: 30000, tierKey: 'removed-product' }) === 'income', 'removing or switching off the product changes nothing');
ok(cat(null) === 'wage' || cat(null) === 'income', 'no crash on nothing');
// the Income page uses the plan's own category and nothing else
const p = mod.indexOf('function paintAssets(){'), pe = mod.indexOf('\n}\n', p);
const body = mod.slice(p, pe);
ok(/invCategory\(i\) === tab/.test(body) && !/ckIsWage|STATE\.products/.test(body), 'Income lists a plan by its own category, not by the current product settings');
// the server stamps it when the plan is made and reports it
ok(/commissionPending: isFirstInvestment, category: plan\.locked \? 'wage' : 'income'/.test(src), 'a purchase is stamped by its product kind');
ok(/category: 'income', granted: true/.test(src), 'an admin activation is always hourly income (Locking cannot be given)');
ok(/category: data\.category === 'wage' \|\| data\.category === 'income' \? data\.category : \(\(Number\(data\.amount\) \|\| 0\) === 0 \? 'wage' : 'income'\)/.test(src), '/investments reports it (older plans from their cost)');
// the Locking badge: taller, green, Running (or Completed) over Locked (or Released)
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
ok(/invCategory\(inv\) === 'wage' \? ' ck-oc-wst' : ''/.test(mod) && /'<br>Locked'/.test(mod) && /'<br>Released'/.test(mod), 'a Locking plan\'s badge says Locked under Running, Released once paid');
ok(/\.ck-oc-wst\{z-index:2;height:42px;line-height:21px;background:rgba\(0,225,110,\.55\);\}/.test(html) && /\.ck-oc-wmul\{[^}]*height:42px[^}]*background:#0ff;mix-blend-mode:multiply/.test(html), 'and is 42 px tall in see-through green: the picture shows through the band, as in the screenshot');
ok(/class="ck-oc-wmul"/.test(mod), 'the picture is tinted under the green (a Locking plan that is still running)');
console.log(`PASS: income categories (${n} checks)`);
