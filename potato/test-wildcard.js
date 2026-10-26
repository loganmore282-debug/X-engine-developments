'use strict';
// Random invite-link addresses: the invite link is https://<4 random characters>.<domain>/#/inviteRegister?invitecode=CODE, new every time; nginx serves every
// such address; the app reads the code from that link; the VPS scripts are wired (Hostinger API for the DNS record and the wildcard certificate).
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), cp = require('node:child_process');
const acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
const fnSrc = n => { const x = tree.body.find(t => t.type === 'FunctionDeclaration' && t.id.name === n); assert(x, 'missing ' + n); return src.slice(x.start, x.end); };
const kit = (domain, host, protocol = 'https:') => {
  const copied = [], els = { '.pt-purl': { textContent: '' } };
  const c = vm.createContext({ STATE: { settings: { shareDomain: domain }, account: { referralCode: '2k3ct' }, teamStats: {} }, location: { hostname: host, protocol, origin: protocol + '//' + host },
    window: { crypto: globalThis.crypto }, Uint32Array, Math, String, encodeURIComponent, document: { querySelector: q => els[q] || null }, writeClipboard: t => copied.push(t),
    notify: () => {}, rapidTapGuardOk: () => true });
  vm.runInContext('var SHARE_LABEL_RESERVED = ' + /var SHARE_LABEL_RESERVED = (\[.*?\]);/.exec(src)[1] + ';\nvar _promoLink = "x";\n' + ['shareRand', 'shareLabel', 'shareOrigin', 'promoLink', 'refreshPromoLink'].map(fnSrc).join('\n') +
    '\n' + /window\.copyPromoLink = function[\s\S]*?\n\};/.exec(src)[0], c);
  return { c, copied, els };
};
// each link is on a new random address of the domain, exactly 4 characters, the exact link shape the owner wants
let { c, copied, els } = kit('mydomain.com', 'app.mydomain.com');
const seen = new Set();
for (let i = 0; i < 40; i++) {
  const link = c.promoLink();
  const m = /^https:\/\/([a-z][a-z0-9]{3})\.mydomain\.com\/#\/inviteRegister\?invitecode=2K3CT$/.exec(link);
  assert.ok(m, 'link shape: ' + link); assert.ok(!['mail', 'smtp', 'host'].includes(m[1])); seen.add(m[1]);
}
assert.ok(seen.size >= 36, 'the address changes every time (' + seen.size + ' different in 40)');
// Copy makes a fresh one, shows it and copies the very same text
c.window.copyPromoLink(null); c.window.copyPromoLink(null);
assert.equal(copied.length, 2); assert.notEqual(copied[0], copied[1], 'two copies, two addresses'); assert.equal(els['.pt-purl'].textContent, copied[1], 'the page shows what was copied');
// without the setting, or on another address (the IP preview, http), the link keeps the address the app is open on
assert.equal(kit('', 'app.mydomain.com').c.shareOrigin(), 'https://app.mydomain.com');
assert.equal(kit('mydomain.com', '179.198.197.114', 'http:').c.shareOrigin(), 'http://179.198.197.114');
assert.equal(kit('mydomain.com', 'other.org').c.shareOrigin(), 'https://other.org');
assert.equal(kit('', '179.198.197.114', 'http:').c.promoLink(), 'http://179.198.197.114/#/inviteRegister?invitecode=2K3CT');
// the app reads the code from that link (and from the older forms)
{ const code = fnSrc('captureReferralFromUrl');
  const read = (search, hash, pathname = '/') => { const box = { v: '', tab: '' };
    const ctx = vm.createContext({ location: { search, hash, pathname }, URLSearchParams, STATE: {}, $: () => box, showAuthTab: t => { box.tab = t; }, decodeURIComponent, RegExp });
    vm.runInContext(code + '\ncaptureReferralFromUrl();', ctx); return { ref: ctx.STATE.refCode, tab: box.tab, field: box.value }; };
  assert.equal(read('', '#/inviteRegister?invitecode=2K3CT').ref, '2K3CT'); assert.equal(read('', '#/inviteRegister?invitecode=2K3CT').tab, 'register');
  assert.equal(read('', '#/inviteRegister?inviteCode=2K3CT').ref, '2K3CT');
  assert.equal(read('?ref=ABCDE', '').ref, 'ABCDE'); assert.equal(read('?v=1&code=ABCDE', '').ref, 'ABCDE'); assert.equal(read('', '').ref, undefined); }
