'use strict';
// Admin panel language: French by default (laid over the English source), English one tap away, and back. Opens every tab in a real browser
// with a stubbed server and FAILS if any visible text is still an English sentence in French mode, or any French shows in English mode.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'admin');
const EMPTY = { status: 'success', token: 'tok', username: 'owner', role: 'owner', settings: {}, users: [], deposits: [], withdrawals: [], products: [], transactions: [], messages: [], codes: [], promocodes: [], admins: [], logs: [], entries: [], referrals: [], numbers: [], payNumbers: [], channels: [], stats: {}, count: 0, total: 0 };
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); });
const EN = /(?<![\p{L}])(the|and|your|you|with|from|this|that|have|will|are|was|can|not|please|could|no|none|enter|save|saved|cancel|delete|remove|failed|loading|search|users|deposits|withdrawals|settings|members|member|amount|status|date|picture|banner|link|page|message|messages|password|code|codes|total|time|upload|choose|select|approve|reject|pending|paid|credit|debit|balance|wallet|phone|name|reason|yes|no|on|off|of|for|in|to|by|at|an|a|is|it|or)(?![\p{L}])/iu;
const KEEP = /Potato|Wave|FCFA|XOF|VIP|PIN|QR|APK|SMS|OTP|HTML|URL|ID|Google|Authenticator|Telegram|WhatsApp|Firebase|Admin|Local|Code|Message|Messages|Transactions|Recharge|Commission|Total|Type|Action|Date|Position|Net|Destination|Description|Commissions|Codes|Support|Service|Canal|Banners|Admins|Position|Page|Version|Source|Statut|Logo|Position|Menu|Photo|Email|Notifications?|Notify|Push|Live|Backup|Dashboard|Analytics|Sync|[A-Z]{2,}|\d[\d.,:/ -]*/g;
const FRENCH = /[àâçéèêëîïôûùüœÀÂÇÉÈÊËÎÏÔÛÙÜŒ]|(?<![\p{L}])(le|la|les|des|du|votre|vos|pour|avec|une|est|pas|sur|dans|vous|nous|utilisateurs|retraits|dépôts|paramètres|membres|mot de passe|annuler|enregistrer|supprimer)(?![\p{L}])/iu;
srv.listen(8868, async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const ok = (c, m) => { n++; if (!c) errs.push(m); };
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 150)));
  await page.route('**/k7x2/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const visible = () => page.evaluate(() => { const out = new Set(); const vis = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const st = getComputedStyle(n); if (st.display === 'none' || st.visibility === 'hidden') return false; } return true; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) || p.closest('[data-no-i18n]') || !vis(p)) continue; const t = n.data.replace(/\s+/g, ' ').trim(); if (t) out.add(t); }
    for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) { if (el.closest('[data-no-i18n]') || !vis(el)) continue; for (const a of ['placeholder', 'title', 'aria-label']) { const t = (el.getAttribute(a) || '').trim(); if (t) out.add('@' + t); } }
    return [...out]; });
  const FRM = /[àâçéèêëîïôûùüœÀÂÇÉÈÊËÎÏÔÛÙÜŒ]|(?<![\p{L}])(le|la|les|des|du|de|votre|vos|pour|avec|une|est|pas|sur|dans|vous|nous|sont|aux|ne|que|qui|ce|cette|ces|ou|et|au|en|un|par)(?![\p{L}])/iu;
