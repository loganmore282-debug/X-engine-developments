#!/usr/bin/env node
/**
 * The static host for user/ and admin/, for platforms that have no static
 * site type of their own.
 *
 * WHY THIS EXISTS. Render served `chipz/user` and `chipz/admin` as static
 * sites and applied their security headers from render.yaml. Railway (and
 * most PaaS) has no equivalent: a service is a process. So the headers that
 * were host configuration become code, and this file is where they live.
 *
 * ZERO DEPENDENCIES on purpose. These two services exist to hand over one
 * HTML file each; an npm tree is install time, a lockfile to keep current and
 * a supply chain, in exchange for nothing. Node's own http/fs/path do it.
 *
 * Run:  node static-server.js user     (or: admin)
 *
 * PORT comes from the platform. CHIPZ_API_ORIGIN is the backend the pages are
 * allowed to talk to -- it is the one value that changes when the backend
 * moves, and getting it wrong is silent: the browser blocks every API call
 * and the app shows its own "Network error" with a perfectly healthy server
 * on the other end.
 *
 * NOTE the meta CSP. user/index.html and admin/index.html each carry their
 * own <meta http-equiv="Content-Security-Policy">, and a document must
 * satisfy BOTH it and this header -- they intersect, they do not override.
 * So changing the backend here is not enough on its own; set-backend-url.js
 * rewrites the meta tags to match. This header is the half that survives
 * being uploaded to a different host, the meta is the half that survives
 * being served by one that sets no headers at all.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const WHICH = (process.argv[2] || '').replace(/[^a-z]/gi, '');
if (WHICH !== 'user' && WHICH !== 'admin') {
  console.error('usage: node static-server.js user|admin');
  process.exit(1);
}
const ROOT = path.join(__dirname, WHICH);
const PORT = Number(process.env.PORT) || 8080;
const API_ORIGIN = (process.env.CHIPZ_API_ORIGIN || 'https://chipz-server.onrender.com')
  .trim().replace(/\/+$/, '');

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  // Refuse to start rather than serve 404s that look like a broken deploy.
  console.error(`FATAL: ${path.join(ROOT, 'index.html')} does not exist. ` +
                'Is the service\'s root directory set to the chipz/ folder?');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

// The header set render.yaml applied, kept line for line so a reader can
// compare the two. Every comment explaining WHY a directive is shaped the way
// it is lives in render.yaml and in CLAUDE.md's hardening round; the short
// version is that connect-src is the point of the policy -- it is what stops
// injected script posting a member's balance or trade password to a server
// the attacker owns.
//
// 'unsafe-inline' in script-src is unavoidable: the whole app is one inline
// bundle whose content changes every build, so no hash can cover it.
// 'unsafe-eval' is deliberately absent.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  `connect-src 'self' ${API_ORIGIN} https://*.googleapis.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const BASE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': CSP,
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-site',
};

// no-cache means "revalidate every time", NOT "never store" -- an unchanged
// build still answers 304 while a new one is picked up immediately, which is
// the whole point: this project's recurring complaint is phones sitting on a
// stale build. The admin panel is entirely one file, so all of it revalidates.
const REVALIDATE = WHICH === 'admin'
  ? () => true
  : p => p === '/index.html' || p === '/sw.js' || p === '/manifest.json';

function send(res, status, headers, body, method) {
  res.writeHead(status, Object.assign({}, BASE_HEADERS, headers));
  if (method === 'HEAD' || body == null) return res.end();
  res.end(body);
}

const server = http.createServer((req, res) => {
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
                'Method Not Allowed', method);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (_) {
    return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request', method);
  }

  // Invite links. Referral links used to be shared as <origin>/refCode=<code>,
  // which is a real URL PATH, so without this every invite already sent to a
  // real person 404s. New links are <origin>/?ref=<code> and need no rule at
  // all (Round 158) -- this stays for the ones that are out in the world
  // already, and it is deliberately scoped to that exact prefix rather than a
  // blanket /* -> index.html, which sitting in front of sw.js and the
  // manifest is a real hazard.
  if (pathname.startsWith('/refCode=')) pathname = '/index.html';
  if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

  // Traversal. path.join can climb out of ROOT with enough ../ -- resolve
  // first, then require the result to still be inside it. Checking the URL
  // for '..' instead would miss encoded and doubled-up forms.
  const full = path.resolve(ROOT, '.' + pathname);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden', method);
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found', method);
    }
    const ext = path.extname(full).toLowerCase();
    // A weak ETag from size+mtime: enough for a 304, and it costs no read.
    const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      ETag: etag,
      'Cache-Control': REVALIDATE(pathname)
        ? 'no-cache'
        : 'public, max-age=3600, must-revalidate',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, Object.assign({}, BASE_HEADERS, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }));
      return res.end();
    }
    if (method === 'HEAD') return send(res, 200, headers, null, method);
    res.writeHead(200, Object.assign({}, BASE_HEADERS, headers));
    fs.createReadStream(full)
      .on('error', () => res.destroy())
      .pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`chipz static (${WHICH}) on :${PORT} — API origin ${API_ORIGIN}`);
});

module.exports = { CSP, BASE_HEADERS, TYPES, REVALIDATE, server };
