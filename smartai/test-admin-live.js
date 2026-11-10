'use strict';
// Admin panel real-time (owner: "improve live check speed in admin panel just like the user app") and plain "Loading..." loaders.
// Built panel in a real browser, server stubbed: the panel asks /admin/live every second; the open tab reloads within about a second
// of a change to a collection it shows, and does NOT reload while nothing changes. Loaders are the words "Loading..." with no animation.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
// ── server: /admin/live answers from memory, write counters raised by db.js ──
const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), dbsrc = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
ok(/app\.get\('\/admin\/live', \(req, res\) => \{/.test(srv) && /writeVersions\(ADMIN_LIVE_COLLECTIONS\)/.test(srv), 'the server has /admin/live and it reads no database');
ok(!/'adminSessions'|'memberSessions'/.test(srv.slice(srv.indexOf('const ADMIN_LIVE_COLLECTIONS'), srv.indexOf("app.get('/admin/live'"))), 'session collections (touched by every request) are not watched');
ok((dbsrc.match(/bumpWrite\(this\._col\)/g) || []).length >= 6 && /module\.exports = \{[^}]*writeVersions/.test(dbsrc), 'every write path in db.js raises its collection counter');
ok(/req\.path === '\/live' \? adminLiveLimiter/.test(srv), 'the one-second check has its own rate allowance');
const s2 = fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8');
ok(!/cm-spinner|cmSpin/.test(s2) && /function spinnerHtml\(\)\{ return '<div class="ld-dots"/.test(s2) && /function dlCircles/.test(s2) && /svg\.dl circle\{fill:#137aef/.test(s2), 'the loader is the same blue dots loader as the member app');
ok(/function btnBusyHtml\(text\)\{ return '<span class="verify-spin"[^\n]*\+esc\(text\); \}/.test(s2), 'busy buttons are unchanged: their small turning icon and their own word (Removing..., Crediting...)');
// ── browser ──
let live = { boot: 'b1', v: { pendingDeposits: 1, withdrawals: 1, users: 1 } }, depCalls = 0, liveCalls = 0, holdDeps = false;
const DEPS = [{ id: 'd1', status: 'pending', amount: 5000, method: 'manual', userId: 'u1', phone: '+2348012345678', createdAt: '2026-11-05T10:00:00Z' }];
const server = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8879, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**/k7x2/**', async route => {
      const p = new URL(route.request().url()).pathname.replace(/^\/k7x2/, '');
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'a'.repeat(64), username: 'owner', role: 'owner' });
      if (p === '/admin/live') { liveCalls++; return send({ status: 'success', ...live }); }
      if (p === '/admin/deposits/list') { depCalls++; if (holdDeps) await new Promise(x => setTimeout(x, 1500)); return send({ status: 'success', deposits: DEPS, counts: {}, processedByDay: [], processedAmount: 0 }); }
      return send({ status: 'success', settings: {}, users: [], counts: {}, transactions: [], stats: {}, pendingWithdrawals: 0, deposits: [], withdrawals: [] });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8879/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn'); await page.waitForSelector('#shell:not(.hidden)');
    // the loader while a tab is loading: the same moving dots as the member app
    holdDeps = true;
    await page.click('[data-tab="deposits"]'); await page.waitForTimeout(300);
    const loading = await page.evaluate(async () => { const svg = document.querySelector('#content svg.dl'); if (!svg) return null; const a = [...svg.children].map(c => c.getAttribute('cx')).join(); await new Promise(r => setTimeout(r, 160)); const b = [...svg.children].map(c => c.getAttribute('cx')).join(); return { n: svg.children.length, moves: a !== b, fill: getComputedStyle(svg.children[0]).fill, w: Math.round(svg.getBoundingClientRect().width) }; });
    ok(loading && loading.n === 12 && loading.moves && loading.fill === 'rgb(19, 122, 239)' && loading.w >= 60, 'a tab that is loading shows the blue dots loader and it moves: ' + JSON.stringify(loading));
    holdDeps = false; await page.waitForTimeout(1800);
    // nothing changes for 3 seconds: the list is not reloaded
    const before = depCalls, liveBefore = liveCalls;
    await page.waitForTimeout(3000);
    ok(liveCalls - liveBefore >= 2, 'the panel asks for changes about every second (' + (liveCalls - liveBefore) + ' asks in 3 s)');
    ok(depCalls === before, 'with nothing changed the deposits list is not reloaded (' + (depCalls - before) + ' reloads)');
    // a new recharge arrives: the list reloads within about a second
    live = { boot: 'b1', v: { ...live.v, pendingDeposits: 2 } };
    const t0 = Date.now(), c0 = depCalls;
    while (depCalls === c0 && Date.now() - t0 < 4000) await page.waitForTimeout(50);
    const took = Date.now() - t0;
    ok(depCalls > c0 && took <= 2200, 'a change to recharges reloads the Recharges tab in ' + took + ' ms');
    // a change to something the tab does not show does not reload it
    const c1 = depCalls; live = { boot: 'b1', v: { ...live.v, users: 5 } }; await page.waitForTimeout(2500);
    ok(depCalls === c1, 'a change elsewhere (members) does not reload the Recharges tab');
    // a server restart (new boot id) counts as a change
    const c2 = depCalls; live = { boot: 'b2', v: { pendingDeposits: 0, withdrawals: 0, users: 0 } };
    const t1 = Date.now(); while (depCalls === c2 && Date.now() - t1 < 4000) await page.waitForTimeout(50);
    ok(depCalls > c2, 'after a server restart the tab is refreshed once');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin real-time (one-second change check) and blue dots loader (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); server.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
