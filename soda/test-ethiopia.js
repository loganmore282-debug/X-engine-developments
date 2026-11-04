#!/usr/bin/env node
// Ethiopia market: +251 numbers, birr shown as the symbol Br, English + Amharic.
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
assert.equal(R.key, 'et'); assert.equal(R.dialCode, '251'); assert.equal(R.currency, 'ETB');
assert.deepEqual(R.languages, ['en', 'am']); assert.equal(R.localLength, 9); assert.deepEqual(R.prefixes, ['9', '7']);
assert.match(server, /const DEFAULT_REGION_KEY = 'et'/);
const S = new Function('DEFAULT_REGION', 'const currentRegion=()=>DEFAULT_REGION;' + ['localDigits', 'regionUsesBareLocal', 'phoneToEmail', 'cleanPhone', 'currencyLabel', 'fmtMoney'].map(n => fn(server, n)).join('\n') + ';return {cleanPhone,phoneToEmail,fmtMoney}')(R);
for (const [raw, want] of [['0912345678', '+251912345678'], ['912345678', '+251912345678'], ['+251912345678', '+251912345678'], ['0712345678', '+251712345678'], ['0812345678', null], ['0771234567', '+251771234567'], ['091234567', null]])
  assert.equal(S.cleanPhone(raw), want, 'phone ' + raw);
assert.equal(S.phoneToEmail('0912345678'), '912345678@soda-platform.com');
assert.equal(S.fmtMoney(12500), 'Br 12,500'); assert.equal(S.fmtMoney(1234.5), 'Br 1,234.50');
assert.equal(S.fmtMoney(5, 'ETB'), 'Br 5');
// ── member app ──
assert.match(member, /var REGION = \{ key: 'et', name: 'Ethiopia', currency: 'ETB', dialCode: '251'/);
assert.match(member, /languages: \['en','am'\]/);
assert.match(member, /code: 'am',\s+name: 'Amharic'/);
assert.equal((shell.match(/id="(login|reg|forgot)Dial">\+251</g) || []).length, 2, 'both dial chips (Log In, Sign Up) say +251');
assert.doesNotMatch(shell, /Dial">\+256</);
assert.match(shell, /id="langBtn"/, 'language button is back on the sign-in screen');
assert.match(shell, /Noto\+Sans\+Ethiopic/, 'Ethiopic font is loaded');
assert.match(shell, /'Noto Sans Ethiopic'/, 'font stack names an Ethiopic font');
// the table: an Amharic cell for (nearly) every row, placeholders intact, no cell that just repeats English
const a = member.indexOf('var LANG_ROWS = ['), b = member.indexOf('// ==== I18N TABLE: SHARED WITH THE ADMIN PANEL - END');
const { LANG_ROWS, LANG_PATTERNS } = new Function(member.slice(a, b) + ';return {LANG_ROWS, LANG_PATTERNS}')();
let withAm = 0;
for (const row of [...LANG_ROWS, ...LANG_PATTERNS]) {
  const am = row[6];
  if (typeof am !== 'string' || !am) continue;
  withAm++;
  if (am === '=') continue;
  assert.notEqual(am, row[0], 'Amharic cell repeats English: ' + row[0]);
  assert.match(am, /[ሀ-፿]/, 'Amharic cell has no Ethiopic letters: ' + row[0]);
  const ph = s => (s.match(/\{\d+\}/g) || []).sort().join();
  assert.equal(ph(am), ph(row[0]), 'placeholders differ: ' + row[0]);
}
assert.ok(withAm >= 450, 'Amharic covers the table (' + withAm + ' rows)');
// ── admin panel: amounts are birr ──
assert.match(panel, /ADMIN_REGIONS = \[\{ key: 'et', name: 'Ethiopia', currency: 'ETB' \}\]/);
assert.match(panel, /function adminCur\(\)\{ return 'Br'; \}/);
console.log('PASS: Ethiopia (+251, birr as Br, English + Amharic): ' + withAm + ' Amharic rows');
