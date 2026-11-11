'use strict';
// Côte d'Ivoire: the box sits after the "+225" chip and the number keeps its leading 0 (10 digits, 01 / 05 / 07):
// +225 07 07 07 07 07. Typed, pasted with +225, or auto-filled by a password manager, it ends up as 0707070707, and the
// server turns every one of those forms into the same +2250707070707.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'user');
const API = (fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8').match(/API_BASE\s*=\s*'([^']+)'/) || [])[1];
// ── server side: one number, every spelling ──
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function fn(n) { const i = src.indexOf('function ' + n + '('); let d = 0; for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') d++; if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); } }
const R = { key: 'ci', name: "Côte d'Ivoire", currency: 'XOF', dialCode: '225', localLength: 10, prefixes: ['01', '05', '07'] };
const S = new Function('DEFAULT_REGION', 'const currentRegion=()=>DEFAULT_REGION;' + ['localDigits', 'regionUsesBareLocal', 'phoneToEmail', 'cleanPhone'].map(fn).join('\n') + ';return {cleanPhone,phoneToEmail}')(R);
for (const raw of ['0707070707', '+2250707070707', '2250707070707', '+225 07 07 07 07 07', '07 07 07 07 07']) { ok(S.cleanPhone(raw) === '+2250707070707', 'server: ' + raw + ' -> +2250707070707'); ok(S.phoneToEmail(raw) === '0707070707@petro-platform.com', 'server email: ' + raw); }
ok(S.cleanPhone('070707070') === null && S.cleanPhone('07070707070') === null && S.cleanPhone('0912345678') === null && S.cleanPhone('707070707') === null, 'wrong lengths and wrong prefixes are refused');
// ── the boxes in the built app ──
const FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];";
const FB_AUTH = "export const getAuth=()=>({currentUser:null});export const createUserWithEmailAndPassword=async()=>({});export const signInWithEmailAndPassword=async()=>({});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(null),0);};";
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8873, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 411, height: 776 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(API + '/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', settings: {} }) }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/firebase-app\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_APP }));
    await page.route(/firebase-auth\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_AUTH }));
    await page.goto('http://127.0.0.1:8873/index.html', { waitUntil: 'commit' }); await page.waitForTimeout(3200);
    for (const [typed, shown] of [['0707070707', '0707070707'], ['+2250707070707', '0707070707'], ['2250707070707', '0707070707'], ['0505050505', '0505050505'], ['070707070799999', '0707070707']]) {
      await page.fill('#loginPhone', ''); await page.type('#loginPhone', typed);
      ok(await page.inputValue('#loginPhone') === shown, 'login box: typing ' + typed + ' shows ' + shown);
    }
    await page.evaluate(() => showAuthTab('register'));
    await page.fill('#regPhone', '0707070707'); await page.dispatchEvent('#regPhone', 'input');
    ok(await page.inputValue('#regPhone') === '0707070707', 'sign-up box keeps 0707070707');
    ok((await page.textContent('#regDial')).trim() === '+225', 'beside the +225 chip');
    // a password manager that fills the box silently (no typing event)
    await page.evaluate(() => { showAuthTab('login'); document.getElementById('loginPhone').value = '+2250505050505'; });
    await page.dispatchEvent('#loginPhone', 'change');
    ok(await page.inputValue('#loginPhone') === '0505050505', 'an auto-filled +2250505050505 is tidied to 0505050505');
    await page.evaluate(() => { document.getElementById('loginPhone').value = '+2250505050505'; window.dispatchEvent(new Event('pageshow')); });
    ok(await page.inputValue('#loginPhone') === '0505050505', 'and again when the page comes back to the front');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: phone numbers shown and accepted as +225 0505050505 (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
