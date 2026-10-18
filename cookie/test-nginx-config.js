'use strict';
// The generated nginx files must be ACCEPTED by nginx (a refused file leaves the live site on the old one). Runs `nginx -t` when nginx is installed;
// the brace rule below is checked everywhere: a regex with {8,14} must be quoted, or nginx reads the brace as the start of a block.
const cp = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const gen = (args, env = {}) => cp.execFileSync('node', [__dirname + '/deploy/make-nginx.js', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const variants = {
  dev: ['dev', 'Bake7qz3'],
  prod: ['prod', 'app.example.org', 'Bake7qz3', 'a1b2c3.example.org'],
  'prod+also': ['prod', 'app.example.org', 'Bake7qz3', 'a1b2c3.example.org', '--also=go'],
  'prod+wild': ['prod', 'app.example.org', 'Bake7qz3', 'a1b2c3.example.org', '--wild=example.org'],
};
for (const [name, args] of Object.entries(variants)) {
  const out = gen(args);
  for (const line of out.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    assert.ok(!/(^|[\s~*])[^"'\s]*\{\d+(,\d*)?\}/.test(line.replace(/"[^"]*"/g, '""')), name + ': an unquoted {n,m} in nginx config: ' + line.trim());
  }
}
let nginx = ''; try { nginx = cp.execFileSync('which', ['nginx'], { encoding: 'utf8' }).trim(); } catch (_) {}
if (!nginx) { console.log('PASS: nginx files have no unquoted braces (nginx itself not installed here, so nginx -t was skipped)'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngx-')), cert = path.join(dir, 'cert'); fs.mkdirSync(cert);
cp.execFileSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '2', '-subj', '/CN=x', '-keyout', cert + '/privkey.pem', '-out', cert + '/fullchain.pem'], { stdio: 'ignore' });
for (const [name, args] of Object.entries(variants)) {
  // this sandbox may have no IPv6; the IPv6 listen lines are the only thing taken out for the test
  const site = gen(args, { COOKIE_WILD_CERT_DIR: cert }).replace(/^\s*listen \[::\][^\n]*\n/gm, '');
  fs.writeFileSync(dir + '/site.conf', site);
  fs.writeFileSync(dir + '/main.conf', `pid ${dir}/n.pid;\nerror_log ${dir}/err.log;\nevents {}\nhttp {\n access_log off;\n include ${dir}/site.conf;\n}\n`);
  const r = cp.spawnSync(nginx, ['-t', '-c', dir + '/main.conf'], { encoding: 'utf8' });
  assert.equal(r.status, 0, name + ': nginx refused the file:\n' + r.stderr);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS: nginx accepts every generated file (dev, prod, extra address, wildcard)');
