'use strict';
// Short invite links: https://app.<SHARE_DOMAIN>/code=<code> (one fixed address, no random labels), SHARE_DOMAIN on the server, the nginx rule and the deploy scripts.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'user');
const API = (fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8').match(/API_BASE\s*=\s*'([^']+)'/) || [])[1];

const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const sd = srvSrc.slice(srvSrc.indexOf('const SHARE_DOMAIN = (() => {'), srvSrc.indexOf('let _mainAllowedHosts'));
const SD = env => new Function('process', sd + ';return SHARE_DOMAIN')({ env });
ok(SD({ SHARE_DOMAIN: 'petro-cchnug.com' }) === 'petro-cchnug.com', 'server: SHARE_DOMAIN is read');
ok(SD({ SHARE_DOMAIN: 'https://*.Petro-Cchnug.com/' }) === 'petro-cchnug.com', 'server: https://, *. and capitals are tidied');
ok(SD({}) === '' && SD({ SHARE_DOMAIN: 'nodots' }) === '', 'server: empty or not a domain means none');
ok(/shareDomain: SHARE_DOMAIN/.test(srvSrc) && /SHARE_DOMAIN \? \[SHARE_DOMAIN\] : \[\]/.test(srvSrc), 'server: tells the app the domain and lets its subdomains reach the API');
const sh = fs.readFileSync(path.join(__dirname, 'deploy/set-wildcard.sh'), 'utf8');
ok(/\{4\}/.test(sh) && /--cert-name petro-wild/.test(sh) && /SHARE_DOMAIN/.test(sh) && !/chocolate/i.test(sh), 'deploy script: 4-character names, own certificate, saves SHARE_DOMAIN, no Chocolate leftovers');
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
    await page.route('https://h6re.petro-cchnug.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, 'index.html')) }));
    await page.goto('https://h6re.petro-cchnug.com/index.html', { waitUntil: 'commit' }); await page.waitForTimeout(3200);
    const r = await page.evaluate(() => {
      STATE.settings = Object.assign({}, STATE.settings, { shareDomain: 'petro-cchnug.com' });
      const bad = [], seen = new Set(); for (let i = 0; i < 50; i++) { const o = shareOrigin(); seen.add(o); if (o !== 'https://app.petro-cchnug.com') bad.push(o); }
      STATE.settings.shareDomain = '';
      const none = shareOrigin();
      STATE.settings.shareDomain = 'other-domain.com';
      const other = shareOrigin();
      return { bad: bad.slice(0, 3), distinct: seen.size, none, other, here: location.origin };
    });
    ok(r.bad.length === 0 && r.distinct === 1, 'the invite address is always https://app.petro-cchnug.com (' + r.bad.join(',') + ')');
    ok(r.none === r.here, 'no domain set: the link keeps the address the app is open on');
    ok(r.other === r.here, 'app open on another domain: link keeps that address');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    const modSrc = fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8');
    ok(/const link = code \? `\$\{shareOrigin\(\)\}\/code=\$\{encodeURIComponent\(code\)\}` : ''/.test(modSrc), 'the copied link is <address>/code=<code>');
    ok(!/share\.html\?v=\$\{/.test(modSrc), 'the long share.html?v=...&code=... link is no longer built');
    const cap = (pathname, search) => new Function('location', 'URLSearchParams', 'STATE', '$', modSrc.slice(modSrc.indexOf('function captureReferralFromUrl(){'), modSrc.indexOf('// Whether Sign Up demands a referral code.')) + ';captureReferralFromUrl();return STATE.refCode || null;')({ pathname, search: search || '', hash: '' }, URLSearchParams, {}, () => ({ value: '', style: {} }));
    ok(cap('/code=qbnt7kcf') === 'qbnt7kcf', 'the app reads the code off /code=qbnt7kcf');
    ok(cap('/refCode=AbC123') === 'AbC123', 'older /refCode= links still work');
    ok(cap('/share.html', '?v=1&code=Zz9') === 'Zz9', 'older share.html?code= links still work');
    const ng = fs.readFileSync(path.join(__dirname, 'deploy/nginx-petro.conf.template'), 'utf8');
    ok(/location \^~ \/code= \{[^}]*try_files \$petro_bot_html \/index\.html/.test(ng), 'nginx answers /code=... with the member app (preview crawlers get the empty page)');
    const sl = fs.readFileSync(path.join(__dirname, 'deploy/short-links.sh'), 'utf8');
    ok(/location \\\^~ \/code=/.test(sl) && /nginx -t/.test(sl) && /before-shortlinks/.test(sl), 'deploy/short-links.sh patches the live nginx files with a rollback');
    ok(/\(app\|\[a-z0-9\]\{4\}\)/.test(sh), 'the random-address file also accepts app.<domain>');
    console.log('PASS: short invite links /code= (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
