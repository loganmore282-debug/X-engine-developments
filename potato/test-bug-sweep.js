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
ok(/if \(!mpData\.providerDown\) await markDepositFailed/.test(server), 'a busy MarzPay does not mark a possibly-live payment as failed');
ok(/!\(user\.data\(\)\.creditedDepositIds \|\| \[\]\)\.length && !user\.data\(\)\.firstReferralDepositId/.test(server) && !/finiteMoney\(user\.data\(\)\.totalDeposited\) === 0/.test(server), 'the referrer\'s first-deposit commission is not used up by an admin credit');
ok(/withLock\('redeem:' \+ raw\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g, ''\)/.test(server), 'one gift code has one lock whatever spelling is typed');
ok(/round2\(bal\) < liveTier\.price/.test(server) && /round2\(bal\) < amt/.test(server) && /\$gte: amt - 0\.005/.test(server), 'a wallet a hair under a whole amount (cents) is not refused');
{ const g = server.indexOf('async function payoutRejectGuard'), i = server.indexOf("app.post('/admin/withdraw/reject'"), j = server.indexOf("declineWithdrawalAndRefund(ref, w.userId", i);
  const guard = server.slice(g, i); ok(g > 0 && /pesajetGetTx\(w\.pesajetTxId\)/.test(guard) && /pesajetFindByReference\(w\.pesajetRef/.test(guard) && /marzGetSendStatus\(w\.marzTxUuid\)/.test(guard) && /marzGetBankTransferStatus\(w\.marzReference\)/.test(guard), 'rejecting a payout the gateway may already have asks the gateway first (PesaJet by id or reference, MarzPay by uuid or bank reference)');
  ok(/payoutRejectGuard\(witId, w\)/.test(server.slice(i, j)), 'the reject route uses that guard before any refund');
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
ok(/sheet === 'Balance Detail'/.test(mod) && !/sheet === 'Transaction Statement'/.test(mod), 'Balance Detail live-refreshes (the sheet title test matches)');
ok(/\['myBalance','walletBalance'\]/.test(mod), 'the live balance patch reaches My, Income and the Balance Record header');
ok(/changed\|processing\|updated/.test(mod), 'success notices (password changed, withdrawal processing) get the tick');
ok(/\.notify-bg\{[^}]*z-index:440/.test(html), 'notices sit above the Help and Download dialogs');
ok(/_catalogRefreshedAt/.test(mod) && /30000 - \(Date\.now\(\) - _catalogRefreshedAt\)/.test(mod), 'a phone clock ahead of the server cannot make the catalogue refetch in a loop');
ok(/r\.code === 'AUTH_UNAVAILABLE' \|\| r\.code === 'SERVER_ERROR'/.test(mod), 'a busy or unavailable server on opening the app does not sign the member out');
ok(!/signal:\s*AbortSignal\.timeout/.test(mod), 'no AbortSignal.timeout (older phones would skip the server logout)');
ok(/messages: null, salary: null, page: 'home'/.test(mod), 'logout also forgets messages and the open tab');

// deploy / infra
const upd = rd('deploy/update-vps.sh');
ok(/^umask 022$/m.test(upd), 'update-vps.sh writes files nginx can read (a caller\'s umask 077 no longer makes the site 403)');
ok(/grep -q ssl_certificate "\$BAK" && ! grep -q ssl_certificate "\$CONF"/.test(upd), 'update-vps.sh puts the old nginx file back instead of leaving HTTPS down');
const mk = rd('deploy/make-nginx.js'); ok(/\(login\|check-key\)\/\?\$/.test(mk) && /password\/change\)\/\?\$/.test(mk), 'the login rate limits also cover a trailing slash');
ok(/%%2e%%2e/.test(rd('deploy/fail2ban/potato-probe.conf')), 'the fail2ban probe filter escapes % so it loads');
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
{ const g = require('child_process').execFileSync('node', ['deploy/make-nginx.js', 'prod', 'a.example.com', 'Tq5m8zr', 'b.example.com'], { encoding: 'utf8', env: { ...process.env, POTATO_HOOK_TOKEN: '0123456789abcdef0123456789abcdef', POTATO_HOOK_HOST: 'h.example.com' } });
  ok(/zone=potato_hook:10m rate=50r\/s/.test(g) && (g.match(/limit_req zone=potato_hook burst=300 nodelay/g) || []).length >= 3, 'payment callbacks (hook host, MarzPay deposit and payout) use their own wide rate zone, not the shared 20/s one');
  const hostBlock = g.slice(g.indexOf('server_name h.example.com'));
  ok(!/potato_bad_ua/.test(hostBlock.slice(0, hostBlock.indexOf('location / { return 404; }'))), 'the webhook-only host has no user-agent wall'); }
ok(/return 308 https:/.test(rd('deploy/update-vps.sh')), 'update-vps.sh turns certbot\'s 301 into 308 so a POST callback keeps its body when it is redirected');
ok(/maxretry = 3/.test(rd('deploy/fail2ban/potato.local').slice(rd('deploy/fail2ban/potato.local').indexOf('[potato-badua]'), rd('deploy/fail2ban/potato.local').indexOf('[potato-adminlogin]'))), 'one odd sender name no longer bans an address for a day');
ok(/async function finishSignupToLogin\(typedPhone\)/.test(mod) && /if \(signupFlow\) \{ await finishSignupToLogin\(regTypedPhone\); return; \}/.test(mod) && /if \(ph\) ph\.value = typedPhone;/.test(mod), 'after signing up the member lands on Login with the number already filled in (only the password is typed)');
ok(/!window\._pendingRegPhone && !window\._pendingLoginSuccess\) \{\s*\$\('authScreen'\)\.style\.display = 'none';\s*showLoadingScreen\(\)/.test(mod), 'a typed login never shows the startup loader (Login stays until Home is ready)');
ok(/phoneError\('login', phoneErrorText\(\)\)/.test(mod) && /id="loginPhoneErr"/.test(html) && /notify\('Missing required parameter'\)/.test(mod), 'a wrong phone number is the red line under the phone box; every other login refusal is the centred notice');
ok(/function gutters\(\)/.test(mod) && /r\.type === 'childList' \|\| r\.attributeName === 'class'\)\) gutters\(\)/.test(mod) && /window\.mgGutters\(\)/.test(mod) && !/lastGut/.test(mod), 'the 4px scrollbar room of each page/sheet depends only on its own length and is made before the frame is painted (no 4px width jump when a page opens or you come back)');
ok(/function loadFailHtml\(/.test(mod) && /window\.retryLoad = /.test(mod) && /_productsLoadFailed \? loadFailHtml\('home'\)/.test(mod) && /_investmentsLoadFailed \? loadFailHtml\('assets'/.test(mod) && /_recordsLoadFailed && !\(STATE\.transactions/.test(mod) && /_messagesLoadFailed \? loadFailHtml\('messages'\)/.test(mod), 'a list that failed to load says so with a tap-to-retry, instead of "No products / No Orders / No Records / No Messages"');
ok(/See it under Orders\./.test(mod) && !/See it under Income/.test(mod) && /var _buyBusy = false;/.test(mod) && !/Confirm Investment|confirmActionBtn/.test(mod), 'Buy Now buys at once with no confirmation pop-up (a second tap while it is on its way does nothing); the success notice points at the Orders tab');
ok(/const memberCaptchaLimiter = rateLimit\(\{ windowMs: 5 \* 60 \* 1000, max: 600/.test(server), 'the captcha limit allows a new picture on every Sign Up tap, even behind one carrier address');
ok(/#pageHost\.mg-enter\{position:relative;animation:mgPageIn \.3s ease-out;\}/.test(html) && /@keyframes mgPageIn\{from\{opacity:0;top:6px;\}to\{opacity:1;top:0;\}\}/.test(html) && /@keyframes mgSheetIn\{from\{opacity:0;transform:translateY\(6px\);/.test(html), 'the page appearing animation runs once on #pageHost itself (a repaint of its content never restarts it) and rises by `top`, never a transform, so the fixed Treasure Chest stays in its corner');
ok(/function replayPageIn\(\)/.test(mod) && /if \(wasOpen && !\(opts && opts\.navigating\)\) replayPageIn\(\);/.test(mod), 'closing a sheet (back arrow or phone Back) replays the page appearing animation on the page underneath');
{ const dl = mod.slice(mod.indexOf('window.openDownloadPage'), mod.indexOf('// ── ABOUT US')); ok(/Download APK/.test(dl) && /Install in 3 steps/.test(dl) && /<h3><i><\/i>FAQ<\/h3>/.test(dl), 'the Download App page is the owner\'s: hero with Download APK, three steps, three tiles and the FAQ'); }
ok(/class="mg-mem"/.test(mod) && /<b>User<\/b>\$\{bought \? '<i>Active<\/i>' : ''\}/.test(mod) && /Total Purchase<\/div>/.test(mod) && /STATE\.profileLogo \? `<img/.test(mod.slice(mod.indexOf('function renderTeamMembers'), mod.indexOf('async function renderNetwork'))) && /\.mg-mem\{position:relative;height:122px/.test(html), 'a Team member card is as in the owner\'s screen: the uploaded profile picture, "User" with an Active tag once the member has bought, hidden number, amount on the right, join time, "Total Purchase" under a line');
ok(!/capError|regCapErr|regCaptcha|captchaId/.test(mod + fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')), 'Create Account has no captcha box or line (the owner\'s screens have none)');
ok(/btn\.classList\.toggle\('shown', show\)/.test(mod) && /\.pa-eye\.shown \.off\{display:none;\}/.test(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')), 'the password eye gets a slash while the password is shown');
ok(/'Processing\.\.\.'/.test(mod) && /'Logging in\.\.\.'/.test(mod) && /\.pa-btn:disabled\{/.test(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')), 'the Register and Login buttons read "Processing..." / "Logging in..." in the faded look while working');
ok(/\.pa-hero\{[^}]*height:178\.7px/.test(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')) && /\.pa-hero\.tall\{[^}]*height:245\.3px/.test(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')), 'the Login banner is 178.7 px high and the Create Account banner 245.3 px, as measured on the owner\'s screens');
console.log(`PASS: bug sweep fixes (${n} checks)`);
