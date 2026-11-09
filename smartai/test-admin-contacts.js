'use strict';
// Admin > Users: "Save contacts (.vcf)" and "Copy numbers" (owner: "save user contacts on the user list as vcf ... each number separated by comma, only numbers
// no other details"). The REAL functions from admin-src/index.html run here with the page's pieces stubbed. Only the NUMBER of each listed user leaves the panel;
// the search narrows the list; with it empty it is every user, not just the 500 the table shows; the buttons are for the owner only.
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const a = src.indexOf('function usersMatching(){'), b = src.indexOf('function drawUsers(){');
ok(a > 0 && b > a, 'the contacts code is in the admin page');
const pcAt = src.indexOf('function phoneCore(p)'), phoneCoreSrc = src.slice(pcAt, src.indexOf('\n', pcAt));
ok(/^function phoneCore\(p\)\{/.test(phoneCoreSrc), 'phoneCore is found');
const TODAY = new Date().toISOString().slice(0, 10);

// the page, stubbed: the users, the search box, the toast, the clipboard helper, the download
function page(users, search, title) {
  const log = { toasts: [], copied: [], downloads: [], blobs: [] };
  const els = { userSearch: { value: search || '' } };
  const document = { title: title === undefined ? 'Test App Admin' : title, body: { appendChild() {} },
    createElement: () => { const el = { click() { log.downloads.push({ href: el.href, name: el.download }); }, remove() {} }; return el; } };
  class FakeBlob { constructor(parts, opts) { this.text = parts.join(''); this.type = opts && opts.type; log.blobs.push(this); } }
  const URL = { createObjectURL: blob => 'blob:' + log.blobs.indexOf(blob), revokeObjectURL() {} };
  const f = new Function('$', '_users', 'toast', 'copyText', 'document', 'Blob', 'URL', 'setTimeout',
    phoneCoreSrc + '\n' + src.slice(a, b) + '\nreturn { usersMatching, contactNumber, contactNumbers, contactsVcf, saveContactsVcf, copyContactNumbers };');
  const api = f(id => els[id] || null, users, (m, k) => log.toasts.push([m, k || '']), (str, btn, msg) => log.copied.push([str, msg]), document, FakeBlob, URL, () => 0);
  return Object.assign(api, { log, els });
}
const U = (phone, extra) => Object.assign({ id: 'id-' + phone, phone, referralCode: 'R' + String(phone).slice(-4), status: 'active', walletBalance: 1234, totalInvested: 5 }, extra || {});

// ---- one number, cleaned
const p0 = page([]);
for (const [raw, want] of [['+256770300047', '+256770300047'], ['256770300047', '256770300047'], ['0770300047', '0770300047'], ['0770 300 047', '0770300047'], ['+256 770-300-047', '+256770300047'],
  [' +256770300047 ', '+256770300047'], ['+256(770)300047', '+256770300047'], ['', ''], [null, ''], [undefined, ''], ['Not set', ''], ['12345', ''], ['1234567', '1234567'], ['1234567890123456', '']])
  eq(p0.contactNumber(raw), want, 'number of ' + JSON.stringify(raw));
ok(p0.contactNumber('0770300047abc') === '0770300047', 'letters are dropped, only the digits stay');

// ---- the list: every user, no cap of 500, duplicates and unusable numbers left out, banned users included, order kept
const many = []; for (let i = 0; i < 1200; i++) many.push(U('+25677' + String(1000000 + i)));
many.push(U('+256770000000', { status: 'banned' }), U('+25677' + String(1000005)), U(''), U('Not set'), U('123'));   // banned (kept), a duplicate of #5, and three unusable
const big = page(many);
const all = big.contactNumbers();
ok(all.length === 1201, 'every user is listed, not just the 500 the table shows (got ' + all.length + ')');
ok(new Set(all).size === all.length, 'no number twice');
eq(all.slice(0, 3), ['+256771000000', '+256771000001', '+256771000002'], 'in the order of the list');
ok(all.includes('+256770000000'), 'a banned user is included (they are on the list)');
ok(!all.includes('') && !all.includes('123'), 'unusable numbers are left out');

// ---- the search narrows it (the same filter as the table), and an empty search is everybody
const s1 = page(many, '1000007'); eq(s1.contactNumbers(), ['+256771000007'], 'search by the end of a phone');
const s2 = page([U('+256770300047'), U('+256770300089'), U('+256751111111')], '77030'); eq(s2.contactNumbers(), ['+256770300047', '+256770300089'], 'search finds the matching numbers only');
const s3 = page([U('+256770300047'), U('+256770300089')], 'R0089'); eq(s3.contactNumbers(), ['+256770300089'], 'search by referral code');
const s4 = page([U('+256770300047')], 'nobody-has-this'); eq(s4.contactNumbers(), [], 'nothing matches: nothing listed');
const s5 = page([U('+256770300047'), U('+256770300089')], '   '); eq(s5.contactNumbers().length, 2, 'blank spaces in the search are an empty search');
ok(page(many, '').usersMatching().length === many.length, 'with the search empty, usersMatching is the whole list');

// ---- the file: one contact per number, the number its only detail
const two = ['+256770300047', '+256770300089'];
const vcf = p0.contactsVcf(two);
eq(vcf, 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:+256770300047\r\nN:+256770300047;;;;\r\nTEL;TYPE=CELL:+256770300047\r\nEND:VCARD\r\n'
  + 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:+256770300089\r\nN:+256770300089;;;;\r\nTEL;TYPE=CELL:+256770300089\r\nEND:VCARD\r\n', 'two numbers, two contacts, exactly this text');
ok(!/[^\r]\n/.test(vcf) && !/\r[^\n]/.test(vcf), 'every line ends with CR LF, as vCard asks');
eq([...new Set([...vcf.matchAll(/^([A-Z]+)[:;]/gm)].map(m => m[1]))].sort(), ['BEGIN', 'END', 'FN', 'N', 'TEL', 'VERSION'], 'no property besides the number: no name, e-mail, note, balance, code');
const bigVcf = big.contactsVcf(all);
ok((bigVcf.match(/^BEGIN:VCARD/gm) || []).length === all.length && (bigVcf.match(/^END:VCARD/gm) || []).length === all.length && (bigVcf.match(/^TEL;TYPE=CELL:/gm) || []).length === all.length, 'one contact per number for all ' + all.length);
eq([...bigVcf.matchAll(/^TEL;TYPE=CELL:(.+)\r$/gm)].map(m => m[1]), all, 'the numbers in the file are the numbers listed, in order');
ok(!/Walk|Holder|1234|R10000|banned|active/.test(bigVcf), 'nothing else of a user is in the file (no balance, code or status)');
eq(p0.contactsVcf([]), '', 'no numbers, no file text');

// ---- Save contacts (.vcf)
let t = page([U('+256770300047'), U('+256770300089')]);
t.saveContactsVcf();
ok(t.log.downloads.length === 1 && t.log.downloads[0].name === 'test-app-contacts-' + TODAY + '.vcf', 'a .vcf is downloaded, named after the app and the day', t.log.downloads);
ok(t.log.blobs.length === 1 && t.log.blobs[0].type === 'text/vcard;charset=utf-8' && t.log.blobs[0].text === t.contactsVcf(['+256770300047', '+256770300089']), 'its content is the contacts, as a vCard file');
eq(t.log.toasts, [['Saved 2 contacts (.vcf)', 'ok']], 'the owner is told how many were saved');
t = page([U('+256770300047')]); t.saveContactsVcf(); eq(t.log.toasts, [['Saved 1 contact (.vcf)', 'ok']], 'one contact: singular');
t = page([U('+256770300047')], '', 'Mint Admin'); t.saveContactsVcf(); ok(t.log.downloads[0].name === 'mint-contacts-' + TODAY + '.vcf', 'it follows the app name (Mint)');
t = page([U('+256770300047')], '', 'My Shop! Admin'); t.saveContactsVcf(); ok(t.log.downloads[0].name === 'my-shop-contacts-' + TODAY + '.vcf', 'an odd name is made safe for a file name', t.log.downloads[0].name);
t = page([U('+256770300047')], '', ''); t.saveContactsVcf(); ok(t.log.downloads[0].name === 'users-contacts-' + TODAY + '.vcf', 'no name: "users"');
t = page([U('+256770300047'), U('+256770300089')], '77030'); t.saveContactsVcf(); ok(t.log.blobs[0].text.match(/^BEGIN:VCARD/gm).length === 2, 'a search saves the matching users');
t = page([U('+256770300047'), U('+256770300089')], '0089'); t.saveContactsVcf(); ok(t.log.blobs[0].text.match(/^BEGIN:VCARD/gm).length === 1 && /0089/.test(t.log.blobs[0].text) && !/0047/.test(t.log.blobs[0].text), 'and only them');
t = page([], ''); t.saveContactsVcf(); ok(t.log.downloads.length === 0 && t.log.blobs.length === 0 && t.log.toasts.length === 1 && t.log.toasts[0][1] === 'err', 'no numbers: nothing is downloaded, the owner is told');
t = page([U('Not set'), U('')], ''); t.saveContactsVcf(); ok(t.log.downloads.length === 0, 'users without a usable number: nothing is downloaded');

// ---- Copy numbers: separated by commas, only numbers
t = page([U('+256770300047'), U('+256770300089'), U('0751111111')]); t.copyContactNumbers({});
eq(t.log.copied, [['+256770300047,+256770300089,0751111111', 'Copied 3 numbers']], 'numbers separated by commas, no spaces, no names; the owner is told how many');
ok(/^\+?\d+(,\+?\d+)*$/.test(t.log.copied[0][0]), 'only numbers and commas');
t = page(many); t.copyContactNumbers({}); ok(t.log.copied[0][0].split(',').length === 1201 && /^\+?\d+(,\+?\d+)*$/.test(t.log.copied[0][0]), 'all 1,201 numbers, comma separated');
t = page([U('+256770300047')]); t.copyContactNumbers({}); eq(t.log.copied, [['+256770300047', 'Copied 1 number']], 'one number: no comma, singular');
t = page([]); t.copyContactNumbers({}); ok(t.log.copied.length === 0 && t.log.toasts[0][1] === 'err', 'no numbers: nothing is copied, the owner is told');

// ---- the page: owner only, wired, and the table still uses the same search
const render = src.slice(src.indexOf('async function renderUsers(){'), src.indexOf('function usersMatching(){'));
ok(/\$\{isOwner\?`\s*<div class="row"[^`]*id="vcfBtn"[^`]*id="numBtn"[^`]*id="contactsHint"[^`]*`:''\}/.test(render), 'the two buttons and the count are drawn for the owner only');
ok(/if \(isOwner\) \{\s*\$\('vcfBtn'\)\.addEventListener\('click', saveContactsVcf\);\s*\$\('numBtn'\)\.addEventListener\('click', \(\)=>copyContactNumbers\(\$\('numBtn'\)\)\);/.test(render), 'and wired inside the owner-only block, so staff never reach a missing button');
const draw = src.slice(b, src.indexOf('async function quietRefreshUsers()'));
ok(/const all = usersMatching\(\);\s*const list = q \? all : all\.slice\(0,500\);/.test(draw) && /Showing first 500 of/.test(draw), 'the table uses the same search and still shows the first 500');
ok(/id="contactsHint"/.test(src) && /textContent = c\.toLocaleString\(\)/.test(draw), 'the count under the buttons follows the search');
ok(!/walletBalance|totalInvested|referralCode|\.holder|\.email/.test(src.slice(src.indexOf('function contactNumber(p){'), b)), 'the contacts code never reads anything but the phone');
console.log('test-admin-contacts: ' + n + ' checks passed');
