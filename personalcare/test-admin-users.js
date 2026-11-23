'use strict';
// Admin Users page: search, the member password rule, a light list, and copy that matches the first-purchase reward.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// the real search filter, run on its own
const a = adm.indexOf('function phoneCore('), b = adm.indexOf('\n', a);
const d = adm.indexOf('function drawUsers(){'), e = adm.indexOf('  const note = ', d);
const filterSrc = adm.slice(d, e).replace('function drawUsers(){', 'function pick(_users, raw){').replace("const raw = ($('userSearch')?.value||'').trim();", '') + '\n  return list;\n}';
const ctx = {}; vm.createContext(ctx); vm.runInContext(adm.slice(a, b) + '\n' + filterSrc + '\nthis.pick = pick;', ctx);
const users = [
  { id: 'u1', phone: '+256771234567', publicId: '11024', referralCode: 'AB12CD' },
  { id: 'u2', phone: '+256700111222', publicId: '11025', referralCode: 'ZX99YY' },
  { id: 'u3', phone: '+256788000999', publicId: '11026', referralCode: '' }];
const find = q => ctx.pick(users, q).map(u => u.id).join(',');
ok(find('0771234567') === 'u1' && find('+256 771 234 567') === 'u1' && find('771234567') === 'u1', 'a phone number is found however it is typed');
ok(find('ZX99') === 'u2', 'a referral code such as ZX99 does not match every phone containing 99');
ok(find('id 11026') === 'u3' && find('11025') === 'u2', 'a member id is found');
ok(find('nomatch') === '', 'no match, no rows');
// the server
ok(/MEMBER_PASSWORD_MIN \|\| newPassword\.length > MEMBER_PASSWORD_MAX/.test(src) && !/weakPasswordReason/.test(src), 'an admin-set member password follows the app\'s own length rule only, no weak-password list');
ok(/if \(\/\^credited\/\.test\(k\)\) delete safe\[k\]/.test(src), 'the member list leaves out the long bookkeeping lists');
ok(/at least 6 characters/.test(adm) && !/at least 10 characters/.test(adm) && /placeholder="New password"/.test(adm), 'the panel asks for the same 6 characters and the box carries no hint');
ok(/pays the reward on their first purchase/.test(adm) && /A reward already paid is never paid again; a recharge pays nothing/.test(adm) && !/first confirmed recharge|first-deposit commission/.test(adm), 'the attach-referrer copy describes the first-purchase reward');
console.log(`PASS: admin users (${n} checks)`);
