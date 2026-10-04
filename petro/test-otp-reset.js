'use strict';
// With the master OTP switch OFF, registration and payout-account OTP stay off,
// but Forgot Password still requests (and requires) a code.
// Real server.js route source against stubs.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const sendSrc = cut("app.post('/auth/otp/send'", "app.post('/auth/otp/verify'");
const confirmSrc = cut("app.post('/auth/reset/confirm'", "app.post('/register'");
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
(async () => {
  let handlers = {}; const app = { post: (p, h) => { handlers[p] = h; } };
  let settings = { otpVerificationEnabled: false };
  let ticketOk = false, counted = 0;
  const db = { collection: () => ({ where() { return this; }, limit() { return this; }, get: async () => ({ docs: [{ data: () => ({ registrationDone: true }), id: 'u1' }], empty: false }) }) };
  new Function('app', 'db', 'OTP_PURPOSES', 'getSettings', 'cleanPhone', 'badPhoneMessage', 'verifyAuth', 'MARZSMS_KEY', 'otpCheckAndBumpDailyLimit', 'consumeOtpTicket', 'admin', 'logSecurityEvent', 'console',
    sendSrc + '\n' + confirmSrc)(app, db, new Set(['register', 'reset', 'bank']), async () => settings, p => String(p || '').replace(/\D/g, ''), () => 'bad phone', async () => null,
    '', async () => { counted++; return null; }, async () => ticketOk, { auth: () => ({ updateUser: async () => {} }) }, () => {}, { error() {} });
  const send = async purpose => { const r = res(); await handlers['/auth/otp/send']({ body: { purpose, phone: '0770000001' }, headers: {} }, r); return r; };
  // OTP off: registration and bank are refused as turned off...
  let r = await send('register'); ok(r.code === 503 && r.body.code === 'OTP_DISABLED', 'register: codes are off');
  r = await send('bank'); ok(r.code === 503 && r.body.code === 'OTP_DISABLED', 'bank: codes are off');
  // ...but reset goes ahead (it reaches the SMS-provider check, which is unset in this test)
  r = await send('reset'); ok(r.body.code !== 'OTP_DISABLED', 'reset: not blocked by the switch (' + JSON.stringify(r.body) + ')');
  ok(/SMS verification is not available/.test(r.body.message), 'reset proceeds as far as the SMS provider');
  // switch on: unchanged
  settings = { otpVerificationEnabled: true }; r = await send('register'); ok(r.body.code !== 'OTP_DISABLED', 'switch on: register proceeds');
  // reset confirm still requires a ticket with the switch off
  settings = { otpVerificationEnabled: false };
  const confirm = async b => { const x = res(); await handlers['/auth/reset/confirm']({ body: b }, x); return x; };
  r = await confirm({ phone: '0770000001', newPassword: 'abcdef', ticket: 'nope' }); ok(r.code === 400 && r.body.code === 'OTP_REQUIRED', 'reset without a valid code is refused with the switch off');
  ticketOk = true; r = await confirm({ phone: '0770000001', newPassword: 'abcdef', ticket: 'good' }); ok(r.code === 200 && r.body.status === 'success', 'reset with a valid code works with the switch off');
  // client: the form is never replaced by a support message
  const page = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(!/forgotSupportGroup/.test(page + mod), 'no support-message replacement for Forgot Password');
  ok(/forgotFormGroup/.test(page), 'the form is still there');
  console.log(`PASS: Forgot Password keeps its OTP with the master switch off (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
