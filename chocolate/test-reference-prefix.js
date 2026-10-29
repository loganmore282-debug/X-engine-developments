'use strict';
// Owner-editable start of payment references (Admin > Settings > "Payment reference starts with"): real source, no database.
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8'), admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const i = src.indexOf('function sanitizeRefPrefix(v)'); assert.ok(i > 0);
const fn = new Function(src.slice(i, src.indexOf('async function mobileMoneyRefPrefix()')) + '\nreturn sanitizeRefPrefix;')();
for (const good of ['S', 'chocolate', 'Chocolate', 'CHOCOLATE2', 'a1b2c3d4e5f6', ' chocolate ']) ok(fn(good) === good.trim(), 'accepted: ' + JSON.stringify(good));
for (const bad of ['', '  ', '2chocolate', 'so da', 'chocolate-', 'chocolate_', 'sóda', 'a1b2c3d4e5f6g', '<b>', "s'; drop", null, undefined, 12]) eq(fn(bad), '', 'refused: ' + JSON.stringify(bad));
ok(/referencePrefix: 'S'/.test(src), 'the default stays S, so nothing changes until the owner edits it');
ok(/stampRef\(letter\)[\s\S]{0,200}letter \+ d\.getUTCFullYear/.test(src), 'the reference is still prefix + date/time + 4 random digits');
ok(src.includes("const ref = await uniqueRef(await mobileMoneyRefPrefix());\n    const marzReference"), 'new mobile-money recharges use the chosen start');
ok(src.includes("const ref = await uniqueRef(await mobileMoneyRefPrefix());\n    // This adapter has no real multi-document rollback."), 'new withdrawals use the chosen start');
ok(/'referencePrefix' in updates[\s\S]{0,400}status\(400\)/.test(src), 'the settings save refuses an invalid start');
ok(/id="sRefPrefix"/.test(admin) && /referencePrefix:\$\('sRefPrefix'\)\.value\.trim\(\)/.test(admin), 'the admin panel has the field and sends it');
console.log(`PASS: payment reference start is owner-editable (${n} checks)`);
