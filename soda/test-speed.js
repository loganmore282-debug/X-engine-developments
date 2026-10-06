// Speed work: hashing off the main thread, fewer database reads per request, a cheap payout sweep, nginx compression and keep-alive.
const fs = require('fs'), assert = require('assert'), crypto = require('crypto');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8'), db = fs.readFileSync(__dirname + '/db.js', 'utf8'), nginx = fs.readFileSync(__dirname + '/deploy/make-nginx.js', 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const grab = name => { const i = server.indexOf('function ' + name + '('), j = server.indexOf('\n}\n', i) + 3; return server.slice(i - (server.slice(i - 6, i) === 'async ' ? 6 : 0), j); };
// 1. async scrypt gives byte-identical hashes to the old synchronous pair, so existing passwords keep working
const lib = new Function('crypto', `const _scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(String(password), salt, 64, (e, k) => e ? reject(e) : resolve(k)));
  ${grab('scryptHash')} ${grab('scryptVerify')} ${grab('scryptHashAsync')} ${grab('scryptVerifyAsync')} return { scryptHash, scryptVerify, scryptHashAsync, scryptVerifyAsync };`)(crypto);
(async () => {
  const oldHash = lib.scryptHash('Secret123'), newHash = await lib.scryptHashAsync('Secret123');
  ok(await lib.scryptVerifyAsync('Secret123', oldHash), 'a hash made the old way verifies in the new async check');
  ok(lib.scryptVerify('Secret123', newHash), 'a hash made the new way verifies in the old check');
  ok(!(await lib.scryptVerifyAsync('wrong', oldHash)) && !(await lib.scryptVerifyAsync('', 'garbage')), 'wrong passwords and garbage are refused');
  // the loop stays free while it hashes
  let ticks = 0; const t = setInterval(() => ticks++, 5); await Promise.all([1, 2, 3, 4].map(() => lib.scryptHashAsync('x'))); clearInterval(t);
  ok(ticks >= 5, 'the event loop keeps running while passwords are hashed (' + ticks + ' ticks)');
  for (const where of ['const passwordOk = await scryptVerifyAsync', 'passwordHash: await scryptHashAsync(password)', 'await scryptVerifyAsync(password, acct ? acct.passwordHash', 'await scryptVerifyAsync(pin, u.transactionPinHash)'])
    ok(server.includes(where), 'log in / sign up / Trade Password use the non-blocking hash: ' + where);
  // 2. /account is one user read; settling and the VIP query are not repeated on every refresh
  const acct = server.slice(server.indexOf("app.get('/account', async"), server.indexOf("app.get('/account', async") + 7000);
  ok(!/await settleAllForUser\(/.test(acct) && /memberVipLevelCached/.test(acct), '/account no longer settles cashback or queries VIP on every refresh');
  const inv = server.slice(server.indexOf("app.get('/investments', async"), server.indexOf("app.get('/investments', async") + 900);
  ok(!/await settleAllForUser\(/.test(inv), '/investments no longer settles first (the 0.5 s sweep pays what is due)');
  ok(/Promise\.all\(\[\s*db\.collection\('users'\)\.doc\(userId\)\.get\(\), getSettings\(\), wholeTeamDeposits\(userId\), activeL1Count\(userId\)/.test(server), '/team/stats reads everything together');
  // 3. payout sweep
  ok(/where\('nextPayoutAt', '<=', new Date\(\)\)/.test(server) && /_lastFullCashbackSweep > 5 \* 60 \* 1000/.test(server) && /status: 1, nextPayoutAt: 1/.test(db), 'the 0.5 s sweep reads only due investments, with a full pass every 5 minutes as a safety net');
  ok(/nextPayoutAt: willComplete \|\| !createdMs \? null/.test(server) && (server.match(/nextPayoutAt: new Date\(Date\.now\(\) \+ 86400000\)/g) || []).length === 2, 'new and given investments get their first payout time; each payout sets the next');
  // 4. nginx + node
  ok(/gzip on;/.test(nginx) && /application\/json/.test(nginx) && /upstream soda_node/.test(nginx) && /keepalive 32;/.test(nginx) && /proxy_set_header Connection ""/.test(nginx), 'nginx compresses and keeps connections to Node open');
  ok(/keepAliveTimeout = 65 \* 1000/.test(server), 'Node keeps those connections longer than nginx does');
  console.log(`PASS: speed (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
