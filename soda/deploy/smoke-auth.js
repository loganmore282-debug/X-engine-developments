#!/usr/bin/env node
'use strict';
// Live check of Soda's member login against a RUNNING server and its real
// database. Creates one throwaway test member (random 077 number), then:
// signup, duplicate signup, wrong password, right password, session check,
// logout, session check again. Prints PASS/FAIL per step and never prints a
// token or a password.
//   node deploy/smoke-auth.js [http://127.0.0.1:3001]
const base = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const phone = '077' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const password = 'Smoke' + Math.random().toString(36).slice(2, 10);
let bad = 0;
const say = (ok, what, extra) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (extra ? '   (' + extra + ')' : '')); };
const call = async (path, body, token) => {
  try {
    const r = await fetch(base + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
    return { code: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { code: 0, body: { message: e.message } }; }
};
(async () => {
  const h = await fetch(base + '/health').then(r => r.json()).catch(() => null);
  say(h && h.status === 'ok' && h.db === true, 'server and database are up', h ? JSON.stringify(h) : 'no answer');
  let r = await call('/auth/signup', { phone, password });
  say(r.code === 200 && r.body.token && r.body.uid, 'signup creates the account and a session', 'HTTP ' + r.code + (r.body.code ? ' ' + r.body.code : ''));
  const token = r.body.token;
  r = await call('/auth/signup', { phone, password: 'Another1x' });
  say(r.code === 409 && r.body.code === 'PHONE_IN_USE', 'signing up the same phone again is refused', 'HTTP ' + r.code);
  r = await call('/auth/login', { phone, password: 'wrong-password' });
  say(r.code === 401 && r.body.code === 'INVALID_CREDENTIAL', 'a wrong password is refused', 'HTTP ' + r.code);
  r = await call('/auth/login', { phone, password });
  say(r.code === 200 && r.body.token, 'the right password logs in', 'HTTP ' + r.code);
  const t2 = r.body.token;
  r = await call('/auth/session/activity', {}, t2);
  say(r.code === 200, 'the session is accepted by the server', 'HTTP ' + r.code);
  r = await call('/auth/session/activity', {}, 'x'.repeat(43));
  say(r.code === 401, 'a made-up token is refused', 'HTTP ' + r.code);
  await call('/auth/session/logout', {}, t2);
  r = await call('/auth/session/activity', {}, t2);
  say(r.code === 401, 'after logout the token stops working at once', 'HTTP ' + r.code);
  r = await call('/auth/session/activity', {}, token);
  say(r.code === 200, 'the other session is unaffected', 'HTTP ' + r.code);
  console.log(bad ? '\n' + bad + ' step(s) FAILED' : '\nAll steps passed. (Test member ' + phone + ' stays in the soda database; harmless.)');
  process.exit(bad ? 1 : 0);
})();
