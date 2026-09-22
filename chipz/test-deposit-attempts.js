#!/usr/bin/env node
/**
 * Round 184: "you have to include the json sent when depositing in the admin
 * panel it will help us diagnose the problem."
 *
 * Before this, a deposit request the server REFUSED (a phone-format
 * rejection, a disabled gateway, an amount below the minimum) left nothing
 * an admin could inspect at all -- no pendingDeposits row was ever created
 * (markDepositFailed()'s own providerDetail only ever applies to a row that
 * got as far as calling a real payment provider), so diagnosing "why was
 * this refused" needed Railway log access nobody but the deploy owner has.
 * This is exactly what the CLIENT's own request body was, for the requests
 * that never got that far.
 *
 * This runs the real recordDepositRejection() against a stub database, checks
 * both deposit routes' real bodies for the property that matters (every
 * early refusal actually calls it, with THIS request's own body -- not just
 * that the helper is mentioned somewhere in the route), checks the new admin
 * route's real body, and runs the real admin-panel card-building function
 * against stub rows -- per this project's own repeatedly-learned rule: run
 * the functions, don't read them.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(HERE, 'admin-src', 'index.html'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

function fnSource(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  const bodyAt = text.indexOf('{', text.indexOf(')', start));
  let depth = 0;
  for (let k = bodyAt; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
function routeBody(method, urlPath) {
  const anchor = `app.${method}('${urlPath}'`;
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error(`no such route: ${method} ${urlPath}`);
  const bodyAt = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let k = bodyAt; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in route ${method} ${urlPath}`);
}

// ── recordDepositRejection() -- the write itself ─────────────────────────────
console.log('— recordDepositRejection() —');
(async () => {
  let writes;
  const db = { collection: (name) => ({
    add: async (doc) => { writes.push({ name, doc }); return { id: 'x1' }; },
  }) };
  const FieldValue = { serverTimestamp: () => 'TS' };
  const fn = new Function('db', 'FieldValue', `
    ${fnSource(src, 'recordDepositRejection')}
    return recordDepositRejection;
  `)(db, FieldValue);

  writes = [];
  fn('u1', 'marzpay', { key: 'bj', name: 'Benin' }, { amount: 5000, phone: '0161234567', network: 'MTN' }, 'Minimum amount is XOF 20,000');
  // Fire-and-forget: give the microtask queue a turn so the .add() promise
  // used inside recordDepositRejection actually resolves before we inspect it.
  await new Promise(r => setTimeout(r, 0));
  ck(writes.length === 1, 'exactly one write was made');
  ck(writes[0].name === 'depositAttempts', 'into its own collection, not pendingDeposits');
  ck(writes[0].doc.userId === 'u1', 'the userId is recorded');
  ck(writes[0].doc.route === 'marzpay', 'and which route it came through');
  ck(writes[0].doc.regionKey === 'bj', 'and the member\'s own region key');
  ck(writes[0].doc.body === JSON.stringify({ amount: 5000, phone: '0161234567', network: 'MTN' }),
     'the raw request body is stored as JSON, verbatim');
  ck(writes[0].doc.reason === 'Minimum amount is XOF 20,000', 'and the refusal reason alongside it');
  ck(writes[0].doc.createdAt === 'TS', 'stamped with the server clock');

  writes = [];
  fn(null, 'manual', null, { amount: 1 }, 'x');
  await new Promise(r => setTimeout(r, 0));
  ck(writes[0].doc.userId === null, 'no userId (an unauthenticated edge case) writes null, not a crash');
  ck(writes[0].doc.regionKey === null, 'and no region likewise writes null rather than throwing');

  // A body/reason far larger than anything a real request could produce must
  // still be capped -- same discipline as markDepositFailed()'s own
  // providerDetail cap, so a huge or malicious body cannot be written
  // unbounded into Mongo.
  writes = [];
  fn('u1', 'marzpay', { key: 'ug' }, { junk: 'x'.repeat(5000) }, 'y'.repeat(5000));
  await new Promise(r => setTimeout(r, 0));
  ck(writes[0].doc.body.length === 2000, 'the stored body is capped at 2000 characters');
  ck(writes[0].doc.reason.length === 500, 'and the stored reason is capped at 500 characters');

  // A write failure (a genuinely down database) must never throw out of a
  // fire-and-forget diagnostic call -- this is best-effort logging, and an
  // uncaught rejection here would crash the very request it was trying to
  // help diagnose.
  const dbThatThrows = { collection: () => ({ add: async () => { throw new Error('boom'); } }) };
  const fnThrows = new Function('db', 'FieldValue', `
    ${fnSource(src, 'recordDepositRejection')}
    return recordDepositRejection;
  `)(dbThatThrows, FieldValue);
  let threw = false;
  try { fnThrows('u1', 'marzpay', null, {}, 'x'); await new Promise(r => setTimeout(r, 0)); }
  catch (e) { threw = true; }
  ck(!threw, 'a write failure is swallowed, never thrown back at the caller');

  finishSync();
})();

function finishSync() {
  // ── every early refusal in /deposit/marzpay actually calls it, with the
  // REAL request body (req.body), not some derived/partial shape ──
  console.log('\n— /deposit/marzpay records every refusal it can diagnose —');
  {
    const body = routeBody('post', '/deposit/marzpay');
    ck(/GATEWAY_REGION/.test(body) && /recordDepositRejection\(userId, 'marzpay', paymentRegion, req\.body, msg\)/.test(
      body.slice(body.indexOf('GATEWAY_REGION') - 400, body.indexOf('GATEWAY_REGION') + 200)),
      'the gateway-region refusal records the real req.body');
    const minAt = body.indexOf('Minimum amount is');
    ck(minAt !== -1 && /recordDepositRejection\(userId, 'marzpay', paymentRegion, req\.body, msg\)/.test(body.slice(minAt, minAt + 300)),
       'the below-minimum-amount refusal records it too');
    const phAt = body.indexOf('_ph.error');
    ck(phAt !== -1 && /recordDepositRejection\(userId, 'marzpay', paymentRegion, req\.body, _ph\.error\)/.test(body.slice(phAt, phAt + 300)),
       'and the phone-format refusal -- the exact class of bug this exists for -- records it with the phone\'s own refusal reason');
  }

  console.log('\n— /deposit/manual/init records every refusal it can diagnose —');
  {
    const body = routeBody('post', '/deposit/manual/init');
    const netAt = body.indexOf("'Select a network'");
    ck(netAt !== -1 && /recordDepositRejection\(userId, 'manual', depositRegion, req\.body, 'Select a network'\)/.test(body.slice(netAt - 200, netAt + 100)),
       'no network chosen is recorded');
    const minAt = body.indexOf('Minimum amount is');
    ck(minAt !== -1 && /recordDepositRejection\(userId, 'manual', depositRegion, req\.body, msg\)/.test(body.slice(minAt, minAt + 300)),
       'the below-minimum-amount refusal is recorded');
    const sphAt = body.indexOf('_sph.error');
    ck(sphAt !== -1 && /recordDepositRejection\(userId, 'manual', depositRegion, req\.body, _sph\.error\)/.test(body.slice(sphAt, sphAt + 300)),
       'and the phone-format refusal is recorded with the phone\'s own reason');
    const busyAt = body.indexOf('All payment numbers for this network are busy');
    ck(busyAt !== -1 && /recordDepositRejection\(userId, 'manual', depositRegion, req\.body, msg\)/.test(body.slice(busyAt, busyAt + 300)),
       'a real attempt that found no available number is recorded too, not just format rejections');
  }

  // ── the admin route: gated, region-scoped, and the raw body reaches the panel ──
  console.log('\n— GET /admin/deposit-attempts/list —');
  {
    const body = routeBody('post', '/admin/deposit-attempts/list');
    ck(/verifyAdmin\(req\)/.test(body.slice(0, 150)), 'gated behind verifyAdmin, same as every other admin list');
    ck(/scopeRowsToRegion\(rows, want, userRegions\)/.test(body), 'filtered through the same one-country-switch helper every other admin list uses');
    ck(/db\.collection\('depositAttempts'\)/.test(body), 'reads from the collection recordDepositRejection() actually writes to');
    ck(/truncated = snap\.docs\.length >= 500/.test(body), 'a page cut short is judged on the raw read, before the country filter');
  }

  // ── the admin panel's own card renders the raw JSON, and hides itself
  // entirely when there is nothing to show ──
  console.log('\n— depositAttemptsCard() —');
  {
    const esc = new Function(admin.match(/function esc\(s\)\{[^\n]*\}/)[0] + '; return esc;')();
    const fdate = (v) => String(v || '');
    const fn = new Function('esc', 'fdate', fnSource(admin, 'depositAttemptsCard') + '\nreturn depositAttemptsCard;')(esc, fdate);
    ck(fn([]) === '', 'an admin who has never had a rejected attempt sees no card at all, not an empty one');
    const html = fn([{ id: 'a1', userId: 'u1', accountPhone: '0161234567', route: 'marzpay',
                        reason: 'Minimum amount is XOF 20,000',
                        body: '{"amount":5000,"phone":"0161234567"}', createdAt: '2026-09-13T14:00:00Z' }]);
    ck(html.includes('{&quot;amount&quot;:5000,&quot;phone&quot;:&quot;0161234567&quot;}') || html.includes(esc('{"amount":5000,"phone":"0161234567"}')),
       'the raw JSON body is rendered, HTML-escaped rather than trusted as markup');
    ck(html.includes('Minimum amount is XOF 20,000'), 'and the reason it was refused');
    ck(html.includes('data-uid="u1"'), 'the row is clickable through to that member\'s own user-detail modal, same as every other admin list');
    ck(html.includes('Automatic (PAY A)'), "a marzpay attempt is labelled the member-facing PAY A name, never the internal gateway name");
    const manualHtml = fn([{ id: 'a2', route: 'manual', body: '{}', reason: 'x', createdAt: '2026-09-13T14:00:00Z' }]);
    ck(manualHtml.includes('Manual (PAY B)'), 'and a manual attempt is labelled PAY B');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall deposit-attempt diagnostics pass');
  process.exit(bad ? 1 : 0);
}
