#!/usr/bin/env node
// Côte d'Ivoire market: +225 numbers (10 digits, the leading 0 is kept), CFA franc XOF, French only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const member = fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'user-src/index.html'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8');
function fn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
// ── server region ──
const R = new Function(server.match(/const DEFAULT_REGION = Object\.freeze\((\{[\s\S]*?\})\);/)[0].replace('const DEFAULT_REGION = Object.freeze(', 'return (').replace(/\);$/, ')') )();
assert.equal(R.key, 'ci'); assert.equal(R.dialCode, '225'); assert.equal(R.currency, 'XOF'); assert.equal(R.name, "Côte d'Ivoire");
assert.deepEqual(R.languages, ['fr']); assert.equal(R.defaultLang, 'fr'); assert.equal(R.localLength, 10); assert.deepEqual(R.prefixes, ['01', '05', '07']);
assert.equal(R.utcOffsetMin, 0);
assert.match(server, /const DEFAULT_REGION_KEY = 'ci'/);
const S = new Function('DEFAULT_REGION', 'const currentRegion=()=>DEFAULT_REGION;' + ['localDigits', 'regionUsesBareLocal', 'phoneToEmail', 'cleanPhone', 'phoneFormatHint', 'currencyLabel', 'fmtMoney'].map(n => fn(server, n)).join('\n') + ';return {cleanPhone, phoneToEmail, phoneFormatHint, fmtMoney, currencyLabel};')(R);
for (const [raw, want] of [['0707070707', '+2250707070707'], ['+2250707070707', '+2250707070707'], ['2250707070707', '+2250707070707'], ['0505050505', '+2250505050505'], ['0102030405', '+2250102030405'],
  ['0912345678', null], ['070707070', null], ['07070707070', null], ['912345678', null], ['', null]])
  assert.equal(S.cleanPhone(raw), want, 'phone ' + raw);
assert.equal(S.phoneToEmail('0707070707'), '0707070707@soda-platform.com');
assert.equal(S.phoneToEmail('+2250707070707'), '0707070707@soda-platform.com');
assert.equal(S.phoneFormatHint().local, '01XXXXXXXX'); assert.equal(S.phoneFormatHint().intl, '+22501XXXXXXXX');
assert.equal(S.fmtMoney(12500), 'FCFA 12,500'); assert.equal(S.fmtMoney(5, 'XOF'), 'FCFA 5'); assert.equal(S.currencyLabel('xof'), 'FCFA');
assert.doesNotMatch(server, /'ETB'\)/, 'no ETB fallback left in a currency label');
// ── member app ──
assert.match(member, /var REGION = \{ key: 'ci', name: "Côte d'Ivoire", currency: 'XOF', dialCode: '225', localLength: 10, prefixes: \['01','05','07'\]/);
assert.match(member, /languages: \['fr'\], defaultLang: 'fr'/);
assert.match(member, /var LANG = 'en';/); assert.match(member, /var LANG_ALLOWED = \['en'\];/); // 'en' only means "no runtime translation": the text itself is French
assert.equal((shell.match(/id="(login|reg|forgot)Dial">\+225</g) || []).length, 2, 'both dial chips (Log In, Sign Up) say +225');
assert.doesNotMatch(shell, /Dial">\+25[16]</);
assert.match(shell, /<html lang="fr"[^>]*>/);
assert.match(shell, /id="langBtn"/, 'the language button exists (hidden because there is only one language)');
// the table: a French cell for every row, placeholders intact, no cell that just repeats English
const a = member.indexOf('var LANG_ROWS = ['), b = member.indexOf('// ==== I18N TABLE: SHARED WITH THE ADMIN PANEL - END');
const { LANG_ROWS, LANG_PATTERNS } = new Function(member.slice(a, b) + ';return {LANG_ROWS, LANG_PATTERNS}')();
const SAME_IN_FRENCH = new Set(['Soda', 'Min', 'Sec', 'Messages', 'Total', 'Recharge', 'Recharges', 'Mobile Money', 'USDT (TRC20)', 'PAY-B', 'PAY-C', 'MOBILE MONEY', 'Fruit']);
let withFr = 0, missing = [];
for (const row of [...LANG_ROWS, ...LANG_PATTERNS]) {
  const fr = row[3];
  if (typeof fr !== 'string' || !fr) { missing.push(row[0]); continue; }
  withFr++;
  if (fr === '=') continue;
  if (!SAME_IN_FRENCH.has(row[0])) assert.notEqual(fr, row[0], 'French cell repeats English: ' + row[0]);
  const ph = s => (s.match(/\{\d+\}/g) || []).sort().join();
  assert.equal(ph(fr), ph(row[0]), 'placeholders differ: ' + row[0]);
}
const unexpected = missing.filter(x => !SAME_IN_FRENCH.has(x));
assert.deepEqual(unexpected, [], 'rows with no French: ' + unexpected.join(' | '));
assert.ok(withFr >= 700, 'French covers the table (' + withFr + ' rows)');
// ── admin panel: amounts are CFA francs ──
assert.match(panel, /ADMIN_REGIONS = \[\{ key: 'ci', name: "Côte d'Ivoire", currency: 'XOF' \}\]/);
assert.match(panel, /function adminCur\(\)\{ return 'FCFA'; \}/);
console.log("PASS: Côte d'Ivoire (+225, XOF, French only): " + withFr + ' French rows');