// the server publishes the domain, from the secret SHARE_DOMAIN, and lets its random addresses reach the API
assert.ok(/shareDomain: SHARE_DOMAIN/.test(server) && /process\.env\.SHARE_DOMAIN/.test(server) && /SHARE_DOMAIN \? \[SHARE_DOMAIN\]/.test(server), 'the server publishes shareDomain and allows its subdomains');
// nginx: a wildcard block with its own certificate; named addresses are untouched; no wildcard without the flag
const gen = args => cp.execFileSync('node', [__dirname + '/deploy/make-nginx.js', ...args], { encoding: 'utf8' });
const w = gen(['prod', 'app.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com']);
assert.ok(/server_name \*\.mydomain\.com;[\s\S]*?return 308 https:\/\/\$host\$request_uri/.test(w), 'http goes to https');
assert.ok(/listen 443 ssl http2;[\s\S]*?ssl_certificate \/etc\/letsencrypt\/live\/potato-wild\/fullchain\.pem;[\s\S]*?server_name \*\.mydomain\.com;/.test(w), 'https block with the wildcard certificate');
assert.ok(/server_name app\.mydomain\.com;/.test(w) && /server_name a1b2c3\.mydomain\.com;/.test(w), 'named hosts stay');
const wildOnly = gen(['prod', 'app.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com', '--wild-only']);
assert.ok(!/server_name app\.mydomain\.com;/.test(wildOnly) && /server_name \*\.mydomain\.com;/.test(wildOnly) && /^# Generated/.test(wildOnly), '--wild-only prints the random-address blocks alone');
assert.ok(/location = \/ \{[\s\S]*?try_files \$potato_bot_html \/index\.html/.test(wildOnly), 'the app page is served on a random address');
assert.ok(!/\*\.mydomain/.test(gen(['prod', 'app.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com'])), 'no wildcard unless asked');
assert.throws(() => gen(['dev', 'Tq5m8zr', '--wild=mydomain.com']), 'wildcard is for prod only');
// the VPS scripts: valid shell, wired together
for (const f of ['set-wildcard.sh', 'update-vps.sh', 'quick-update.sh', 'show-links.sh', 'set-domain.sh']) cp.execFileSync('bash', ['-n', __dirname + '/deploy/' + f]);
const upd = fs.readFileSync(__dirname + '/deploy/update-vps.sh', 'utf8'), sw = fs.readFileSync(__dirname + '/deploy/set-wildcard.sh', 'utf8');
assert.ok(/--wild="\$WILD_DOMAIN" --wild-only/.test(upd) && /rm -f "\$WILD_CONF"/.test(upd), 'the wildcard file is taken away before certbot runs and written after');
assert.ok(/WILD_CERT_DIR\/fullchain\.pem/.test(upd), 'update-vps.sh adds the wildcard only when its certificate exists');
assert.ok(/--cert-name potato-wild/.test(sw) && /hostinger-dns\.js/.test(sw) && /--manual-auth-hook/.test(sw) && /SHARE_DOMAIN/.test(sw) && /set-domain\.sh/.test(sw) && /\*\.\$DOM/.test(sw), 'set-wildcard.sh: DNS record, wildcard certificate, SHARE_DOMAIN, nginx');
console.log('PASS: random invite addresses (new every time, wildcard nginx + certificate, scripts)');

// Hostinger DNS helper, against a fake of Hostinger's API: it changes ONE name+type per call and sends the token as a Bearer header
(async () => {
  const http = require('node:http'), seenReq = [];
  const api = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d).on('end', () => { seenReq.push({ m: req.method, u: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.method === 'GET' ? '[{"name":"@"}]' : '{}'); }); });
  await new Promise(r => api.listen(0, r));
  const env = { ...process.env, HOSTINGER_API: 'http://127.0.0.1:' + api.address().port, HOSTINGER_API_TOKEN: 'tok123', POTATO_HOSTINGER_TOKEN_FILE: '/nonexistent' };
  const run = (args, extra = {}) => new Promise(res => cp.execFile('node', [__dirname + '/deploy/hostinger-dns.js', ...args], { env: { ...env, ...extra }, encoding: 'utf8' }, (err, stdout, stderr) => res({ status: err ? (err.code || 1) : 0, stdout, stderr })));
  assert.match((await run(['check', 'mydomain.com'])).stdout, /^ok: 1 records/);
  assert.equal((await run(['wild-a', 'mydomain.com', '203.0.113.7'])).status, 0);
  assert.equal((await run(['cleanup'], { CERTBOT_DOMAIN: 'mydomain.com' })).status, 0);
  assert.notEqual((await run(['wild-a', 'mydomain.com', 'not-an-ip'])).status, 0, 'a bad address is refused');
  assert.deepEqual(seenReq.map(r => r.m + ' ' + r.u), ['GET /api/dns/v1/zones/mydomain.com', 'PUT /api/dns/v1/zones/mydomain.com', 'DELETE /api/dns/v1/zones/mydomain.com']);
  assert.ok(seenReq.every(r => r.auth === 'Bearer tok123'), 'token sent as Bearer');
  assert.deepEqual(seenReq[1].body, { overwrite: true, zone: [{ name: '*', type: 'A', ttl: 300, records: [{ content: '203.0.113.7' }] }] }, 'the wildcard record, nothing else');
  assert.deepEqual(seenReq[2].body, { filters: [{ name: '_acme-challenge', type: 'TXT' }] }, 'cleanup removes only the challenge record');
  api.close();
  console.log('PASS: Hostinger DNS helper (one record per call, Bearer token)');
})().catch(e => { console.error(e); process.exit(1); });
