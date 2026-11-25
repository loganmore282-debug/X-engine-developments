'use strict';
// deploy/setup-domain.sh: asks for the domain (and remembers it), calls set-domain.sh with the cleaned domain and the app name (default ug), and stops with a clear message when the DNS is not ready.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const real = fs.readFileSync(__dirname + '/deploy/setup-domain.sh', 'utf8');
ok(/Type your domain/.test(real) && /\[ug\]/.test(real), 'the command asks "Type your domain" and defaults the app name to ug');
const run = (input, setDomainExit) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')), sec = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-sec-'));
  fs.writeFileSync(dir + '/setup-domain.sh', real); fs.writeFileSync(dir + '/quick-update.sh', 'echo "(quick update ran)"\n');
  fs.writeFileSync(dir + '/set-domain.sh', 'echo "SET-DOMAIN ARGS: $1 $2"\nexit ' + setDomainExit + '\n');
  fs.writeFileSync(dir + '/show-links.sh', 'echo "LINKS $1"\n');
  const r = cp.spawnSync('bash', [dir + '/setup-domain.sh'], { input, encoding: 'utf8', env: Object.assign({}, process.env, { PERSONALCARE_SECRETS_DIR: sec }) });
  return { out: r.stdout + r.stderr, code: r.status, sec };
};
if (process.getuid && process.getuid() === 0) {
  let r = run('My-Domain.COM\n\n\nn\n', 0);
  ok(/SET-DOMAIN ARGS: my-domain\.com ug/.test(r.out) && /quick update ran/.test(r.out) && /All done\./.test(r.out) && r.code === 0, 'a typed domain is cleaned (lower case) and passed with the app name ug');
  ok(fs.readFileSync(r.sec + '/last-domain', 'utf8') === 'my-domain.com', 'the domain is remembered');
  ok(!/LINKS/.test(r.out), 'the private webhook details are shown only when asked for');
  r = run('https://www.shop.co.ug/\nhome\n\ny\n', 0);
  ok(/SET-DOMAIN ARGS: shop\.co\.ug home/.test(r.out) && /LINKS pesajet/.test(r.out) && /LINKS github/.test(r.out), 'a pasted address (https, www, slash) is reduced to the domain; another app name is used; y shows the webhook details');
  r = run('shop.com\n\n\n', 1);
  ok(r.code === 1 && /Nothing is finished yet/.test(r.out) && /run this same command again/.test(r.out) && !/All done/.test(r.out), 'when set-domain stops (DNS not ready) it says so and how to run it again');
  // second run: the remembered domain is offered, Enter accepts it
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')); fs.writeFileSync(dir2 + '/setup-domain.sh', real); fs.writeFileSync(dir2 + '/quick-update.sh', 'echo q\n'); fs.writeFileSync(dir2 + '/set-domain.sh', 'echo "ARGS: $1 $2"\n'); fs.writeFileSync(dir2 + '/show-links.sh', 'echo L\n');
  const sec2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-sec-')); fs.writeFileSync(sec2 + '/last-domain', 'kept.com');
  const r3 = cp.spawnSync('bash', [dir2 + '/setup-domain.sh'], { input: '\n\n\nn\n', encoding: 'utf8', env: Object.assign({}, process.env, { PERSONALCARE_SECRETS_DIR: sec2 }) });
  ok(/Type your domain \[\$LAST\]/.test(real) && /ARGS: kept\.com ug/.test(r3.stdout), 'run again: it offers the remembered domain and Enter accepts it');
} else console.log('(not root: the behavioural part is skipped)');
console.log(`PASS: setup-domain command (${n} checks)`);
