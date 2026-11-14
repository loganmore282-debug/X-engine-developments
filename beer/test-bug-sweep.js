// Pins the fixes from the multi-agent bug sweep (see CLAUDE.md 6cw). Source-level checks plus a few real behaviours.
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
ok(!/firstReferralDepositId = depDoc\.id|creditDepositReferralCommission/.test(server) && /creditReferralCommission\(invId, userId, liveTier\.price\)/.test(server), 'the referral reward is paid on the first purchase, never on a deposit')
ok(!/app\.post\('\/redeem'/.test(server), 'gift codes are gone: no redeem route');
{ const i = server.indexOf("app.post('/admin/withdraw/reject'"); ok(i > 0 && /declineWithdrawalAndRefund\(ref, w\.userId/.test(server.slice(i, i + 3000)) && /stripHtml\(textOf\(req\.body\.reason\)\)/.test(server.slice(i, i + 3000)) && !/marz|pesajet/i.test(server), 'rejecting a withdrawal refunds the member and keeps the reason the admin typed; no payment provider is involved'); }
ok(/round2\(bal\) < liveTier\.price/.test(server) && /round2\(bal\) < amt/.test(server) && /\$gte: amt - 0\.005/.test(server), 'a wallet a hair under a whole amount (cents) is not refused');

// admin panel
ok(/_retIsTruth/.test(admin) && /multiplier:_retIsTruth\?'':\$\('pMult'\)\.value/.test(admin), 'a typed total payout is saved as typed (not rounded through the 2-decimal multiplier)');
ok(/m\.field==='walletBalance'&&m\.diff<0/.test(admin), 'Repair wallet is offered where the server will repair (stored below real)');
ok(/function loadFailed\(/.test(admin) && (admin.match(/loadFailed\(/g) || []).length >= 6, 'a failed fetch is never drawn as an empty list');
ok(!/renderPromoCodes|data-tab="promocodes"/.test(admin), 'the admin panel has no gift code screen any more');
ok(/cannot be blank/.test(admin), 'a blank number in Settings is refused instead of saved as 0');
ok(/phoneCore\(w\.accountPhone/.test(admin), 'withdrawal search also matches the login phone');
ok(/x\.classList\.toggle\('active',x\.dataset\.df===_depFilter\)/.test(admin) && /x\.classList\.toggle\('active',x\.dataset\.wf===_witFilter\)/.test(admin), 'Deposits / Withdrawals subtab highlight follows the click');
ok(/upline\.map\(m=>rowHtml\(m\)\)/.test(admin), 'no stray index digits on the referral chain');
ok(/Math\.round\(parseFloat\(\$\('adjAmt'\)/.test(admin), 'Credit / Debit confirm the whole amount the server will apply');
ok(/'admins', 'auditlog'\]\.includes\(lastTab\)/.test(admin), 'a staff deep link to an owner tab does not log staff out');

// member app
ok(/sheet === 'Balance Record'/.test(mod) && !/sheet === 'Transaction Statement'/.test(mod), 'Balance Record live-refreshes (the sheet title test matches)');
ok(/\['myBalance','walletBalance'\]/.test(mod), 'the live balance patch reaches My, Income and the Balance Record header');
ok(/changed\|processing\|updated/.test(mod), 'success notices (password changed, withdrawal processing) get the tick');
ok(/\.notify-bg\{[^}]*z-index:440/.test(html), 'notices sit above the Help and Download dialogs');
ok(/_catalogRefreshedAt/.test(mod) && /30000 - \(Date\.now\(\) - _catalogRefreshedAt\)/.test(mod), 'a phone clock ahead of the server cannot make the catalogue refetch in a loop');
ok(/r\.code === 'AUTH_UNAVAILABLE' \|\| r\.code === 'SERVER_ERROR'/.test(mod), 'a busy or unavailable server on opening the app does not sign the member out');
ok(!/signal:\s*AbortSignal\.timeout/.test(mod), 'no AbortSignal.timeout (older phones would skip the server logout)');
ok(/messages: null, page: 'home'/.test(mod), 'logout also forgets messages and the open tab');
ok(/function vGroup\(/.test(mod) && /ckNum\(min\)/.test(mod), 'the deposit minimum prints as plain digits, as on the owner screens');

// deploy / infra
const upd = rd('deploy/update-vps.sh');
ok(/^umask 022$/m.test(upd), 'update-vps.sh writes files nginx can read (a caller\'s umask 077 no longer makes the site 403)');
ok(/grep -q ssl_certificate "\$BAK" && ! grep -q ssl_certificate "\$CONF"/.test(upd), 'update-vps.sh puts the old nginx file back instead of leaving HTTPS down');
const mk = rd('deploy/make-nginx.js'); ok(/\(login\|check-key\)\/\?\$/.test(mk) && /password\/change\)\/\?\$/.test(mk), 'the login rate limits also cover a trailing slash');
ok(/%%2e%%2e/.test(rd('deploy/fail2ban/beer-probe.conf')), 'the fail2ban probe filter escapes % so it loads');
ok(/ADMIN_TOTP_SECRET = '';/.test(rd('deploy/setup-admin-code.js')), 'switching the admin code off writes an empty value (pm2 reload does not unset variables)');
const dbs = rd('db.js'); ok(/\['memberSessions', \{ expiresAt: 1 \}, \{ expireAfterSeconds: 86400 \}\]/.test(dbs) && /\['adminSessions',  \{ expiresAt: 1 \}, \{ expireAfterSeconds: 86400 \}\]/.test(dbs), 'expired login sessions are deleted by the database');
ok(/\['pendingDeposits', \{ createdAt: -1 \}\]/.test(dbs) && /\['withdrawals',     \{ createdAt: -1 \}\]/.test(dbs) && /\['transactions',    \{ createdAt: -1 \}\]/.test(dbs), 'the admin lists have a createdAt index');
for (const f of ['user/sw.js', 'admin/sw.js']) ok(/if \(resp && resp\.ok\)/.test(rd(f)), f + ' never stores a failed answer in the cache');
ok(/return 308 https:/.test(rd('deploy/update-vps.sh')), 'update-vps.sh turns certbot\'s 301 into 308 so a POST callback keeps its body when it is redirected');
ok(/maxretry = 3/.test(rd('deploy/fail2ban/beer.local').slice(rd('deploy/fail2ban/beer.local').indexOf('[beer-badua]'), rd('deploy/fail2ban/beer.local').indexOf('[beer-adminlogin]'))), 'one odd sender name no longer bans an address for a day');
console.log(`PASS: bug sweep fixes (${n} checks)`);
