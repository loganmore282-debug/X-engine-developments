'use strict';
// Amharic is the second language of the Ethiopia app: the region offers it, the table has an Amharic cell for the main screens, and the
// font stack can draw it.
const fs = require('node:fs'), assert = require('node:assert/strict');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/\{ code: 'am',\s+name: 'Amharic'/.test(mod), 'Amharic is in the language list');
ok(/languages: \['en', 'am'\], defaultLang: 'en'/.test(server) && /languages: \['en', 'am'\], defaultLang: 'en' \}/.test(mod), 'the region offers English and Amharic, English first');
const a = mod.indexOf('var LANG_ROWS = ['), b = mod.indexOf('// ==== I18N TABLE: SHARED WITH THE ADMIN PANEL - END');
const tables = new Function(mod.slice(a, b) + ';return {rows: LANG_ROWS, pats: LANG_PATTERNS};')();
const row = en => tables.rows.find(r => r[0] === en);
const want = { 'Home': 'መነሻ', 'Login': 'ግባ', 'Deposit': null, 'Buy now': 'አሁን ይግዙ', 'Team Recharge': 'የቡድን ተቀማጭ', 'My QR code': 'የእኔ QR ኮድ', 'Order Amount': null, 'Please choose payment': null };
for (const [en, am] of Object.entries(want)) { const r = row(en); ok(r && r.length === 7 && /[ሀ-፿]/.test(r[6]) && (am === null || r[6] === am), 'Amharic cell for "' + en + '"'); }
const withAm = tables.rows.filter(r => r.length === 7 && /[ሀ-፿]/.test(r[6])).length;
ok(withAm >= 300, 'at least 300 phrases have an Amharic cell (' + withAm + ')');
ok(tables.pats.some(p => p[0] === 'Withdraw {0}' && /[ሀ-፿]/.test(p[6])) && tables.pats.some(p => p[0].startsWith('Copy the promotion link') && /[ሀ-፿]/.test(p[6])), 'patterns with a number have Amharic too');
ok(tables.rows.every(r => r.length === 6 || r.length === 7) && tables.pats.every(r => r.length === 6 || r.length === 7), 'no row has a stray cell count');
ok(/Noto\+Sans\+Ethiopic/.test(html) && /'Noto Sans Ethiopic','Nyala'/.test(html), 'the page loads and falls back to an Ethiopic font');
console.log('PASS: Amharic (' + n + ' checks)');
