'use strict';
// This device's last signed-in number and password stay in the Login boxes (after sign-out and after a session ends); one tap on Login.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = mod.indexOf('var SAVED_LOGIN_KEY'), b = mod.indexOf('window.doLogin = async function');
const ld = mod.indexOf('function localDigits('), le = mod.indexOf('\n}\n', ld) + 3;
const store = {}, els = { loginPhone: { id: 'loginPhone', value: '' }, loginPassword: { id: 'loginPassword', value: '' } };
const listeners = [];
const c = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
  unescape, escape, encodeURIComponent, decodeURIComponent, JSON, String, $: id => els[id], document: { addEventListener: (t, f) => listeners.push([t, f]) },
  REGION: { localLength: 9, prefixes: ['7'], dial: '256' } };
vm.createContext(c);
vm.runInContext('function dial(){ return "256"; } function localLen(){ return 9; }\n' + mod.slice(ld, le) + '\n' + mod.slice(a, b), c);
const typePhone = v => { els.loginPhone.value = v; listeners.filter(l => l[0] === 'input').forEach(l => l[1]({ target: els.loginPhone })); };
// nothing kept yet
c.savedLoginFill(true); ok(els.loginPhone.value === '' && els.loginPassword.value === '', 'nothing kept, nothing filled');
// a member signs in: number and password are kept, and not readable as plain text in storage
c.savedLoginSet('0771234567', 'my-long-secret-1');
ok(!/my-long-secret-1|0771234567/.test(store.cookie_saved_login), 'the stored value is not plain text');
c.savedLoginFill(true); ok(els.loginPhone.value === '0771234567' && els.loginPassword.value === 'my-long-secret-1', 'after sign-out or an ended session the boxes hold the number and password');
// unicode password round-trips
c.savedLoginSet('0771234567', 'pässwörd-日本-12345'); c.savedLoginFill(true); ok(els.loginPassword.value === 'pässwörd-日本-12345', 'any characters survive');
c.savedLoginSet('0771234567', 'my-long-secret-1');
// a fresh start never writes over what someone has typed
els.loginPhone.value = '0788999000'; els.loginPassword.value = ''; c.savedLoginFill(false); ok(els.loginPhone.value === '0788999000' && els.loginPassword.value === '', 'typed values are never overwritten at start');
// another member signs in on the same device: only the latest member is kept
c.savedLoginSet('0788999000', 'second-member-pass-2'); c.savedLoginFill(true);
ok(els.loginPhone.value === '0788999000' && els.loginPassword.value === 'second-member-pass-2', 'the latest member replaces the earlier one (never mixed)');
// typing a different number takes the other member's password out of the box
c.savedLoginFill(true); typePhone('0771234567'); ok(els.loginPassword.value === '', 'a different number does not keep the kept password');
c.savedLoginFill(true); typePhone('0788 999 000'); ok(els.loginPassword.value === 'second-member-pass-2', 'the same number typed another way keeps it');
// a password that stopped working is forgotten, the number stays
c.savedLoginDropPass(); c.savedLoginFill(true); ok(els.loginPhone.value === '0788999000' && els.loginPassword.value === '', 'a stale password is dropped, the number stays');
// a bad value in storage is ignored
store.cookie_saved_login = '%%%'; ok(c.savedLoginGet() === null, 'a damaged record is ignored');
// wiring
ok(/savedLoginSet\(\$\('loginPhone'\)\.value, pass\)/.test(mod) && (mod.match(/savedLoginSet\(\$\('regPhone'\)\.value, pass\)/g) || []).length === 2, 'login and sign-up both keep the number and password');
ok(/showAuthTab\('login'\);\n  savedLoginFill\(true\);/.test(mod), 'sign-out and an ended session refill the boxes');
ok(!/if \(!auto && phoneInput\) phoneInput\.value = ''/.test(mod), 'sign-out no longer empties them');
ok(/savedLoginFill\(false\);   \/\/ this device's last member/.test(mod), 'a start with nobody signed in fills them');
ok(/savedLoginDropPass\(\); \$\('loginPassword'\)\.value = ''/.test(mod), 'a wrong password is forgotten');
ok(/savedLoginSet\(kept\.phone, newPass\)/.test(mod), 'changing the password in the app updates the kept one');
ok(!/maybeAutoSubmit\(\);\s*\n\s*\}\n\s*\['input'/.test('') && /if \(!e\.target\.matches\(':-webkit-autofill'\)\) return;/.test(mod), 'filling never signs in by itself: only a tap on Login does');
console.log(`PASS: saved login (${n} checks)`);
