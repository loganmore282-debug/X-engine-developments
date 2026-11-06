'use strict';
// The "app." address is gone: the member address is a random 4-character word, the old one can be replaced and dropped, and its DNS record removed safely.
const fs = require('node:fs'), cp = require('node:child_process'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const sd = fs.readFileSync(__dirname + '/deploy/set-domain.sh', 'utf8'), ch = fs.readFileSync(__dirname + '/deploy/change-app-host.sh', 'utf8');
for (const f of ['set-domain.sh', 'change-app-host.sh']) ok(cp.spawnSync('bash', ['-n', __dirname + '/deploy/' + f]).status === 0, f + ' is valid shell');
ok(!/LABEL=\$\{2:-app\}/.test(sd), 'set-domain.sh no longer defaults to "app"');
ok(/case "\$CURAPP" in "app\.\$DOM"\) CURAPP="" ;; esac/.test(sd) && /head -c 1\)\$\(tr -dc 'a-z0-9' < \/dev\/urandom \| head -c 3\)/.test(sd), 'an existing app.<domain> is replaced by a random letter + 3 letters/digits');
ok(/\*"\.\$DOM"\) LABEL=\$\{CURAPP%%\.\*\}/.test(sd), 'and a random address already chosen is kept, not changed on every run');
ok(/if \[ "\$ARG" = random \]/.test(ch) && /BASE=\$\{CHOCOLATE_BASE_DOMAIN:-\$\(printf/.test(ch), 'change-app-host.sh random picks a word and takes the domain from the current address');
// the shape of a random word, taken from the real command
const w = cp.spawnSync('bash', ['-c', `tr -dc 'a-z' < /dev/urandom | head -c 1; tr -dc 'a-z0-9' < /dev/urandom | head -c 3`]).stdout.toString();
ok(/^[a-z][a-z0-9]{3}$/.test(w), 'the word is 4 characters, starting with a letter: ' + w);
// the DNS helper only ever removes ONE plain A record: never the wildcard, the bare domain, www or a dotted name
for (const bad of ['*', '@', 'www', 'a.b', '_acme-challenge', '']) {
  const r = cp.spawnSync('node', [__dirname + '/deploy/hostinger-dns.js', 'del-a', 'example.com', bad], { env: Object.assign({}, process.env, { HOSTINGER_API: 'http://127.0.0.1:9' }) });
  ok(r.status === 1 && /usage: del-a/.test(r.stderr.toString()), 'del-a refuses "' + bad + '"');
}
ok(/del-a "\$BASE" "\$OLDW"/.test(ch) && /\[ "\$\{OLD#\*\.\}" = "\$BASE" \]/.test(ch), 'drop-old removes the old word\'s A record only when it is a plain first word of the same domain (else it says what to delete by hand)');
// ── nginx: app.<domain> is refused on the random addresses (the wildcard block would otherwise keep serving it) ──
const gen = (...args) => cp.spawnSync('node', [__dirname + '/deploy/make-nginx.js', 'prod', ...args, '--wild-only']).stdout.toString();
const denied = t => (t.match(/server_name app\.mydomain\.com;\s*return 444;/g) || []).length;
let t = gen('k3f9.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com');
ok(denied(t) === 2 && /listen 80;[^}]*server_name app\.mydomain\.com;\s*return 444;/.test(t) && /listen 443 ssl http2;[^}]*server_name app\.mydomain\.com;[^}]*return 444;/.test(t), 'once app. is not the member address any more, http and https both close the connection (444)');
ok(/server_name \*\.mydomain\.com;/.test(t), 'every other random address still serves the app');
ok(denied(gen('app.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com')) === 0, 'while app. IS the member address it is never refused');
ok(denied(gen('k3f9.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--also=app.mydomain.com', '--wild=mydomain.com')) === 0, 'nor while it is kept as an extra address during the move');
ok(denied(gen('k3f9.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com', '--deny=none')) === 0, '--deny=none turns it off');
ok(/server_name www\.mydomain\.com;\s*return 444;/.test(gen('k3f9.mydomain.com', 'Tq5m8zr', 'a1b2c3.mydomain.com', '--wild=mydomain.com', '--deny=app,www')), '--deny=app,www adds more words');
ok(/--also="\$ALSO_HOSTS"\} --wild="\$WILD_DOMAIN" --wild-only/.test(fs.readFileSync(__dirname + '/deploy/update-vps.sh', 'utf8')), 'update-vps.sh tells the random-address file which extra addresses are kept, so none of them is refused by mistake');
console.log('test-deploy-no-app: ' + n + ' checks passed');