const leftoverEn = list => list.filter(t => { const x = t.replace(KEEP, ' '); return EN.test(x) && !FRM.test(x); });
  await page.goto('http://127.0.0.1:8868/index.html'); await page.waitForTimeout(1800);
  // 1. French by default, the pill turns it English and back
  ok(await page.evaluate(() => document.documentElement.lang) === 'fr', 'html lang is fr by default');
  const loginFr = await visible(); ok(loginFr.some(t => /Se connecter|Connexion/i.test(t)), 'the sign-in screen is French by default: ' + loginFr.join(' | ').slice(0, 200));
  ok(await page.evaluate(() => !!document.querySelector('#loginView .adm-lang button[data-l="fr"].on')), 'the FR side of the pill is lit');
  await page.click('#loginView .adm-lang button[data-l="en"]'); await page.waitForTimeout(500);
  const loginEn = await visible(); ok(loginEn.some(t => /Sign in/.test(t)) && !loginEn.some(t => FRENCH.test(t.replace(KEEP, ' '))), 'EN pill: the sign-in screen is English: ' + loginEn.join(' | ').slice(0, 200));
  ok(await page.evaluate(() => localStorage.getItem('potato_admin_lang')) === 'en', 'the choice is kept');
  await page.click('#loginView .adm-lang button[data-l="fr"]'); await page.waitForTimeout(500);
  ok((await visible()).some(t => /Se connecter|Connexion/i.test(t)), 'FR pill: back to French');
  // 2. signed in: every tab, French
  await page.fill('#keyInput', 'k'); await page.click('#loginBtn'); await page.waitForTimeout(2500);
  const tabs = await page.$$eval('.tab[data-tab]', els => els.map(e => e.dataset.tab));
  ok(tabs.length >= 12, 'tabs found: ' + tabs.length);
  const frSeen = new Map(); const bad = [];
  const collect = async label => { for (const t of leftoverEn(await visible())) if (!frSeen.has(t)) { frSeen.set(t, label); bad.push(label + ': ' + t.slice(0, 120)); } };
  await collect('shell');
  for (const t of tabs) { try { await page.evaluate(id => { const el = document.querySelector('.tab[data-tab="' + id + '"]'); el.classList.remove('hidden'); el.click(); }, t); } catch (e) { errs.push('tab ' + t + ' ' + e.message.slice(0, 60)); } await page.waitForTimeout(900); await collect(t); }
  ok(bad.length === 0, 'English left in French mode (' + bad.length + '):\n    ' + bad.slice(0, 60).join('\n    '));
  // 3. English again: no French; then back to French
  await page.click('.topbar .adm-lang button[data-l="en"]'); await page.waitForTimeout(700);
  const frenchBits = []; for (const t of tabs) { await page.evaluate(id => { const el = document.querySelector('.tab[data-tab="' + id + '"]'); el.click(); }, t); await page.waitForTimeout(700); for (const x of await visible()) if (FRENCH.test(x.replace(KEEP, ' '))) frenchBits.push(t + ': ' + x.slice(0, 100)); }
  ok(frenchBits.length === 0, 'French left in English mode:\n    ' + [...new Set(frenchBits)].slice(0, 30).join('\n    '));
  await page.click('.topbar .adm-lang button[data-l="fr"]'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.documentElement.lang) === 'fr', 'back to French');
  // 4. a browser that chose English opens in English
  const visibleOf = pg => pg.evaluate(() => [...document.querySelectorAll('.tab')].map(e => e.textContent.trim()));
  const p2 = await ctx.newPage(); await p2.route('**/k7x2/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }));
  await p2.addInitScript("try{localStorage.setItem('potato_admin_lang','en')}catch(e){}"); await p2.goto('http://127.0.0.1:8868/index.html'); await p2.waitForTimeout(1200);
  ok(await p2.evaluate(() => document.documentElement.lang) === 'en' && (await visibleOf(p2)).some(t => /^Deposits$/.test(t)) && !(await visibleOf(p2)).some(t => /^Dépôts$/.test(t)), 'stored English: the panel opens in English');
  await b.close(); srv.close();
  if (errs.length) { console.log('FAIL (' + errs.length + '):'); errs.forEach(e => console.log('  ' + e)); process.exit(1); }
  console.log('PASS: admin language (' + n + ' checks): French by default, EN/FR pills, every tab French, English clean, choice kept'); process.exit(0);
});
