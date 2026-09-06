// Pulls the REAL origin-matching code out of server.js and exercises it, so
// this tests the shipped logic rather than a paraphrase of it.
const fs = require('fs');
const src = fs.readFileSync('/home/user/X-engine-developments/chipz/server.js', 'utf8');

const consts = src.slice(src.indexOf('const CORS_ALLOWED_ORIGINS'), src.indexOf('app.use(cors({'));
const cb = src.slice(src.indexOf('origin: (origin, cb) =>'), src.indexOf('}));', src.indexOf('origin: (origin, cb) =>')));
const originFn = eval(`(() => { ${consts}\n return function(origin){ let out; const cb=(_e,v)=>{out=v;}; const f = { ${cb} }.origin; f(origin, cb); return out; }; })()`);

const cases = [
  ['https://chipz-app.edgeone.app',        true,  'EdgeOne user panel'],
  ['https://chipz-admin.edgeone.site',     true,  'EdgeOne admin panel'],
  ['https://anything.pages.dev',           true,  'Cloudflare Pages'],
  ['https://chipz-server.onrender.com',    true,  'Render'],
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
