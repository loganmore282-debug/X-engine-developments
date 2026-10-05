// Pulls the REAL origin-matching code out of server.js and exercises it, so
// this tests the shipped logic rather than a paraphrase of it.
const fs = require('fs');
const path = require('path');
// __dirname, not an absolute path: this file is run from a GitHub runner
// as well as from a checkout on someone's machine, and the two are not in
// the same place. A baked-in path made this test pass only in the one
// directory it was written in.
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const consts = src.slice(src.indexOf('const CORS_ALLOWED_ORIGINS'), src.indexOf('app.use(cors({'));
const cb = src.slice(src.indexOf('origin: (origin, cb) =>'), src.indexOf('}));', src.indexOf('origin: (origin, cb) =>')));
const originFn = eval(`(() => { ${consts}\n return function(origin){ let out; const cb=(_e,v)=>{out=v;}; const f = { ${cb} }.origin; f(origin, cb); return out; }; })()`);

// Petro runs entirely on one Hostinger VPS: backend (pm2, :3000) and both
// static frontends (nginx, app./admin. subdomains) on the same box, so
// CORS_ALLOWED_SUFFIXES is empty (no PaaS-generated platform subdomains to
// suffix-match anymore -- see server.js's own comment on that constant).
// Every real origin is therefore a plain, fixed entry in
// CORS_ALLOWED_ORIGINS, plus localhost/127.0.0.1 for local dev, checked
// unconditionally by the real code regardless of the suffix list.
const cases = [
  ['https://petro-platform.com',           true,  'the live app domain'],
  ['https://www.petro-platform.com',       true,  'the live app domain, www'],
  ['http://179.198.197.114:8080',          true,  'direct VPS frontend, port 8080'],
  ['http://179.198.197.114:3000',          false, 'the VPS backend origin itself is not a frontend'],
  ['http://localhost:3000',                true,  'local dev'],
  ['http://127.0.0.1:5173',                true,  'local dev, loopback IP'],
  [undefined,                              true,  'same-origin / no Origin header'],
  ['https://chn-snow2beer.com',            false, "Snow's live site (must NOT reach Petro)"],
  ['https://evil-attacker.com',            false, 'random attacker'],
  ['https://petro-platform.com.evil.test', false, 'suffix-spoofing attacker on the real domain'],
  ['https://notpetro-platform.com',        false, 'lookalike domain'],
  // No PaaS platform suffix should match anything anymore -- these must all
  // be refused now that CORS_ALLOWED_SUFFIXES is empty. If any of these
  // start passing, something re-added a platform suffix that has no
  // business being there on a single fixed VPS.
  ['https://anything.pages.dev',                    false, 'Cloudflare Pages, no longer used'],
  ['https://petro-server.onrender.com',             false, 'Render, no longer used'],
  ['https://petro-app-production.up.railway.app',   false, 'Railway, no longer used'],
  ['https://petro.railway.app',                     false, 'Railway bare domain, no longer used'],
  ['https://petro-app.edgeone.app',                 false, 'EdgeOne, no longer used'],
  ['https://petro-admin.edgeone.dev',               false, 'EdgeOne .dev, no longer used'],
];

let failed = 0;
for (const [origin, expected, label] of cases) {
  const got = originFn(origin);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(origin).padEnd(42)} allowed=${String(got).padEnd(5)} ${label}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall CORS cases pass');
process.exit(failed ? 1 : 0);
