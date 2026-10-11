'use strict';
// Measures where the time goes, from the VPS itself: database round trip (the server's own connection, nothing printed that is secret),
// then the public site (HTTP version, compression, first-byte time). Run: node deploy/speed-check.js [https://app.p-colasoda.com]
const fs = require('fs'), https = require('https'), http2 = require('http2'), zlib = require('zlib');
const SITE = process.argv[2] || 'https://app.p-colasoda.com';
if (!/^https:\/\//.test(SITE)) { console.log('Use an https:// address.'); process.exit(1); }
const SECRETS = process.env.SODA_SECRETS_FILE || '/srv/soda-secrets/secrets.local.js';
const ms = n => (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ms';
const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
(async () => {
  console.log('== Database (Atlas) round trip, as the server sees it');
  try {
    const uri = require(SECRETS).MONGODB_URI;
    const { MongoClient } = require('mongodb');
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    let t = process.hrtime.bigint(); await c.connect();
    console.log('   first connection (TLS + login): ' + ms(Number(process.hrtime.bigint() - t) / 1e6));
    const db = c.db(); const times = [];
    for (let i = 0; i < 15; i++) { t = process.hrtime.bigint(); await db.command({ ping: 1 }); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
    const m = median(times);
    console.log('   one question to the database (median of 15): ' + ms(m));
    console.log('   ' + (m < 15 ? 'GOOD: the database is close to the VPS.' : m < 40 ? 'OK, but each action pays this delay several times.' : 'SLOW: the database is far from the VPS. Moving the Atlas cluster to the same region would speed up every action.'));
    await c.close();
  } catch (e) { console.log('   could not measure: ' + String(e.message).split('\n')[0]); }
  console.log('\n== Public site: ' + SITE);
  const one = (path, headers) => new Promise(resolve => {
    const t0 = process.hrtime.bigint(); const u = new URL(SITE); let settled = false;
    const finish = r => { if (!settled) { settled = true; resolve(r); } };
    const http1 = () => { const r = https.get(SITE + path, { headers: { 'accept-encoding': 'gzip', ...headers } }, res => { const t1 = Number(process.hrtime.bigint() - t0) / 1e6; let n = 0; res.on('data', d => n += d.length); res.on('end', () => finish({ ver: 'HTTP/1.1 (not HTTP/2!)', status: res.statusCode, enc: res.headers['content-encoding'] || 'none', ttfb: t1, bytes: n, cache: res.headers['cache-control'] })); }); r.on('error', e => finish({ err: e.message })); };
    let answered = false;
    const s = http2.connect(u.origin, { rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' });
    const fail = () => { if (answered || settled) return; answered = true; try { s.destroy(); } catch (e) {} http1(); };
    s.on('error', fail);
    const req = s.request({ ':path': path, 'accept-encoding': 'gzip', ...headers }); let t1 = 0, n = 0, h = {};
    req.on('response', hd => { answered = true; t1 = Number(process.hrtime.bigint() - t0) / 1e6; h = hd; });
    req.on('data', d => n += d.length); req.on('end', () => { s.close(); finish({ ver: 'HTTP/2', status: h[':status'], enc: h['content-encoding'] || 'none', ttfb: t1, bytes: n, cache: h['cache-control'] }); });
    req.on('error', fail); req.end();
  });
  for (const [label, path] of [['app page      ', '/'], ['health (API)  ', '/k7x2/health'], ['service worker ', '/sw.js']]) {
    const r = await one(path, {}); if (r.err) { console.log('   ' + label + ' error: ' + r.err); continue; }
    const r2 = await one(path, {});
    console.log(`   ${label} ${r.ver}  status ${r.status}  compressed: ${r.enc}  ${(r.bytes / 1024).toFixed(0)} KB  first byte ${ms(r.ttfb)} (again: ${ms(r2.ttfb)})  cache-control: ${r.cache || '-'}`);
  }
  console.log('\nRead it like this: "first byte" from the VPS itself has no travel time, so it shows only what the server does. Anything above ~50 ms there is server or database time worth fixing.');
})();
