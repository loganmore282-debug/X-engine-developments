'use strict';
// Income page: a bought product lives in Daily income, a task product the admin activates lives in Daily wage, never mixed, whatever
// later happens to the product (edited, switched off, removed).
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = mod.indexOf('function invCategory(i){'), b = mod.indexOf('\n', a);
const c = {}; vm.createContext(c); vm.runInContext(mod.slice(a, b) + '\nthis.invCategory = invCategory;', c);
const cat = c.invCategory;
ok(cat({ category: 'income', amount: 30000, granted: false }) === 'income', 'a bought product is Daily income');
ok(cat({ category: 'wage', amount: 0, granted: true }) === 'wage', 'an activated task product is Daily wage');
ok(cat({ category: 'income', amount: 90000, granted: true }) === 'income', 'an ordinary product the admin gives is Daily income');
ok(cat({ amount: 30000 }) === 'income' && cat({ amount: 0 }) === 'wage', 'an older plan without the stamp is read from what it cost');
ok(cat({ category: 'income', amount: 30000, tierKey: 'removed-product' }) === 'income', 'removing or switching off the product changes nothing');
ok(cat(null) === 'wage' || cat(null) === 'income', 'no crash on nothing');
// the Income page uses the plan's own category and nothing else
const p = mod.indexOf('function paintAssets(){'), pe = mod.indexOf('\n}\n', p);
const body = mod.slice(p, pe);
ok(/invCategory\(i\) === tab/.test(body) && !/ckIsWage|STATE\.products/.test(body), 'Income lists a plan by its own category, not by the current product settings');
// the server stamps it when the plan is made and reports it
ok(/commissionPending: isFirstInvestment, category: 'income'/.test(src), 'a purchase is stamped income');
ok(/category: isTask \? 'wage' : 'income', granted: true/.test(src), 'an admin activation is stamped by the product kind');
ok(/category: data\.category === 'wage' \|\| data\.category === 'income' \? data\.category : \(\(Number\(data\.amount\) \|\| 0\) === 0 \? 'wage' : 'income'\)/.test(src), '/investments reports it (older plans from their cost)');
// the Daily wage badge: taller, green, Running (or Completed) over Free, as in the owner's screenshot
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
ok(/invCategory\(inv\) === 'wage' \? ' ck-oc-wst' : ''/.test(mod) && /'<br>Free'/.test(mod), 'a wage plan\'s badge says Free under Running');
ok(/\.ck-oc-wst\{height:42px;line-height:21px;background:linear-gradient\(90deg,#00964e,#00cf70\);\}/.test(html), 'and is 42 px tall in green (an ordinary plan keeps the thin bar)');
console.log(`PASS: income categories (${n} checks)`);
