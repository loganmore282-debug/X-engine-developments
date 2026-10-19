'use strict';
// Fixes from the 4-agent bug hunt (money flows, member app, admin panel, deploy/security). Each check pins one fix.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), cp = require('node:child_process');
const acorn = require('acorn');
const R = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const server = R('server.js'), tree = acorn.parse(server, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return server.slice(n.start, n.end); };
const marzHelper = server.slice(server.indexOf('const _MARZ_ENVELOPE_WORDS'), server.indexOf('function _marzExtractBankTransfer'));
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// admin
{ const c = vm.createContext({}); vm.runInContext(fn('strictAdminAmount'), c);
  ok(c.strictAdminAmount('5000') === 5000 && c.strictAdminAmount(5000) === 5000 && c.strictAdminAmount(' 12.5 ') === 12.5 && c.strictAdminAmount('-30') === -30, 'plain numbers are read');
  for (const bad of ['5000abc', '', null, undefined, { $ne: 1 }, [5], '1e3', '0x10', 'NaN', '5,000']) ok(Number.isNaN(c.strictAdminAmount(bad)), 'refused: ' + JSON.stringify(bad)); }
ok(/const userId = String\(\(req\.body && req\.body\.userId\) \|\| ''\)\.trim\(\), amount = req\.body && req\.body\.amount, note = textOf\(req\.body && req\.body\.note\)\.slice\(0, 200\);\s*const amt = Math\.round\(strictAdminAmount\(amount\)\)/.test(server) && /Math\.abs\(strictAdminAmount\(amount\)\)/.test(server), 'admin credit and debit read the id as text and the amount strictly');
ok(/const depositId = String\(\(req\.body && req\.body\.depositId\) \|\| ''\)\.trim\(\)/.test(server), 'force-credit reads the deposit id as text');
ok(/payoutIsManual\(await getSettings\(\)\)\)\s*return res\.status\(409\)\.json\(\{ status: 'error', code: 'MANUAL_MODE'/.test(server) && /offerQuickApprove = !payoutIsManual\(await getSettings\(\)\)/.test(server) && /quickApprove: offerQuickApprove/.test(server), 'the notification Approve does nothing in manual payout mode, and the alert does not offer it');
ok(/truncated: snap\.docs\.length >= 10000/.test(server) && /Showing the first 10,000 members only/.test(R('admin-src/index.html')), 'the Users list says when it stopped at 10,000');
{ const a = R('admin-src/index.html');
  ok((a.match(/qCore = \/\^\[\+\\d\]\[\\d\\s\(\)\+-\]\{4,\}\$\/\.test\(raw\) \? phoneCore\(raw\) : ''/g) || []).length >= 3, 'Deposits, Withdrawals and Users search digits as a phone number only when it looks like one');
  ok(/\/\^\[\+\\d\]\[\\d\\s\(\)\+-\]\{2,\}\$\/\.test\(raw\) && phoneCore\(raw\)\.length>=3/.test(a), 'and so does Referrals'); }
// money
{ const c = vm.createContext({}); vm.runInContext(marzHelper + fn('_marzExtractTx'), c);
  ok(c._marzExtractTx({ status: 'success', data: { transaction: { uuid: 'u' } } }).status === '', 'the API envelope\'s "success" is not a payment status'); }
ok(/const _issuedRefs = new Map\(\)/.test(server) && /if \(_issuedRefs\.has\(ref\)\) continue;/.test(server), 'concurrent payment references are never the same');
ok(/limit\(2\)\.get\(\);\s*if \(!depQ\.empty\) \{/.test(server) && /const sameTx = body\.transactionId \? String\(body\.transactionId\) === String\(dep\.pesajetTxId\) : !ambiguous;/.test(server), 'a reference shared by two rows never takes the signed shortcut without a transaction id');
// member app
{ const mod = R('user-src/original_module.js'), tr = acorn.parse(mod, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  const mfn = name => { const x = tr.body.find(y => y.type === 'FunctionDeclaration' && y.id.name === name); assert(x, 'missing ' + name); return mod.slice(x.start, x.end); };
  const c = vm.createContext({ STATE: { account: { walletBalance: 20415.5 }, transactions: [
    { type: 'deposit', status: 'pending', amount: 30000 }, { type: 'cashback', status: 'success', amount: 4000 }, { type: 'deposit', status: 'success', amount: 70000 }] } });
  vm.runInContext(mfn('balLedger'), c); const l = c.balLedger();
  ok(l[0].after === 20415.5 && l[1].after === 20415.5 && l[2].after === 16415.5, 'a deposit still waiting for payment is not taken off the balances of the rows below it (' + l.map(x => x.after) + ')');
  const c2 = vm.createContext({ numGroup: undefined }); vm.runInContext(mfn('numGroup') + '\n' + mfn('ckTile'), c2);
  ok(c2.ckTile(20415.5) === '20,415.50' && c2.ckTile(30000) === '30,000' && c2.ckTile(0.4) === '0.40', 'Account tiles keep cents (20,415.50), whole amounts stay whole');
  ok(/window\.pgRefresh = async function\(\)\{[^}]*#pgPayBtn\.pg-busy/.test(mod.replace(/\n/g, ' ')), 'pulling down does not cancel a Pay that is in flight');
  ok(/const seq = window\._sheetSeq;/.test(mod) && /window\._sheetSeq !== seq\) return;/.test(mod), 'the payment page does not open if the member backed out of Deposit while the order was being made');
  ok(/btn\.textContent = 'Confirm';\n  if \(r\.stale\) return;\n  if \(r\.status !== 'success'\) return notify\(r\.message \|\| 'Could not save your wallet\.'\)/.test(mod) && !/textContent = 'Change Password'/.test(mod) && !/textContent = 'Submit'/.test(mod), 'the Confirm buttons keep their label after a failed save');
  ok(mod.includes("history.replaceState(history.state, '', '/')") && mod.includes('payment\\//.test(location.pathname)'), 'a session that ends on the payment address returns the address bar to /'); }
// deploy / security
const gen = (args, env = {}) => cp.execFileSync('node', [__dirname + '/deploy/make-nginx.js', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const prod = gen(['prod', 'app.example.org', 'Bake7qz3', 'a1b2c3.example.org'], { COOKIE_HOOK_TOKEN: 'abcdef0123456789abcdef' });
ok(/location \^~ \/k7x2\/pesajet\/webhook \{ return 404; \}/.test(prod) && !/location = \/k7x2\/pesajet\/webhook/.test(prod), 'the plain PesaJet address is closed for every path under it (a trailing slash used to get through)');
ok(/location \^~ \/refCode= \{ rewrite \^ \/index\.html last; \}/.test(prod), 'old /refCode= links go through the normal page rules (security headers, crawlers)');
ok(/location = \/health \{[^}]*limit_req zone=cookie_api[^}]*X-Forwarded-For/.test(prod), '/health passes the caller\'s address and is rate limited');
const sec = R('deploy/set-secret.js');
ok(/const quiet = new Writable/.test(sec) && /muted = true;/.test(sec) && !/_writeToOutput/.test(sec), 'set-secret never echoes the pasted value, however long it is');
ok(/pathname\.indexOf\('\\0'\) !== -1\) return send\(res, 400/.test(R('static-server.js')), 'a NUL byte in a path is a 400, not a crash');
const upd = R('deploy/update-vps.sh');
ok(/_restore_extras\(\)/.test(upd) && (upd.match(/_revert/g) || []).length >= 5, 'update-vps puts the preview and random-address files back when it fails');
ok(!/The database name in it is/.test(R('deploy/first-setup.sh')), 'first-setup never prints the connection string');
ok(/h-<hidden>/.test(R('deploy/webhook-check.sh')), 'webhook-check hides the secret webhook token');
ok(/case "\$OUT" in \*"said 401"\*\|\*"said 403"\*\) rm -f "\$TOKEN_FILE"/.test(R('deploy/set-wildcard.sh')), 'the Hostinger token is forgotten only when Hostinger itself refuses it');
{ const need = [...server.matchAll(/require\('\.\/([\w-]+)(?:\.js)?'\)/g)].map(m => m[1]).filter(x => fs.existsSync(__dirname + '/' + x + '.js')); const dep = R('deploy/deploy.sh');
  for (const m of new Set(need)) ok(dep.includes('/' + m + '.js'), 'deploy.sh ships ' + m + '.js'); }
// round 2: money / server
{ const a = server.indexOf('const _pwEdgeCh'), b = server.indexOf('function passwordRetries'); const f = new Function(server.slice(a, b) + ';return tidyPassword;')();
  const t0 = Date.now(); const out = f('a' + ' '.repeat(60000) + 'b'); ok(Date.now() - t0 < 100 && out.length === 60002, 'a 60,000-space password body no longer stalls the server (linear trim)');
  ok(f('  pass word \u00a0') === 'pass word' && f('\u200bx\ufeff') === 'x' && f(null) === '' && f('   ') === '', 'trimming still gives the same result'); }
ok(!/_pwEdge\b(?!Ch)/.test(server), 'no edge-trimming regex is left');
ok(/'\/messages', '\/deposit\/marzpay\/status'\]\);/.test(server) && /req\.path === '\/status' \? next\(\) : apiLimiter\(req, res, next\)/.test(server), 'the payment status poll uses the live-poll limit, not the 60/min money bucket');
{ const c = vm.createContext({}); vm.runInContext(server.slice(server.indexOf('const _MARZ_ENVELOPE_WORDS'), server.indexOf('function _marzExtractBankTransfer')) + fn('_marzExtractTx') + fn('_marzExtractBankTransfer'), c);
  ok(c._marzExtractTx({ status: 'success', data: null }).status === '' && c._marzExtractBankTransfer({ status: 'success' }).status === '', 'a reply with no inner status is neither a paid deposit nor a sent payout');
  ok(c._marzExtractTx({ status: 'completed', reference: 'r' }).status === 'completed' && c._marzExtractBankTransfer({ data: { bank_transfer_request: { status: 'COMPLETED' } } }).status === 'completed', 'real statuses are still read'); }
ok(/doc\('purchase:' \+ invRef\.id\)\.createIfAbsent/.test(server) && /doc\('purchase:' \+ doc\.id\)\.createIfAbsent/.test(server), 'a purchase has a fixed-id ledger row that the sweep can also write');
// round 2: deploy / security
{ const c = vm.createContext({}); vm.runInContext(fn('ipKey'), c);
  ok(c.ipKey('203.0.113.9') === '203.0.113.9' && c.ipKey('::ffff:203.0.113.9') === '203.0.113.9', 'IPv4 is counted per address');
  ok(c.ipKey('2001:db8:1:2::5') === c.ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd') && c.ipKey('2001:db8:1:2::5') === '2001:db8:1:2::/64', 'one IPv6 /64 is one client');
  ok(c.ipKey('2001:db8:1:3::5') !== c.ipKey('2001:db8:1:2::5') && c.ipKey('2001:DB8:1:2::5%eth0') === '2001:db8:1:2::/64', 'another /64 is another client; zone ids and case are ignored');
  ok(!/rateLimit\(\{(?![^\n]*keyGenerator)/.test(server), 'every rate limiter counts by ipKey / the claimed user'); }
ok(!/\b(adminBadCredGuard|ownerKeyGuard|memberLoginIpGuard)\.(locked|fail|clear)\(req\.ip\)/.test(server), 'the lockout guards count per /64');
{ const ng = gen(['prod', 'app.example.org', 'Bake7qz3', 'a1b2c3.example.org']);
  ok(/map \$remote_addr \$cookie_ip_key/.test(ng) && !/zone=cookie_\w+:\d+m rate=[^;]*;/.test(ng.replace(/limit_req_zone \$cookie_ip_key[^\n]*/g, '')) && !/\$binary_remote_addr/.test(ng), 'nginx counts IPv6 per /64');
  const adminBlock = ng.slice(ng.indexOf('server_name a1b2c3.example.org'));
  ok(/location \^~ \/k7x2\/pesajet\/webhook \{ return 404; \}/.test(adminBlock) && /location \^~ \/k7x2\/deposit\/callback \{ return 404; \}/.test(adminBlock) && /client_max_body_size 14m/.test(adminBlock), 'the admin host closes the gateway callback paths and accepts the 13 MB admin pages');
  ok(/client_max_body_size 8m/.test(ng.slice(0, ng.indexOf('server_name a1b2c3.example.org'))), 'the member host keeps 8 MB'); }
{ const u = R('deploy/update-vps.sh');
  ok(/HAD_CONF=0; if \[ -f "\$CONF" \]; then cp "\$CONF" "\$BAK"; HAD_CONF=1; else rm -f "\$BAK"; fi/.test(u) && /_revert\(\) \{ if \[ "\$HAD_CONF" = 1 \]; then cp "\$BAK" "\$CONF"; else rm -f "\$CONF"; fi; _restore_extras; \}/.test(u), 'a refused file is removed when there was no previous one');
  ok(/trap '_revert;[^']*' HUP INT TERM/.test(u) && /trap - HUP INT TERM/.test(u), 'an interrupted run puts the previous nginx files back');
  ok(/NOT DONE: nginx has no HTTPS section/.test(u) && /PIPESTATUS\[0\]/.test(u), 'DONE is not printed without HTTPS, and a failed git pull is said');
  ok(!/cp "\$BAK" "\$CONF"; _restore_extras/.test(u), 'every restore goes through _revert'); }
ok(/BASE=\$\{HOST#\*\.\}/.test(R('deploy/make-hook-url.sh')) && /BASE=\$\{CURH#\*\.\}/.test(R('deploy/change-app-host.sh')), 'the hook host and a moved app host use the real domain, not the placeholder');
ok(/rl\.on\('close', \(\) => \{ if \(!answered\)/.test(sec) && /process\.exit\(2\)/.test(sec), 'Ctrl+C in set-secret is "cancelled", not "saved"');
for (const f of ['cookie-adminlogin', 'cookie-badua', 'cookie-probe']) ok(!/\\\[\[\^\\\]\]\+\\\]/.test(R('deploy/fail2ban/' + f + '.conf')), f + ': the timestamp pattern matches (fail2ban cuts the time out of the line)');
{ let have = ''; try { have = cp.execFileSync('which', ['fail2ban-regex'], { encoding: 'utf8' }).trim(); } catch (_) {}
  if (have) { const log = require('node:os').tmpdir() + '/f2b-' + process.pid + '.log';
    fs.writeFileSync(log, ['203.0.113.9 - - [19/Oct/2026:10:00:01 +0000] "POST /k7x2/admin/login HTTP/1.1" 401 55 "-" "curl/8"', '2001:db8:1:2::5 - - [19/Oct/2026:10:00:03 +0000] "POST /k7x2/admin/check-key HTTP/1.1" 429 55 "-" "x"', '198.51.100.7 - - [19/Oct/2026:10:00:04 +0000] "GET /wp-login.php HTTP/1.1" 404 5 "-" "x"', '192.0.2.55 - - [19/Oct/2026:10:00:06 +0000] "GET / HTTP/1.1" 444 0 "-" "sqlmap"', '198.51.100.8 - - [19/Oct/2026:10:00:07 +0000] "GET /index.html HTTP/1.1" 200 5 "-" "x"'].join('\n') + '\n');
    const m = (jail) => /(\d+) matched/.exec(cp.spawnSync(have, [log, __dirname + '/deploy/fail2ban/' + jail + '.conf'], { encoding: 'utf8' }).stdout)[1] * 1;
    ok(m('cookie-adminlogin') === 2 && m('cookie-badua') === 1 && m('cookie-probe') === 1, 'fail2ban-regex: the three jails match real nginx log lines (admin guesses 2, hacking tool 1, probe 1)'); fs.unlinkSync(log); } }
ok(/function logSafe\(v\)/.test(server) && /logSafe\(body\.reference\)/.test(server), 'untrusted callback fields are cleaned before they reach the log');
ok((server.match(/Public route error:/g) || []).length === 6 && !/app\.get\('\/public[^\n]*\n[^\n]*message: e\.message/.test(server), 'public routes never send a driver message');
for (const f of ['deploy/update-vps.sh', 'deploy/first-setup.sh', 'deploy/webhook-check.sh', 'deploy/deploy.sh', 'deploy/set-wildcard.sh', 'deploy/set-domain.sh', 'deploy/change-app-host.sh']) cp.execFileSync('bash', ['-n', __dirname + '/' + f]);
// round 2
{ const del = server.slice(server.indexOf("app.post('/admin/user/delete'"), server.indexOf("const _adminCreditDebounce"));
  ok(/String\(req\.body\.confirm\) !== 'DELETE'/.test(del) && /where\('status', 'in', \['creating', 'pending', 'sending', 'processing'\]\)/.test(del) && /walletBalance: walletAtDelete/.test(del), 'deleting an account needs the confirm word, waits for open withdrawals, and logs the wallet it removed');
  ok(/async function dropAdminPushTokensOf/.test(server) && (server.match(/await dropAdminPushTokensOf\(username\)/g) || []).length === 2 && /inactive\.has\(d\.data\(\)\.username\)/.test(server), 'deactivated or deleted staff get no more alerts');
  ok(/together cannot be more than 100 percent/.test(server), 'the three level rewards cannot add up to more than 100 percent');
  ok(/reason = textOf\(req\.body\.reason\)\.slice\(0, 200\)/.test(server) && /action must be ban or unban/.test(server.slice(server.indexOf("app.post('/admin/ban'"), server.indexOf("app.post('/admin/ban'") + 800)), 'ban needs an explicit action'); }
{ const u = R('user-src/original_module.js'), h = R('user-src/index.html'), a = R('admin-src/index.html');
  ok(/expiresAtLocal/.test(u) && /msLeft/.test(server), 'the payment clock counts from this phone\'s own clock plus the seconds left the server sent');
  ok(/_buying/.test(u) && !/\[\\s,\]/.test(u.replace(/\[\\\\s,\]/g, '')), 'buy is not entered twice');
  ok(/overflow-wrap:\s*anywhere|overflow-wrap:anywhere/.test(h), 'long words wrap inside messages');
  ok(/fill/.test(a) && /\+03:00/.test(a), 'admin: white behind transparent logos and Uganda time for product opening'); }
console.log(`PASS: bug-hunt fixes (${n} checks)`);
// the admin credit/debit: a failed ledger row AFTER the wallet moved says so (and does not clear the 10 s debounce), a failure before it is a clean error
(async () => {
  const route = p => { const n = tree.body.find(x => x.type === 'ExpressionStatement' && x.expression.type === 'CallExpression' && x.expression.callee.object && x.expression.callee.object.name === 'app' && x.expression.arguments[0] && x.expression.arguments[0].value === p); assert(n, 'missing route ' + p); return server.slice(n.start, n.end); };
  for (const kind of ['deposit', 'debit']) {
    const rows = { users: { u1: { walletBalance: 100000 } } }, ledger = []; let failLedger = true; const handlers = {}, debounce = new Map();
    const db = { collection: n => n === 'users' ? { doc: () => ({ get: async () => ({ exists: true, data: () => rows.users.u1 }), update: async u => { for (const [k, v] of Object.entries(u)) if (v && v.__inc !== undefined) rows.users.u1[k] = (rows.users.u1[k] || 0) + v.__inc; } }) }
      : { doc: () => ({ set: async d => { if (failLedger) throw new Error('ledger down'); ledger.push(d); } }) } };
    const logs = []; const c = vm.createContext({ app: { post: (p, h) => { handlers[p] = h; } }, db, verifyOwner: () => true, strictAdminAmount: v => Number(v), MAX_MONEY_AMOUNT: 1e9, fmtMoney: n => 'UGX ' + n,
      _adminCreditDebounce: debounce, _adminDebitDebounce: debounce, nowStr: () => ({ date: 'd', time: 't' }), brandName: () => 'Cookie', getSettings: async () => ({}), withLock: (_k, fn) => fn(),
      FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => 0 }, newStatementId: () => 's', logAdminAction: (_r, a, m) => logs.push([a, m]), console: { error() {}, log() {} }, adminFailCode: () => 500 });
    vm.runInContext(route('/admin/' + kind), c);
    const call = async () => { let code = 200, body; await handlers['/admin/' + kind]({ body: { userId: 'u1', amount: '5000' } }, { status: x => { code = x; return { json: b => { body = b; } }; }, json: b => { body = b; } }); return { code, body }; };
    const r = await call();
    assert.equal(r.code, 500); assert.match(r.body.message, /WAS (credited|debited)/, kind + ': the answer says the wallet moved'); assert.ok(debounce.has('u1'), kind + ': the 10 s debounce stays so a retry is not instant');
    assert.ok(logs.some(l => l[1].ledgerRowFailed), kind + ': audit-logged with the failed record');
    failLedger = false; debounce.clear(); const ok2 = await call(); assert.equal(ok2.code, 200, kind + ': normal path works'); assert.equal(ledger.length, 1);
  }
  console.log('PASS: admin credit/debit tell the truth when only the ledger row fails');
})().catch(e => { console.error(e); process.exit(1); });
