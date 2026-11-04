'use strict';
// Random 4-character member addresses: SHARE_DOMAIN on the server, a fresh label on every Share open in the app, and the deploy script.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'user');
const API = (fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8').match(/API_BASE\s*=\s*'([^']+)'/) || [])[1];

const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const sd = srvSrc.slice(srvSrc.indexOf('const SHARE_DOMAIN = (() => {'), srvSrc.indexOf('let _mainAllowedHosts'));
const SD = env => new Function('process', sd + ';return SHARE_DOMAIN')({ env });
ok(SD({ SHARE_DOMAIN: 'soda-cchnug.com' }) === 'soda-cchnug.com', 'server: SHARE_DOMAIN is read');
ok(SD({ SHARE_DOMAIN: 'https://*.Soda-Cchnug.com/' }) === 'soda-cchnug.com', 'server: https://, *. and capitals are tidied');
ok(SD({}) === '' && SD({ SHARE_DOMAIN: 'nodots' }) === '', 'server: empty or not a domain means none');
ok(/shareDomain: SHARE_DOMAIN/.test(srvSrc) && /SHARE_DOMAIN \? \[SHARE_DOMAIN\] : \[\]/.test(srvSrc), 'server: tells the app the domain and lets its subdomains reach the API');
const sh = fs.readFileSync(path.join(__dirname, 'deploy/set-wildcard.sh'), 'utf8'), mk = fs.readFileSync(path.join(__dirname, 'deploy/make-nginx.js'), 'utf8'), up = fs.readFileSync(path.join(__dirname, 'deploy/update-vps.sh'), 'utf8');
ok(/--cert-name soda-wild/.test(sh) && /SHARE_DOMAIN/.test(sh) && /update-vps\.sh/.test(sh) && !/chocolate|petro/i.test(sh), 'deploy script: own certificate, saves SHARE_DOMAIN, then rebuilds nginx, no Chocolate or Petro leftovers');
ok(/\{4\}/.test(mk) && /--wild-only/.test(mk) && /--wild="\$WILD_DOMAIN"/.test(up), 'nginx generator and update script: exactly four characters, kept across every update');
const FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];";
const FB_AUTH = "export const getAuth=()=>({currentUser:null});export const createUserWithEmailAndPassword=async()=>({});export const signInWithEmailAndPassword=async()=>({});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(null),0);};";
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8875, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const ctx = await b.newContext({ viewport: { width: 411, height: 776 }, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(API + '/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', settings: {} }) }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/firebase-app\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_APP }));
    await page.route(/firebase-auth\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_AUTH }));
    await page.route('https://h6re.soda-cchnug.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, 'index.html')) }));
    await page.goto('https://h6re.soda-cchnug.com/index.html', { waitUntil: 'commit' }); await page.waitForTimeout(3200);
    const r = await page.evaluate(() => {
      STATE.settings = Object.assign({}, STATE.settings, { shareDomain: 'soda-cchnug.com' });
      const seen = new Set(), bad = [];
      for (let i = 0; i < 3000; i++) { const o = shareOrigin(); const m = /^https:\/\/([a-z0-9]{4})\.soda-cchnug\.com$/.exec(o); if (!m) { bad.push(o); continue; } if (/^\d{4}$/.test(m[1]) || m[1] === 'qumx') bad.push(o); seen.add(m[1]); }
      STATE.settings.shareDomain = '';
      const none = shareOrigin();
      STATE.settings.shareDomain = 'other-domain.com';
      const other = shareOrigin();
      return { bad: bad.slice(0, 3), distinct: seen.size, none, other, here: location.origin };
    });
    ok(r.bad.length === 0, 'every address is https://xxxx.soda-cchnug.com with four letters or digits, never all digits, never qumx (' + r.bad.join(',') + ')');
    ok(r.distinct > 2000, 'addresses are random: ' + r.distinct + ' different out of 3000');
    ok(r.none === r.here, 'no domain set: the link keeps the address the app is open on');
    ok(r.other === r.here, 'app open on another domain: link keeps that address');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: random 4-character member addresses (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
