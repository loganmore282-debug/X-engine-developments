'use strict';
// Fixes from the 4-agent bug hunt (money flows, member app, admin panel, deploy/security). Each check pins one fix.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), cp = require('node:child_process');
const acorn = require('acorn');
const R = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const server = R('server.js'), tree = acorn.parse(server, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return server.slice(n.start, n.end); };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// admin
{ const c = vm.createContext({}); vm.runInContext(fn('strictAdminAmount'), c);
  ok(c.strictAdminAmount('5000') === 5000 && c.strictAdminAmount(5000) === 5000 && c.strictAdminAmount(' 12.5 ') === 12.5 && c.strictAdminAmount('-30') === -30, 'plain numbers are read');
  for (const bad of ['5000abc', '', null, undefined, { $ne: 1 }, [5], '1e3', '0x10', 'NaN', '5,000']) ok(Number.isNaN(c.strictAdminAmount(bad)), 'refused: ' + JSON.stringify(bad)); }
ok(/const userId = String\(\(req\.body && req\.body\.userId\) \|\| ''\)\.trim\(\), \{ amount, note \} = req\.body;\s*const amt = Math\.round\(strictAdminAmount\(amount\)\)/.test(server) && /Math\.abs\(strictAdminAmount\(amount\)\)/.test(server), 'admin credit and debit read the id as text and the amount strictly');
ok(/const depositId = String\(\(req\.body && req\.body\.depositId\) \|\| ''\)\.trim\(\)/.test(server), 'force-credit reads the deposit id as text');
ok(/payoutIsManual\(await getSettings\(\)\)\)\s*return res\.status\(409\)\.json\(\{ status: 'error', code: 'MANUAL_MODE'/.test(server) && /offerQuickApprove = !payoutIsManual\(await getSettings\(\)\)/.test(server) && /quickApprove: offerQuickApprove/.test(server), 'the notification Approve does nothing in manual payout mode, and the alert does not offer it');
ok(/truncated: snap\.docs\.length >= 10000/.test(server) && /Showing the first 10,000 members only/.test(R('admin-src/index.html')), 'the Users list says when it stopped at 10,000');
{ const a = R('admin-src/index.html');
  ok((a.match(/qCore = \/\^\[\+\\d\]\[\\d\\s\(\)\+-\]\{4,\}\$\/\.test\(raw\) \? phoneCore\(raw\) : ''/g) || []).length >= 3, 'Deposits, Withdrawals and Users search digits as a phone number only when it looks like one');
  ok(/\/\^\[\+\\d\]\[\\d\\s\(\)\+-\]\{2,\}\$\/\.test\(raw\) && phoneCore\(raw\)\.length>=3/.test(a), 'and so does Referrals'); }
// money
{ const c = vm.createContext({}); vm.runInContext(fn('_marzExtractTx'), c);
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
  ok(/btn\.textContent = 'Confirm';\n  if \(r\.status !== 'success'\) return notify\(r\.message \|\| 'Could not save your wallet\.'\)/.test(mod) && !/textContent = 'Change Password'/.test(mod) && !/textContent = 'Submit'/.test(mod), 'the Confirm buttons keep their label after a failed save');
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
ok(/_restore_extras\(\)/.test(upd) && (upd.match(/_restore_extras/g) || []).length >= 4, 'update-vps puts the preview and random-address files back when it fails');
ok(!/The database name in it is/.test(R('deploy/first-setup.sh')), 'first-setup never prints the connection string');
ok(/h-<hidden>/.test(R('deploy/webhook-check.sh')), 'webhook-check hides the secret webhook token');
ok(/case "\$OUT" in \*"said 401"\*\|\*"said 403"\*\) rm -f "\$TOKEN_FILE"/.test(R('deploy/set-wildcard.sh')), 'the Hostinger token is forgotten only when Hostinger itself refuses it');
{ const need = [...server.matchAll(/require\('\.\/([\w-]+)(?:\.js)?'\)/g)].map(m => m[1]).filter(x => fs.existsSync(__dirname + '/' + x + '.js')); const dep = R('deploy/deploy.sh');
  for (const m of new Set(need)) ok(dep.includes('/' + m + '.js'), 'deploy.sh ships ' + m + '.js'); }
for (const f of ['deploy/update-vps.sh', 'deploy/first-setup.sh', 'deploy/webhook-check.sh', 'deploy/deploy.sh', 'deploy/set-wildcard.sh', 'deploy/set-domain.sh', 'deploy/change-app-host.sh']) cp.execFileSync('bash', ['-n', __dirname + '/' + f]);
console.log(`PASS: bug-hunt fixes (${n} checks)`);
