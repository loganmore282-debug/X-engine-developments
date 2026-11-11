'use strict';
// A member must be able to paste into a text box. The page guard blocks the long-press menu everywhere EXCEPT inside text boxes
// (Android raises the Paste bubble through that same event). Checked on the BUILT app.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'user');
const API = (fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8').match(/API_BASE\s*=\s*'([^']+)'/) || [])[1];
const FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];";
const FB_AUTH = "export const getAuth=()=>({currentUser:null});export const createUserWithEmailAndPassword=async()=>({});export const signInWithEmailAndPassword=async()=>({});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(null),0);return()=>{}};";
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8876, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 411, height: 776 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(API + '/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', settings: {} }) }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/firebase-app\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_APP }));
    await page.route(/firebase-auth\.js/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FB_AUTH }));
    await page.goto('http://127.0.0.1:8876/index.html', { waitUntil: 'commit' }); await page.waitForTimeout(3200);
    const r = await page.evaluate(() => {
      const fire = el => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
      const input = document.getElementById('loginPhone'), ta = document.createElement('textarea'), div = document.createElement('div');
      document.body.append(ta, div);
      return { input: fire(input), textarea: fire(ta), plain: fire(div) };
    });
    ok(r.input === false, 'long-press menu is allowed in a text box');
    ok(r.textarea === false, 'long-press menu is allowed in a multi-line box (the payment message)');
    ok(r.plain === true, 'long-press menu is still blocked on ordinary page content');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: pasting is allowed in text boxes (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
