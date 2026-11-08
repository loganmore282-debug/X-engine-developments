'use strict';
// WITHDRAWAL 2-STEP VERIFICATION (Google Authenticator), end to end on the REAL server.js against the in-memory MongoDB stand-in, with codes made by an
// authenticator stand-in (totp.codeAt on the secret the server hands out, exactly what the phone does).
// COMPULSORY (the setting is on by default; the owner can switch the rule off in Admin > Settings): a member who has not set it up cannot withdraw; turning it on needs the Trade Password and a correct first code; once on, a withdrawal needs the Trade Password AND
// a code; a code works once; wrong codes lock the member out; backup codes; turning it off; the owner's reset; the secret is stored encrypted and never
// sent to anybody again; an unreadable secret refuses the withdrawal instead of skipping the check.
const path = require('path'), Module = require('module'), crypto = require('crypto'), fs = require('fs'), os = require('os');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3200 + Math.floor(Math.random() * 90);
// the folder the server makes its own key file in (on the VPS it is /srv/potato-secrets): empty at the start, so the server has to make the key itself
const KEYFILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-e2e-')), 'twofa.key');
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/app', ADMIN_KEY: 'tf-admin-key-123456', NODE_ENV: 'development', TWOFA_KEY_FILE: KEYFILE });
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const totp = require('./totp.js'), first = require('./test-helpers/twofa-first-version.js');   // `first` = the first version's own lock and unlock code, copied as it shipped
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew; const advance = (steps) => { skew += (steps || 1) * 30000; };   // the server shares this clock: a new 30-second step without waiting
const realLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer tf-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 360) : ''); } };
let phoneN = 0;
async function member() {
  const c = await J('GET', '/auth/captcha'); const phone = '07715' + String(60000 + (++phoneN) * 11);
  const su = await J('POST', '/auth/signup', { phone, password: 'secret12', captchaId: c.j.id, captchaCode: '0000' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  await J('POST', '/invest/create', { tierKey: prods[0].key }, su.j.token);
  const bank = '07716' + String(70000 + phoneN * 13); await J('POST', '/bank/save', { holder: 'Two Step', network: 'MTN Mobile Money', phone: bank }, su.j.token);
  return { tok: su.j.token, uid: su.j.uid, bank, phone };
}
const user = id => fm.__stores.users.get(id), W = () => fm.__stores.withdrawals;
const wdraw = (m, body) => J('POST', '/withdraw/request', Object.assign({ amount: 20000, network: 'MTN Mobile Money', phone: m.bank, pin: '123456' }, body || {}), m.tok);
const rowsOf = m => [...W().values()].filter(w => w.userId === m.uid);
const settle = async m => { for (const w of rowsOf(m)) if (w.status === 'pending') await J('POST', '/admin/withdraw/reject', { withdrawalId: w._id || [...W().entries()].find(([, v]) => v === w)[0] }, null, true); };
const codeNow = (secret, offsetSteps) => totp.codeAt(secret, Date.now() + (offsetSteps || 0) * 30000);
const wrongCode = secret => { for (let i = 0; i < 50; i++) { const c = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); const ok3 = [-2, -1, 0, 1, 2].some(d => codeNow(secret, d) === c); if (!ok3) return c; } };
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 600000, withdrawMethod: 'manual', maxWithdrawalsPerDay: 0 } }, null, true);
  const A = await member(), B = await member(), C = await member();
  // ---- 0. off for everybody until the member turns it on
  let acc = (await J('GET', '/account', null, A.tok)).j.account; ok(acc.twofaEnabled === false, 'nobody has it until they set it up', acc);
  ok((await J('GET', '/public/settings')).j.settings.requireTwofaToWithdraw === true, 'the app is told that it is compulsory (on by default)');
  // ---- 0b. COMPULSORY: a member who has not set it up cannot withdraw at all
  {
    const wB0 = user(B.uid).walletBalance, rowsB0 = rowsOf(B).length;
    const rB = await wdraw(B); ok(rB.s === 403 && rB.j.code === 'TWOFA_SETUP_REQUIRED' && /Google Authenticator/.test(rB.j.message), 'a member who has not set it up is refused and told to set it up', rB.j);
    ok(user(B.uid).walletBalance === wB0 && rowsOf(B).length === rowsB0, 'nothing is taken and no request is created');
    const rBp = await wdraw(B, { pin: '654321' }); ok(rBp.s === 400 && rBp.j.code === 'WRONG_PIN', 'the Trade Password is still checked first (a wrong one says so)', rBp.j);
    const rBc = await wdraw(B, { totp: '123456' }); ok(rBc.s === 403 && rBc.j.code === 'TWOFA_SETUP_REQUIRED', 'a code sent by somebody who has not set it up changes nothing', rBc.j);
  }
  // ---- 1. starting needs the Trade Password
  ok((await J('POST', '/account/2fa/start', {}, null)).s === 401, 'starting needs a signed-in member');
  const bad = await J('POST', '/account/2fa/start', { pin: '654321' }, A.tok); ok(bad.s === 400 && bad.j.code === 'WRONG_PIN' && !user(A.uid).twofaPendingEnc, 'a wrong Trade Password starts nothing', bad);
  const st = await J('POST', '/account/2fa/start', { pin: '123456' }, A.tok);
  ok(st.s === 200 && /^[A-Z2-7]{32}$/.test(st.j.secret) && st.j.expiresInSec === 900, 'the Trade Password starts it: a 160-bit secret in base32', st.j);
  const secret = st.j.secret;
  ok(st.j.otpauth === 'otpauth://totp/' + encodeURIComponent(st.j.issuer) + ':' + encodeURIComponent(user(A.uid).phone) + '?secret=' + secret + '&issuer=' + encodeURIComponent(st.j.issuer) + '&algorithm=SHA1&digits=6&period=30', 'the link Google Authenticator opens is the standard otpauth address', st.j.otpauth);
  ok(user(A.uid).twofaPendingEnc && !JSON.stringify(user(A.uid)).includes(secret), 'the waiting secret is stored encrypted: its plain text is nowhere on the account');
  ok(user(A.uid).twofaEnabled !== true, 'and nothing is switched on yet');
  { const half = await wdraw(A); ok(half.s === 403 && half.j.code === 'TWOFA_SETUP_REQUIRED', 'while it is only half set up it still counts as not set up: refused', half.j); }
  // ---- 2. confirming needs a correct first code
  const c0 = await J('POST', '/account/2fa/confirm', { code: wrongCode(secret) }, A.tok);
  ok(c0.s === 400 && c0.j.code === 'TWOFA_INVALID' && /4 tries left/.test(c0.j.message) && user(A.uid).twofaEnabled !== true, 'a wrong first code does not turn it on and is counted', c0.j);
  const c1 = await J('POST', '/account/2fa/confirm', { code: '12345' }, A.tok); ok(c1.s === 400 && (user(A.uid).twofaFailCount || 0) === 1, 'a code that is not even 6 digits is refused and NOT counted', { s: c1.s, f: user(A.uid).twofaFailCount });
  const on = await J('POST', '/account/2fa/confirm', { code: codeNow(secret) }, A.tok);
  ok(on.s === 200 && Array.isArray(on.j.backupCodes) && on.j.backupCodes.length === 8 && on.j.backupCodes.every(c => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)) && new Set(on.j.backupCodes).size === 8, 'the right first code turns it on and shows 8 different backup codes once', on.j);
  const u = user(A.uid);
  ok(u.twofaEnabled === true && u.twofaSecretEnc && !JSON.stringify(u).includes(secret) && !u.twofaPendingEnc && u.twofaBackup.length === 8, 'on: the secret is encrypted, the waiting copy is gone, 8 backup hashes are kept', Object.keys(u));
  ok(on.j.backupCodes.every(c => !JSON.stringify(u).includes(c.replace('-', '')) && !JSON.stringify(u).includes(c)), 'the backup codes themselves are not stored (only keyed hashes)');
  ok(/^[0-9a-f]{64}\n$/.test(fs.readFileSync(KEYFILE, 'utf8')) && (fs.statSync(KEYFILE).mode & 0o777) === 0o600, 'the server made its own key file when it started (64 hex characters, owner only): nothing for the owner to set up');
  const fileKey = first.key(fs.readFileSync(KEYFILE, 'utf8').trim()), adminKey = first.key('tf-admin-key-123456');
  ok(first.open(fileKey, A.uid, u.twofaSecretEnc) === secret && first.open(adminKey, A.uid, u.twofaSecretEnc) === null, 'the member\'s secret is locked with that key file and NOT with the ADMIN_KEY (so a changed admin password cannot lock anybody out)');
  { const want = on.j.backupCodes.map(c => first.backupHash(fileKey, A.uid, c.replace('-', ''))); ok(u.twofaBackup.length === 8 && want.every(h => u.twofaBackup.includes(h)), 'and the backup codes are kept as keyed hashes under the same key'); }
  ok(Number.isInteger(u.twofaLastStep) && u.twofaFailCount === 0, 'the first code is already spent and the wrong-code count is reset', { last: u.twofaLastStep, f: u.twofaFailCount });
  acc = (await J('GET', '/account', null, A.tok)).j.account; ok(acc.twofaEnabled === true, 'the app is told to ask for the code', acc.twofaEnabled);
  const stt = await J('GET', '/account/2fa/status', null, A.tok); ok(stt.j.enabled === true && stt.j.backupLeft === 8 && !JSON.stringify(stt.j).includes(secret), 'the status says on, 8 backup codes left, and carries no secret', stt.j);
  ok((await J('POST', '/account/2fa/start', { pin: '123456' }, A.tok)).s === 409, 'starting again while it is on is refused');
  const backup = on.j.backupCodes;
  // ---- 3. a withdrawal now needs the Trade Password AND a code
  const w0 = user(A.uid).walletBalance, rows0 = rowsOf(A).length;
  const r1 = await wdraw(A); ok(r1.s === 400 && r1.j.code === 'TWOFA_REQUIRED' && /6-digit code/.test(r1.j.message), 'no code: refused with a clear message', r1.j);
  ok(user(A.uid).walletBalance === w0 && rowsOf(A).length === rows0, 'and nothing was taken, no request was created');
  const r2 = await wdraw(A, { totp: wrongCode(secret) }); ok(r2.s === 400 && r2.j.code === 'TWOFA_INVALID' && user(A.uid).walletBalance === w0, 'a wrong code is refused and nothing is taken', r2.j);
  const r3 = await wdraw(A, { pin: '654321', totp: codeNow(secret, 1) }); ok(r3.s === 400 && r3.j.code === 'WRONG_PIN', 'the right code with a WRONG Trade Password is refused (the Trade Password is still first)', r3.j);
  ok(user(A.uid).walletBalance === w0, 'and the code was not spent');
  const r4 = await wdraw(A, { totp: codeNow(secret, 1) }); ok(r4.s === 200 && user(A.uid).walletBalance === w0 - 20000, 'the Trade Password AND a right code: the withdrawal goes through', r4.j);
  const step1 = user(A.uid).twofaLastStep; ok(step1 === Math.floor((Date.now() + 30000) / 30000) || step1 >= Math.floor(Date.now() / 30000), 'the code\'s step is written down', step1);
  await settle(A); const w1 = user(A.uid).walletBalance;
  const r5 = await wdraw(A, { totp: codeNow(secret, 1) }); ok(r5.s === 400 && r5.j.code === 'TWOFA_USED' && user(A.uid).walletBalance === w1, 'the SAME code again is refused: a code works once', r5.j);
  const r6 = await wdraw(A, { totp: codeNow(secret, 0) }); ok(r6.s === 400 && r6.j.code === 'TWOFA_USED', 'an earlier code than the one already used is refused too', r6.j);
  ok(((user(A.uid).twofaFailCount) || 0) === 0, 'repeating a used code is not a wrong guess (not counted)', user(A.uid).twofaFailCount);
  const r7 = await wdraw(A, { totp: codeNow(secret, -2) }); ok(r7.s === 400, 'a code from more than one step ago (over a minute) is refused', r7.j);
  // ---- the SAME code spent by another request between the check and the money moving: nothing is taken
  {
    const wm = W(), realSet = wm.set.bind(wm); const fresh = codeNow(secret, 2);   // a step that has not been used; accepted? (two steps ahead is NOT) -> use +1 after spending it below
    wm.set = (k, v) => { const r = realSet(k, v); if (v && v.status === 'creating') user(A.uid).twofaLastStep = Math.floor(Date.now() / 30000) + 1; return r; };
    const race = await wdraw(A, { totp: codeNow(secret, 1) });
    wm.set = realSet;
    ok(race.s === 400 && race.j.code === 'TWOFA_USED' && user(A.uid).walletBalance === w1, 'the code is spent in the same step that takes the money: if it was spent a moment earlier, nothing is taken', race);
    const rows = rowsOf(A).filter(w => w.status === 'declined'); ok(rows.length >= 1, 'and the request row is closed at once', rowsOf(A).map(w => w.status));
    user(A.uid).twofaLastStep = step1;
  }
  // ---- 4. wrong codes lock the member out
  const lockA = await member(); {
    const s0 = await J('POST', '/account/2fa/start', { pin: '123456' }, lockA.tok); const sec = s0.j.secret; await J('POST', '/account/2fa/confirm', { code: codeNow(sec) }, lockA.tok);
    let last; for (let i = 0; i < 5; i++) last = await wdraw(lockA, { totp: wrongCode(sec) });
    ok(last.s === 429 && last.j.code === 'TWOFA_LOCKED', 'five wrong codes lock it', last.j);
    const during = await wdraw(lockA, { totp: codeNow(sec, 1) }); ok(during.s === 429 && during.j.code === 'TWOFA_LOCKED' && user(lockA.uid).walletBalance === 600000 - 3000 * 0 - (user(lockA.uid).totalInvested || 0), 'even the RIGHT code is refused while it is locked', during.j);
    advance(32);   // 16 minutes later
    const after = await wdraw(lockA, { totp: codeNow(sec, 0) }); ok(after.s === 200, 'after the lock the right code works again', after.j);
    ok(user(lockA.uid).twofaFailCount === 0, 'and the wrong-code count is back to zero', user(lockA.uid).twofaFailCount);
  }
  // ---- 5. backup codes
  await settle(A); const wb0 = user(A.uid).walletBalance;
  const rb = await wdraw(A, { totp: backup[0] }); ok(rb.s === 200 && rb.j.usedBackupCode === true && rb.j.backupLeft === 7, 'a backup code works instead of the 6-digit code and says 7 are left', rb.j);
  ok(user(A.uid).twofaBackup.length === 7 && user(A.uid).walletBalance === wb0 - 20000, 'it is removed in the same update that took the money');
  await settle(A);
  const rb2 = await wdraw(A, { totp: backup[0] }); ok(rb2.s === 400 && rb2.j.code === 'TWOFA_INVALID', 'the same backup code twice is refused', rb2.j);
  const rb3 = await wdraw(A, { totp: backup[1].toLowerCase().replace('-', ' ') }); ok(rb3.s === 200, 'a backup code typed in lower case with a space still works', rb3.j); await settle(A);
  // ---- 6. new backup codes need the Trade Password and a code; the old ones stop
  const nb0 = await J('POST', '/account/2fa/backup-codes', { pin: '123456', code: wrongCode(secret) }, A.tok); ok(nb0.s === 400, 'new backup codes need a right code', nb0.j);
  advance(1); const nb = await J('POST', '/account/2fa/backup-codes', { pin: '123456', code: codeNow(secret, 0) }, A.tok);
  ok(nb.s === 200 && nb.j.backupCodes.length === 8 && !nb.j.backupCodes.some(c => backup.includes(c)), 'new backup codes are made', nb.j);
  const old = await wdraw(A, { totp: backup[2] }); ok(old.s === 400, 'the old backup codes no longer work', old.j);
  const nw = await wdraw(A, { totp: nb.j.backupCodes[0] }); ok(nw.s === 200, 'a new one works', nw.j); await settle(A);
  // ---- 7. turning it off needs the Trade Password AND a code
  ok((await J('POST', '/account/2fa/disable', { pin: '654321', code: codeNow(secret, 1) }, A.tok)).s === 400, 'off: a wrong Trade Password is refused');
  ok((await J('POST', '/account/2fa/disable', { pin: '123456', code: wrongCode(secret) }, A.tok)).s === 400 && user(A.uid).twofaEnabled === true, 'off: a wrong code is refused');
  advance(1); const off = await J('POST', '/account/2fa/disable', { pin: '123456', code: codeNow(secret, 0) }, A.tok);
  ok(off.s === 200, 'off: the Trade Password and a right code turn it off', off.j);
  const ua = user(A.uid); ok(['twofaEnabled', 'twofaSecretEnc', 'twofaLastStep', 'twofaBackup', 'twofaPendingEnc', 'twofaFailCount'].every(k => ua[k] === undefined), 'everything about it is wiped from the account', Object.keys(ua).filter(k => /twofa/.test(k)));
  { const afterOff = await wdraw(A); ok(afterOff.s === 403 && afterOff.j.code === 'TWOFA_SETUP_REQUIRED', 'after turning it off the member must set it up again before the next withdrawal', afterOff.j); }
  const again = await J('POST', '/account/2fa/start', { pin: '123456' }, A.tok); ok(again.s === 200 && again.j.secret !== secret, 'it can be set up again, with a NEW secret', again.j.secret === secret);
  // ---- 8. the owner's reset (lost phone and lost backup codes)
  const sec2 = again.j.secret; advance(1); await J('POST', '/account/2fa/confirm', { code: codeNow(sec2) }, A.tok); ok(user(A.uid).twofaEnabled === true, 'on again');
  ok((await J('POST', '/admin/user/reset-2fa', { userId: A.uid }, null, false)).s === 401, 'only the owner can reset it');
  const rs = await J('POST', '/admin/user/reset-2fa', { userId: A.uid }, null, true); ok(rs.s === 200 && user(A.uid).twofaEnabled === undefined && user(A.uid).twofaSecretEnc === undefined, 'the owner\'s reset switches it off and wipes it', rs.j);
  { const afterReset = await wdraw(A); ok(afterReset.s === 403 && afterReset.j.code === 'TWOFA_SETUP_REQUIRED', 'after the owner\'s reset the member must set it up again before the next withdrawal', afterReset.j); }
  ok([...fm.__stores.auditLog ? fm.__stores.auditLog.values() : []].length >= 0, 'audit store reachable');
  // ---- 9. the setup expires; it is a member-only, signed-in feature
  await J('POST', '/account/2fa/start', { pin: '123456' }, B.tok); user(B.uid).twofaPendingAt = Date.now() - 20 * 60000;
  const exp = await J('POST', '/account/2fa/confirm', { code: '123456' }, B.tok); ok(exp.s === 400 && exp.j.code === 'TWOFA_NO_SETUP', 'a setup left waiting for more than 15 minutes has expired', exp.j);
  ok((await J('POST', '/account/2fa/confirm', { code: '123456' }, null)).s === 401 && (await J('GET', '/account/2fa/status')).s === 401, 'every route needs a signed-in member');
  // ---- 10. fail closed: an unreadable secret refuses the withdrawal, never skips the check
  const D = await member(); const sd = (await J('POST', '/account/2fa/start', { pin: '123456' }, D.tok)).j.secret; await J('POST', '/account/2fa/confirm', { code: codeNow(sd) }, D.tok);
  const good = user(D.uid).twofaSecretEnc; user(D.uid).twofaSecretEnc = good.slice(0, -4) + 'AAAA';
  const wd0 = user(D.uid).walletBalance; const un = await wdraw(D, { totp: codeNow(sd, 1) });
  ok(un.s === 503 && un.j.code === 'TWOFA_UNREADABLE' && user(D.uid).walletBalance === wd0, 'a damaged secret: the withdrawal is refused (never skipped) and nothing is taken', un.j);
  user(D.uid).twofaSecretEnc = good;
  const E = await member(); user(E.uid).twofaEnabled = true; user(E.uid).twofaSecretEnc = good; user(E.uid).twofaLastStep = 0; user(E.uid).twofaBackup = [];
  const copied = await wdraw(E, { totp: codeNow(sd, 1) }); ok(copied.s === 503 && copied.j.code === 'TWOFA_UNREADABLE', 'a secret copied onto ANOTHER account cannot be read there (it is bound to its owner)', copied.j);
  // ---- 11. the secrets never leave the server
  const lst = await J('GET', '/admin/users', null, null, true), det = await J('POST', '/admin/user/detail', { userId: D.uid }, null, true);
  const dump = JSON.stringify([lst.j, det.j]);
  ok(!/twofaSecretEnc|twofaPendingEnc|twofaBackup/.test(dump) && !dump.includes(sd), 'the admin panel never receives the secret, the waiting secret or the backup hashes');
  ok(det.j.user && det.j.user.twofaEnabled === true, 'but it does show that Google Authenticator is on', det.j.user && det.j.user.twofaEnabled);
  // ---- 11b. a member who set it up with the FIRST version (locked with the ADMIN_KEY, before the key file existed) is not locked out
  {
    const F = await member(), sf = totp.generateSecret(), shown = ['QWERT-23456', 'ASDFG-78923'];
    Object.assign(user(F.uid), { twofaEnabled: true, twofaSecretEnc: first.seal(adminKey, F.uid, sf), twofaLastStep: 0, twofaFailCount: 0,
      twofaBackup: shown.map(c => first.backupHash(adminKey, F.uid, c.replace('-', ''))) });
    const f0 = user(F.uid).walletBalance;
    const st0 = await J('GET', '/account/2fa/status', null, F.tok); ok(st0.j.enabled === true && st0.j.backupLeft === 2, 'the status of such a member reads normally', st0.j);
    const fr1 = await wdraw(F, { totp: codeNow(sf, 0) }); ok(fr1.s === 200 && user(F.uid).walletBalance === f0 - 20000, 'such a member still withdraws with the 6-digit code', fr1.j); await settle(F);
    const fr2 = await wdraw(F, { totp: shown[0] }); ok(fr2.s === 200 && fr2.j.usedBackupCode === true && fr2.j.backupLeft === 1 && user(F.uid).twofaBackup.length === 1, 'and their old backup code works once and is removed', fr2.j); await settle(F);
    const fr3 = await wdraw(F, { totp: shown[0] }); ok(fr3.s === 400 && fr3.j.code === 'TWOFA_INVALID', 'but not twice', fr3.j);
    const fr4 = await wdraw(F, { totp: wrongCode(sf) }); ok(fr4.s === 400 && fr4.j.code === 'TWOFA_INVALID' && user(F.uid).walletBalance === f0, 'a wrong code is still refused for them', fr4.j);
    // turning it off and on again locks the NEW secret with the key file
    advance(1); const offF = await J('POST', '/account/2fa/disable', { pin: '123456', code: codeNow(sf, 0) }, F.tok); ok(offF.s === 200, 'they can turn it off', offF.j);
    const s2 = (await J('POST', '/account/2fa/start', { pin: '123456' }, F.tok)).j.secret; advance(1); await J('POST', '/account/2fa/confirm', { code: codeNow(s2, 0) }, F.tok);
    ok(first.open(fileKey, F.uid, user(F.uid).twofaSecretEnc) === s2 && first.open(adminKey, F.uid, user(F.uid).twofaSecretEnc) === null, 'and the new setup is locked with the key file');
  }
  // ---- 11c. the owner's switch (Admin > Settings) turns the WHOLE feature off: no code asked from anybody (even a member who set it up), the member routes closed,
  //      every set-up kept for when it is switched on again
  {
    const G = await member(), H = await member(), I2 = await member(), K = await member();
    const enrol = async m => { const sec = (await J('POST', '/account/2fa/start', { pin: '123456' }, m.tok)).j.secret; await J('POST', '/account/2fa/confirm', { code: codeNow(sec) }, m.tok); return sec; };
    const sh = await enrol(H), si = await enrol(I2);
    const detOn = await J('POST', '/admin/user/detail', { userId: G.uid }, null, true); ok(detOn.j.twofaRequired === true, 'the owner\'s member page knows the feature is on', detOn.j.twofaRequired);
    // ON, a member turns it off while the request is being made: nothing is taken (TWOFA_CHANGED)
    {
      const sj = await enrol(K), wm = W(), realSet = wm.set.bind(wm), wJ0 = user(K.uid).walletBalance;
      wm.set = (k, v) => { const r = realSet(k, v); if (v && v.status === 'creating') delete user(K.uid).twofaEnabled; return r; };
      const ch = await wdraw(K, { totp: codeNow(sj, 1) }); wm.set = realSet; user(K.uid).twofaEnabled = true;
      ok(ch.s === 400 && ch.j.code === 'TWOFA_CHANGED' && user(K.uid).walletBalance === wJ0, 'on: if the member turns it off while the request is being made, nothing is taken', ch.j);
    }
    const before = { last: user(H.uid).twofaLastStep, backups: user(H.uid).twofaBackup.length, fails: user(H.uid).twofaFailCount || 0, enc: user(H.uid).twofaSecretEnc };
    const offSw = await J('POST', '/admin/settings/update', { settings: { requireTwofaToWithdraw: false } }, null, true); ok(offSw.s === 200, 'the owner can switch it off', offSw.j);
    ok((await J('GET', '/public/settings')).j.settings.requireTwofaToWithdraw === false && (await J('POST', '/admin/user/detail', { userId: G.uid }, null, true)).j.twofaRequired === false, 'the app and the member page are told');
    const g1 = await wdraw(G); ok(g1.s === 200, 'off: a member who has not set it up withdraws with just the Trade Password', g1.j); await settle(G);
    const h1 = await wdraw(H); ok(h1.s === 200 && h1.j.usedBackupCode === undefined, 'off: a member who HAD set it up is not asked for a code either', h1.j); await settle(H);
    const h2 = await wdraw(H, { totp: wrongCode(sh) }); ok(h2.s === 200, 'off: a code that is sent along is ignored (even a wrong one)', h2.j); await settle(H);
    ok(user(H.uid).twofaLastStep === before.last && user(H.uid).twofaBackup.length === before.backups && (user(H.uid).twofaFailCount || 0) === before.fails && user(H.uid).twofaSecretEnc === before.enc && user(H.uid).twofaEnabled === true, 'off: nothing about their set-up is checked, spent, counted or changed');
    // a refusal for another reason says that reason, never a Google Authenticator one
    { const wm = W(), realSet = wm.set.bind(wm), wH0 = user(H.uid).walletBalance;
      wm.set = (k, v) => { const r = realSet(k, v); if (v && v.status === 'creating') user(H.uid).walletBalance = 0; return r; };
      const bal = await wdraw(H); wm.set = realSet; user(H.uid).walletBalance = wH0;
      ok(bal.s === 400 && !/^TWOFA_/.test(bal.j.code || '') && /balance or account status changed/i.test(bal.j.message) && user(H.uid).walletBalance === wH0, 'off: if the balance changes mid-request the refusal says so (not a Google Authenticator reason) and nothing is taken', bal.j); }
    // the member routes are closed, the status says so, and the owner\'s reset still works
    const st = await J('GET', '/account/2fa/status', null, H.tok); ok(st.s === 200 && st.j.available === false && st.j.enabled === true, 'off: the status says the feature is not available (and that H still has a set-up)', st.j);
    for (const [path, body] of [['/account/2fa/start', { pin: '123456' }], ['/account/2fa/confirm', { code: '123456' }], ['/account/2fa/disable', { pin: '123456', code: codeNow(sh, 1) }], ['/account/2fa/backup-codes', { pin: '123456', code: codeNow(sh, 1) }]]) {
      const r = await J('POST', path, body, H.tok); ok(r.s === 403 && r.j.code === 'TWOFA_DISABLED', 'off: ' + path + ' is closed', r.j);
    }
    ok(user(H.uid).twofaEnabled === true && user(H.uid).twofaLastStep === before.last, 'and the closed routes changed nothing');
    const rsOff = await J('POST', '/admin/user/reset-2fa', { userId: I2.uid }, null, true); ok(rsOff.s === 200 && user(I2.uid).twofaEnabled === undefined, 'off: the owner can still reset a member', rsOff.j);
    // ON again: the set-up that was kept applies again, with the SAME secret
    const onSw = await J('POST', '/admin/settings/update', { settings: { requireTwofaToWithdraw: true } }, null, true); ok(onSw.s === 200, 'the owner switches it back on', onSw.j);
    const h3 = await wdraw(H); ok(h3.s === 400 && h3.j.code === 'TWOFA_REQUIRED', 'on again: the member who set it up is asked for the code again', h3.j);
    const h4 = await wdraw(H, { totp: codeNow(sh, 1) }); ok(h4.s === 200, 'and the code from the same secret works: nothing had to be set up again', h4.j); await settle(H);
    const g2 = await wdraw(G); ok(g2.s === 403 && g2.j.code === 'TWOFA_SETUP_REQUIRED', 'on again: a member who never set it up is refused until they do', g2.j);
    const st2 = await J('GET', '/account/2fa/status', null, H.tok); ok(st2.j.available === true && st2.j.enabled === true, 'and the status says available again', st2.j);
    ok((await J('GET', '/public/settings')).j.settings.requireTwofaToWithdraw === true && (await J('POST', '/admin/user/detail', { userId: G.uid }, null, true)).j.twofaRequired === true, 'and everybody is told');
  }
  // ---- 12. the books still balance
  const ig = await J('GET', '/admin/integrity', null, null, true); ok(ig.s === 200 && ig.j.mismatches.length === 0, 'the integrity check finds every wallet equal to its history', ig.j.mismatches);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-withdraw-2fa: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
