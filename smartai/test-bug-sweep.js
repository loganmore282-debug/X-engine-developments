// Pins the fixes from the multi-agent bug sweep (see CLAUDE.md 6cw). Source-level checks plus a few real behaviours. (The checks of the old Potato screens went with those screens; test-smartai-app.js drives the member app.)
const fs = require('fs'), assert = require('assert'), vm = require('vm'), cp = require('child_process');
const rd = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const server = rd('server.js'), admin = rd('admin-src/index.html'), mod = rd('user-src/original_module.js'), html = rd('user-src/index.html');

// server: text is cut before the tag-stripping pattern runs (quadratic on a long run of '<')
{ const m = /function stripHtml\(s\) \{[^\n]*\}/.exec(server); ok(m, 'stripHtml found');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(m[0] + ';this.f=stripHtml;', ctx);
  const t = Date.now(); ctx.f('<'.repeat(200000)); ok(Date.now() - t < 400, 'a huge run of "<" no longer freezes the process (' + (Date.now() - t) + ' ms)');
  ok(ctx.f('<b>Ann</b>') === 'Ann', 'tags are still stripped'); }
ok(/app\.set\('case sensitive routing', true\)/.test(server), 'routes are case-sensitive (/Withdraw/request must not skip the maintenance gate)');
ok(/if \(!mpData\.providerDown\) await markDepositFailed/.test(server), 'a busy MarzPay does not mark a possibly-live payment as failed');
ok(/!\(user\.data\(\)\.creditedDepositIds \|\| \[\]\)\.length && !user\.data\(\)\.firstReferralDepositId/.test(server) && !/finiteMoney\(user\.data\(\)\.totalDeposited\) === 0/.test(server), 'the referrer\'s first-deposit commission is not used up by an admin credit');
ok(/withLock\('redeem:' \+ raw\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g, ''\)/.test(server), 'one gift code has one lock whatever spelling is typed');
ok(/round2\(bal\) < liveTier\.price/.test(server) && /round2\(bal\) < amt/.test(server) && /\$gte: amt - 0\.005/.test(server), 'a wallet a hair under a whole amount (cents) is not refused');
{ const g = server.indexOf('async function payoutRejectGuard'), i = server.indexOf("app.post('/admin/withdraw/reject'"), j = server.indexOf("declineWithdrawalAndRefund(ref, w.userId", i);
  const guard = server.slice(g, i); ok(g > 0 && /pesajetGetTx\(w\.pesajetTxId\)/.test(guard) && /pesajetFindByReference\(w\.pesajetRef/.test(guard) && /marzGetSendStatus\(w\.marzTxUuid\)/.test(guard), 'rejecting a payout the gateway may already have asks the gateway first (PesaJet by id or reference, MarzPay by uuid)');
  ok(/payoutRejectGuard\(witId, w(, \{ confirmPending: req\.body\.confirmPending === true \})?\)/.test(server.slice(i, j)), 'the reject route uses that guard before any refund');
  ok(/stripHtml\(textOf\(req\.body\.reason\)\)/.test(server.slice(j, j + 400)), 'the rejection reason typed by the admin is kept'); }
ok(/provider_reference/.test(server), 'the MarzPay payout webhook also matches our reference sent as provider_reference');

// admin panel
ok(/_retIsTruth/.test(admin) && /multiplier:_retIsTruth\?'':\$\('pMult'\)\.value/.test(admin), 'a typed total payout is saved as typed (not rounded through the 2-decimal multiplier)');
ok(/m\.field==='walletBalance'&&m\.diff<0/.test(admin), 'Repair wallet is offered where the server will repair (stored below real)');
ok(/function loadFailed\(/.test(admin) && (admin.match(/loadFailed\(/g) || []).length >= 6, 'a failed fetch is never drawn as an empty list');
ok(/codes\.join\('\\n'\)/.test(admin) && !/codes\.join\('\\\\n'\)/.test(admin), 'Copy all puts one gift code per line');
ok(/cannot be blank/.test(admin), 'a blank number in Settings is refused instead of saved as 0');
ok(/phoneCore\(w\.accountPhone/.test(admin), 'withdrawal search also matches the login phone');
ok(/x\.classList\.toggle\('active',x\.dataset\.df===_depFilter\)/.test(admin) && /x\.classList\.toggle\('active',x\.dataset\.wf===_witFilter\)/.test(admin), 'Deposits / Withdrawals subtab highlight follows the click');
ok(/upline\.map\(m=>rowHtml\(m\)\)/.test(admin), 'no stray index digits on the referral chain');
ok(/Math\.round\(parseFloat\(\$\('adjAmt'\)/.test(admin), 'Credit / Debit confirm the whole amount the server will apply');
ok(/'admins', 'auditlog'\]\.includes\(lastTab\)/.test(admin), 'a staff deep link to an owner tab does not log staff out');

// member app
ok(!/signal:\s*AbortSignal\.timeout/.test(mod), 'no AbortSignal.timeout (older phones would skip the server logout)');

// deploy / infra
const upd = rd('deploy/update-vps.sh');
ok(/^umask 022$/m.test(upd), 'update-vps.sh writes files nginx can read (a caller\'s umask 077 no longer makes the site 403)');
ok(/grep -q ssl_certificate "\$BAK" && ! grep -q ssl_certificate "\$CONF"/.test(upd), 'update-vps.sh puts the old nginx file back instead of leaving HTTPS down');
const mk = rd('deploy/make-nginx.js'); ok(/\(login\|check-key\)\/\?\$/.test(mk) && /password\/change\)\/\?\$/.test(mk), 'the login rate limits also cover a trailing slash');
ok(/%%2e%%2e/.test(rd('deploy/fail2ban/smartai-probe.conf')), 'the fail2ban probe filter escapes % so it loads');
ok(/ADMIN_TOTP_SECRET = '';/.test(rd('deploy/setup-admin-code.js')), 'switching the admin code off writes an empty value (pm2 reload does not unset variables)');
const dbs = rd('db.js'); ok(/\['memberSessions', \{ expiresAt: 1 \}, \{ expireAfterSeconds: 86400 \}\]/.test(dbs) && /\['adminSessions',  \{ expiresAt: 1 \}, \{ expireAfterSeconds: 86400 \}\]/.test(dbs), 'expired login sessions are deleted by the database');
ok(/\['pendingDeposits', \{ createdAt: -1 \}\]/.test(dbs) && /\['withdrawals',     \{ createdAt: -1 \}\]/.test(dbs) && /\['transactions',    \{ createdAt: -1 \}\]/.test(dbs), 'the admin lists have a createdAt index');
for (const f of ['user/sw.js', 'admin/sw.js']) ok(/if \(resp && resp\.ok\)/.test(rd(f)), f + ' never stores a failed answer in the cache');
// runtime-tester findings: stuck PesaJet payouts, automatic mode starvation, lost deposits
ok(/pj\.providerDown && pj\.httpStatus !== 429/.test(server), 'PesaJet 429 on a payout is a clean refusal (row back to Pending), not "lost contact"');
ok(/PesaJet accepted withdrawal \$\{withdrawalId\} but returned no transaction id/.test(server), 'an accepted payout without an id stays on Sending instead of Processing with nothing to follow');
ok(/async function resolveSendingPesajetPayouts/.test(server) && /await resolveSendingPesajetPayouts\(\);/.test(server) && /status: 'sending', pesajetTxId: null/.test(server), 'a PesaJet payout stuck on Sending is looked up by our reference: adopted when found, handed back to Pending when PesaJet has no record');
ok(/where\('autoHold', '!=', true\)/.test(server), 'held rows cannot fill the automatic-mode window');
ok(/where\('provider', '==', 'pesajet'\)\.where\('pesajetTxId', '==', null\)/.test(server) && /PESAJET_LOST_WINDOW_MS \+ 10 \* 60 \* 1000/.test(server), 'the lost-deposit lookup only reads rows without an id, and PesaJet rows older than the lookup window are parked for review');
// callbacks (webhooks)
ok(/function retryCallbackWork\(/.test(server) && /const delays = \[1000, 3000, 8000, 20000\]/.test(server) && /async function pesajetWebhookWork\(body\)/.test(server) && /async function marzDepositCallbackWork\(body\)/.test(server) && /async function marzWithdrawCallbackWork\(body\)/.test(server), 'a callback that claims a final status is re-checked 1, 3, 8 and 20 s later if the first pass could not confirm it (all three handlers)');
ok(/req\.path === '\/deposit\/callback' \|\| req\.path === '\/withdraw\/callback' \|\| req\.path === '\/pesajet\/webhook'\) return next\(\);\s*await getSettings/.test(server), 'callbacks never wait behind a settings read');
ok(/WARNING: PUBLIC_URL is not set/.test(server), 'a missing PUBLIC_URL is warned about at start-up');
ok(/creditDeposit\(doc, 'MarzPay callback'\)/.test(server) && /creditDeposit\(depSnap, \"member's poll\"\)/.test(server), 'MarzPay credits are labelled in the timing log');
ok(/async function inChunks\(/.test(server) && /Promise\.allSettled\(\[\s*reconcilePendingDeposits\(\)/.test(server), 'the reconciler checks five rows at a time and settles deposits and withdrawals side by side');
// nginx: callbacks get their own wide rate zone, no user-agent wall on the hook host, 308 instead of 301
{ const g = require('child_process').execFileSync('node', ['deploy/make-nginx.js', 'prod', 'a.example.com', 'N85d57j4', 'b.example.com'], { encoding: 'utf8', env: { ...process.env, SMARTAI_HOOK_TOKEN: '0123456789abcdef0123456789abcdef', SMARTAI_HOOK_HOST: 'h.example.com' } });
  ok(/zone=smartai_hook:10m rate=50r\/s/.test(g) && (g.match(/limit_req zone=smartai_hook burst=300 nodelay/g) || []).length >= 3, 'payment callbacks (hook host, MarzPay deposit and payout) use their own wide rate zone, not the shared 20/s one');
  const hostBlock = g.slice(g.indexOf('server_name h.example.com'));
  ok(!/smartai_bad_ua/.test(hostBlock.slice(0, hostBlock.indexOf('location / { return 404; }'))), 'the webhook-only host has no user-agent wall'); }
ok(/return 308 https:/.test(rd('deploy/update-vps.sh')), 'update-vps.sh turns certbot\'s 301 into 308 so a POST callback keeps its body when it is redirected');
ok(/maxretry = 3/.test(rd('deploy/fail2ban/smartai.local').slice(rd('deploy/fail2ban/smartai.local').indexOf('[smartai-badua]'), rd('deploy/fail2ban/smartai.local').indexOf('[smartai-adminlogin]'))), 'one odd sender name no longer bans an address for a day');
ok(!/capError|regCapErr|regCaptcha|captchaId/.test(mod + fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')), 'Create Account has no captcha box or line (the owner\'s screens have none)');
// November sweep: an async route that throws must answer (not hang), ids are text, one transfer backs one claim, exact payout timers survive a restart
{ const a = server.indexOf('function guardRoute(h) {'), b = server.indexOf("for (const m of ['get', 'post', 'put', 'delete', 'use', 'all'])");
  ok(a > 0 && b > a, 'guardRoute found');
  const ctx = { console: { error() {} } }; vm.createContext(ctx); vm.runInContext(server.slice(a, b) + ';this.g=guardRoute;', ctx);
  const res = { headersSent: false, code: 0, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; this.headersSent = true; } };
  const h = ctx.g(async () => { throw new Error('boom'); });
  h({ method: 'POST', path: '/x' }, res, () => {});
  setTimeout(() => { assert.ok(res.code === 500 && res.body && res.body.status === 'error', 'a throwing async route answers 500 instead of hanging'); }, 30);
  const res2 = { headersSent: true, status() { throw new Error('must not answer twice'); } };
  ctx.g(async () => { throw new Error('late'); })({ method: 'POST', path: '/hook' }, res2, () => {});
  let nextErr = null; ctx.g(() => { throw new Error('sync'); })({}, res, e => { nextErr = e; }); ok(nextErr && nextErr.message === 'sync', 'a synchronous throw goes to the error handler');
  ok(ctx.g((a1, b1, c1, d1) => {}).length === 4, 'an error handler (4 arguments) is left as it is');
  ok(ctx.g(h) === h, 'a route is wrapped once'); }
ok((server.match(/const userId = typeof req\.body\.userId === 'string' \? req\.body\.userId : '';/g) || []).length === 2 && /const depositId = typeof req\.body\.depositId === 'string' \? req\.body\.depositId : '';/.test(server), 'admin credit, debit and force-credit take ids only as text');
ok(/withLock\('manualtx:' \+ found\.ref, async \(\) => \{\s+const dupSnap/.test(server), 'the same transaction ID cannot be claimed twice at the same instant');
ok(/where\('status', '==', 'pending'\)\.where\('method', '==', 'manual'\)\.limit\(1000\)/.test(server), 'the expiry sweep reads manual orders only');
ok(/where\('userId', '==', uid\)\.orderBy\('createdAt', 'desc'\)\.limit\(200\)/.test(server), "a member's records are the newest ones");
ok(/if \(tsMillis\(inv\.createdAt\)\) armPayoutAt\(payoutDueAtMs\(createdMs, made \+ 1\)\);/.test(server), 'a product seen before it is due gets its exact timer (after a restart too)');
ok(/if \(r\.stale \|\| !STATE\) \{ _lk\.busy = false; card\.classList\.remove\('lift'\); \$\('lkGrid'\)\.classList\.remove\('busy'\); return; \}/.test(mod), 'a raffle card is put back when the flip is dropped');
console.log(`PASS: bug sweep fixes (${n} checks)`);
