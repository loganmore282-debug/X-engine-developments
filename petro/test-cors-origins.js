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

const cases = [
  ['https://chipz-app.edgeone.app',        true,  'EdgeOne user panel'],
  ['https://chipz-admin.edgeone.site',     true,  'EdgeOne admin panel'],
  // The real one that broke: the owner's admin panel landed on .edgeone.dev,
  // which was missing from the list, and the login reported "Network error"
  // on a healthy backend.
  ['https://chipz-admin.edgeone.dev',      true,  'EdgeOne admin panel on .edgeone.dev'],
  ['https://chipz-app.edgeone.dev',        true,  'EdgeOne user panel on .edgeone.dev'],
  ['https://edgeone.dev.evil.com',         false, 'suffix-spoofing attacker on .edgeone.dev'],
  ['https://anything.pages.dev',           true,  'Cloudflare Pages'],
  ['https://chipz-server.onrender.com',    true,  'Render'],
  // Railway, after Render suspended the account. A platform host missing from
  // the suffix list is refused by CORS, and the browser reports that to the
  // app as nothing at all -- this project has already lost time to exactly
  // that twice (Snow's custom domain, and .edgeone.dev).
  ['https://chipz-app-production.up.railway.app',   true,  'Railway user panel'],
  ['https://chipz-admin-production.up.railway.app', true,  'Railway admin panel'],
  ['https://chipz.railway.app',                     true,  'Railway on the bare domain'],
  ['https://up.railway.app.evil.test',              false, 'suffix-spoofing attacker on .up.railway.app'],
  ['https://railway.app.evil.test',                 false, 'suffix-spoofing attacker on .railway.app'],
  ['https://notrailway.app',                        false, 'a lookalike domain is not Railway'],
  ['http://localhost:3000',                true,  'local dev'],
  ['https://chipz-platform.com',           true,  'future custom domain'],
  [undefined,                              true,  'same-origin / no Origin header'],
  ['https://chn-snow2beer.com',            false, "Snow's live site (must NOT reach Chipz)"],
  ['https://evil-attacker.com',            false, 'random attacker'],
  ['https://edgeone.app.evil.com',         false, 'suffix-spoofing attacker'],
  ['https://notedgeone.app',               false, 'lookalike domain'],
];

let failed = 0;
for (const [origin, expected, label] of cases) {
  const got = originFn(origin);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(origin).padEnd(38)} allowed=${String(got).padEnd(5)} ${label}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall CORS cases pass');
process.exit(failed ? 1 : 0);
