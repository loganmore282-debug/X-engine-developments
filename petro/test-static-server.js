#!/usr/bin/env node
/**
 * static-server.js -- the host for user/ and admin/ once the platform has no
 * static site type of its own.
 *
 * Render applied these headers from render.yaml, so moving off it turned host
 * configuration into code, and code needs a test. Everything below DRIVES THE
 * REAL SERVER over a real socket rather than reading its source: a header
 * present in the file but never written, or a traversal guard that rejects the
 * shapes curl normalises away while passing the ones it does not, both read
 * fine and fail in production.
 *
 * What it pins, and why each one matters:
 *   1. connect-src follows PETRO_API_ORIGIN. This is the one value that
 *      changes when the backend moves, and getting it wrong is silent -- the
 *      browser blocks every API call and the app shows its own "Network
 *      error" against a perfectly healthy server.
 *   2. The security headers Render used to set are all still set.
 *   3. Nothing outside the served directory can be read. server.js sits one
 *      level up from user/, with the Mongo and Firebase code beside it.
 *   4. Old /refCode= invite links still resolve. Those are out in the world
 *      already and cannot be recalled.
 *   5. index.html / sw.js / manifest.json revalidate, so a phone cannot sit
 *      on a stale build -- this project's most recurring complaint.
 */
'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

const HERE = __dirname;
const API = 'https://test-backend.up.railway.app';

function get(port, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    // `path` is passed through untouched: the traversal cases depend on the
    // server seeing exactly what was written, and a client that normalises
    // first would test nothing.
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function start(which, port) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(HERE, 'static-server.js'), which], {
      env: Object.assign({}, process.env, { PORT: String(port), PETRO_API_ORIGIN: API }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', d => { out += d; if (/on :/.test(out)) resolve(p); });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', c => reject(new Error(`exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error('did not start: ' + out)), 8000);
  });
}

(async () => {
  const PORT_USER = 8913, PORT_ADMIN = 8915;
  const user = await start('user', PORT_USER);
  const admin = await start('admin', PORT_ADMIN);
  try {
    console.log('— the API origin the pages may talk to —');
    const home = await get(PORT_USER, '/index.html');
    ck(home.status === 200, 'the app is served');
    const csp = home.headers['content-security-policy'] || '';
    ck(csp.includes(`connect-src 'self' ${API} `),
       'connect-src names the backend from PETRO_API_ORIGIN, not a baked-in host');
    ck(!csp.includes('onrender.com'),
       '  and carries no leftover origin of its own');
    ck(csp.includes("script-src 'self' 'unsafe-inline'") && !csp.includes('unsafe-eval'),
       "script-src allows the inline bundle but never 'unsafe-eval'");
    ck(/connect-src[^;]*https:\/\/\*\.googleapis\.com/.test(csp),
       'and Firebase Auth can still be reached');

    console.log('\n— every header Render used to set —');
    for (const [h, want] of [
      ['x-frame-options', 'DENY'],
      ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'no-referrer'],
      ['cross-origin-resource-policy', 'same-site'],
    ]) ck(home.headers[h] === want, `${h}: ${home.headers[h]}`);
    ck(/max-age=63072000/.test(home.headers['strict-transport-security'] || ''), 'HSTS is set');
    ck(/camera=\(\)/.test(home.headers['permissions-policy'] || '') &&
       /payment=\(\)/.test(home.headers['permissions-policy'] || ''),
       'Permissions-Policy denies camera and the Payment Request API');

    console.log('\n— nothing outside the served folder —');
    // server.js is one level up from user/, with db.js beside it. These are
    // sent RAW, including the forms a normalising client would rewrite.
    for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js',
                     '/....//server.js', '/../../etc/passwd', '/../db.js',
                     '/..\\server.js', '/%2e%2e%2fserver.js']) {
      const r = await get(PORT_USER, p);
      ck(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
      ck(!/MONGODB_URI|firebase-admin|require\('\.\/db'\)/.test(r.body),
         `  and leaked no source for ${p}`);
    }

    console.log('\n— invite links already out in the world —');
    const invite = await get(PORT_USER, '/refCode=Gy2f');
    ck(invite.status === 200 && /text\/html/.test(invite.headers['content-type'] || ''),
       'an old /refCode= link still serves the app');
    ck(invite.body.includes('<!DOCTYPE html') || invite.body.includes('<!doctype html'),
       '  with the real document, not a redirect stub');
    // Deliberately NOT a blanket /* -> index.html: a service worker or a
    // manifest that ever answers with index.html fails in exactly the way
    // this project's stale-cache problems already look.
    const missing = await get(PORT_USER, '/definitely-not-here.txt');
    ck(missing.status === 404, 'and an unknown path is a plain 404, not the app');
    const sw = await get(PORT_USER, '/sw.js');
    ck(sw.status === 200 && /javascript/.test(sw.headers['content-type'] || ''),
       'sw.js is served as JavaScript, never rewritten to HTML');

    console.log('\n— a phone cannot sit on a stale build —');
    for (const p of ['/index.html', '/sw.js', '/manifest.json']) {
      const r = await get(PORT_USER, p);
      ck(r.headers['cache-control'] === 'no-cache', `${p} revalidates every time`);
    }
    const png = await get(PORT_USER, '/icon-192.png');
    ck(png.status === 200 && /max-age/.test(png.headers['cache-control'] || ''),
       'while artwork may be cached');
    ck(!!home.headers.etag, 'and an ETag is offered');
    const again = await get(PORT_USER, '/index.html', { 'If-None-Match': home.headers.etag });
    ck(again.status === 304, 'so an unchanged build answers 304 with no body');

    console.log('\n— the admin panel —');
    const ap = await get(PORT_ADMIN, '/index.html');
    ck(ap.status === 200, 'the panel is served');
    ck(ap.headers['cache-control'] === 'no-cache',
       'and ALL of it revalidates -- it is one file that moves money');
    ck((ap.headers['content-security-policy'] || '').includes(API),
       'with the same API origin');
    ck(ap.headers['x-frame-options'] === 'DENY',
       'and it can never be framed');

    console.log('\n— methods —');
    ck((await get(PORT_ADMIN, '/index.html', {}, 'POST')).status === 405,
       'a POST to a static host is refused');
    ck((await get(PORT_ADMIN, '/index.html', {}, 'HEAD')).status === 200, 'HEAD works');
  } finally {
    user.kill(); admin.kill();
  }
  console.log(bad ? `\n${bad} FAILED` : '\nstatic-server: all cases pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
