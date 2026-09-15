#!/usr/bin/env node
/**
 * PesaJet, the third automatic gateway.
 *
 * Owner: "l would like also to introduce in a new gateway for Uganda
 * https://pay.pesajet.com/docs".
 *
 * Everything below RUNS the real functions lifted out of server.js against a
 * stub fetch and a stub database. Reading the source would prove nothing
 * about the properties that matter here, and every one of them is a way real
 * money could go wrong:
 *
 *   1. THE CONTRACT MATCHES THE PUBLISHED SDK. Endpoint, method, auth header,
 *      field names, the COLLECTION/DISBURSEMENT split, E.164 phone numbers,
 *      lowercase provider values. Checked against docs/pesajet-api.md's own
 *      record of @pesajet/sdk@1.0.2 -- if this drifts, requests fail live and
 *      nowhere else would say so.
 *   2. A WEBHOOK IS NEVER THE AUTHORITY. A correctly signed webhook claiming
 *      success must still credit nothing unless an independent re-read of
 *      GET /payments/{id} agrees. This is THE money-safety rule of this
 *      codebase and the whole reason a status endpoint was a precondition.
 *   3. EXPIRED IS NOT FAILED. Three terminal statuses, and the one that means
 *      "the member never approved the prompt" gets its own wording.
 *   4. "BUSY" IS NOT "REFUSED". A 5xx or a dropped connection must leave a
 *      deposit pending for the reconciler, never fail it -- and must never
 *      revert a payout from 'sending' to 'pending', which would invite a
 *      retry that pays twice.
 *   5. A FORGED SIGNATURE IS REFUSED, and an unverifiable one is downgraded to
 *      a hint rather than trusted.
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const dbSrc = fs.readFileSync(__dirname + '/db.js', 'utf8');
const adminSrc = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const contract = fs.readFileSync(__dirname + '/docs/pesajet-api.md', 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// Extracts one named function by matching its braces -- but finds the body's
// opening brace by first stepping over the PARAMETER LIST.
//
// The simpler "first { after the name" that the other harnesses here use
// breaks on destructured parameters: `function f({ a, b })` has its first
// brace inside the signature, so brace-matching closes at the end of the
// parameter list and hands back a truncated function. Half of this module's
// functions take an options object, and that is exactly how this file first
// failed ("Unexpected token 'async'" -- the slice had ended mid-declaration).
// The `async` is part of the name match for the reason test-spin-sources.js
// records: matching the bare `function` finds the right place in an async
// function but starts the slice after the keyword, and `new Function` then
// rejects the awaits inside.
function fnSource(name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start === -1) start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let paren = 0, bodyAt = -1;
  for (let k = src.indexOf('(', start); k < src.length; k++) {
    if (src[k] === '(') paren++;
    else if (src[k] === ')') { paren--; if (paren === 0) { bodyAt = src.indexOf('{', k); break; } }
  }
  if (bodyAt === -1) throw new Error(`no body found for ${name}`);
  let depth = 0;
  for (let k = bodyAt; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
function constSource(name) {
  const re = new RegExp('^const ' + name + ' = .*$', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('no such const: ' + name);
  return m[0];
}

// ── the module, lifted and run against a stub fetch ───────────────────────
// Env is set BEFORE the module text is evaluated, because PESAJET_BASE and
// PESAJET_KEY are consts computed at load time -- exactly as they are in the
// real server, so this exercises the same code path rather than a rewritten
// one.
function buildModule({ apiKey = 'pk_test_abc', secret = 'shh', base } = {}) {
  const calls = [];
  let next = () => ({ status: 200, body: {} });
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {},
                 body: opts.body ? JSON.parse(opts.body) : null });
    const r = next(calls.length, url, opts);
    if (r.throws) throw new Error(r.throws);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body === undefined ? {} : r.body),
    };
  };
  const mod = new Function('fetch', 'crypto', 'Buffer', 'process', 'console',
    'PROVIDER_BUSY_MSG', 'DEPOSIT_FAILED_MSG', 'AbortSignal', `
    ${constSource('PESAJET_BASE')}
    ${constSource('PESAJET_KEY')}
    ${constSource('PESAJET_WEBHOOK_SECRET')}
    ${constSource('PESAJET_TIMEOUT')}
    ${fnSource('pesajetConfigured')}
    ${fnSource('pesajetPhone')}
    ${fnSource('pesajetProviderFor')}
    ${fnSource('_pesajetRequest')}
    ${fnSource('pesajetCreate')}
    ${fnSource('pesajetCollect')}
    ${fnSource('pesajetDisburse')}
    ${fnSource('pesajetGetTx')}
    ${fnSource('pesajetStatusLabel')}
    ${fnSource('pesajetFailureMsg')}
    ${fnSource('pesajetUserMsg')}
    ${fnSource('pesajetVerifyWebhook')}
    return { pesajetConfigured, pesajetPhone, pesajetProviderFor, pesajetCreate,
             pesajetCollect, pesajetDisburse, pesajetGetTx, pesajetStatusLabel,
             pesajetFailureMsg, pesajetUserMsg, pesajetVerifyWebhook, PESAJET_BASE };
  `)(fakeFetch, crypto, Buffer,
     { env: { PESAJET_API_KEY: apiKey, PESAJET_WEBHOOK_SECRET: secret, PESAJET_BASE_URL: base } },
     { error(){}, warn(){}, log(){} },
     'BUSY', 'FAILED',
     { timeout: () => undefined });
  return { mod, calls, reply: fn => { next = fn; } };
}

// ── 1. the contract ───────────────────────────────────────────────────────
console.log('— the request matches the published SDK —');
{
  const { mod, calls, reply } = buildModule();
  reply(() => ({ status: 200, body: { transactionId: 'txn_1', status: 'PENDING' } }));
  (async () => {
    await mod.pesajetCollect({ amount: 30000, phone: '+256772000019',
      network: 'MTN Mobile Money', reference: 'CHZ-1', description: 'Mobile Money',
      idempotencyKey: 'dep-1' });
    const c = calls[0];
    ck(c.url === 'https://payments.pesajet.com/api/v1/payments',
       `POSTs to /payments on the SDK's own base URL (${c.url})`);
    ck(c.method === 'POST', 'with POST');
    ck(c.headers['X-API-Key'] === 'pk_test_abc', 'authenticated with X-API-Key');
    ck(c.headers['Content-Type'] === 'application/json', 'as JSON');
    ck(c.headers['Idempotency-Key'] === 'dep-1',
       'and carries Idempotency-Key, so a retry cannot raise a second prompt');
    ck(c.body.type === 'COLLECTION', 'a deposit is type COLLECTION');
    ck(c.body.currency === 'UGX', 'currency UGX');
    ck(c.body.amount === 30000,
       'the amount is whole shillings, not minor units (30000, not 3000000)');
    ck(c.body.phoneNumber === '+256772000019', 'the phone is E.164 with a +');
    ck(c.body.provider === 'mtn', "the provider is lowercase 'mtn'");
    ck(c.body.reference === 'CHZ-1', 'our own reference goes along');

    // A payout is the SAME endpoint with a different type. Getting this wrong
    // would send money the wrong way, which no later check would catch.
    const p2 = buildModule();
    p2.reply(() => ({ status: 200, body: { transactionId: 'txn_2', status: 'PENDING' } }));
    await p2.mod.pesajetDisburse({ amount: 17000, phone: '0701234567',
      network: 'Airtel Money', reference: 'W-1' });
    ck(p2.calls[0].url.endsWith('/payments') && p2.calls[0].method === 'POST',
       'a payout uses the same POST /payments');
    ck(p2.calls[0].body.type === 'DISBURSEMENT', 'with type DISBURSEMENT');
    ck(p2.calls[0].body.provider === 'airtel', "and provider 'airtel'");
    ck(p2.calls[0].body.phoneNumber === '+256701234567',
       'a stored local number is normalised to E.164 rather than sent raw');

    // provider is OPTIONAL and omitted when unknown. PesaJet's own SDK
    // refuses to guess on 073, and sending a WRONG operator is worse than
    // sending none.
    const p3 = buildModule();
    p3.reply(() => ({ status: 200, body: { transactionId: 't', status: 'PENDING' } }));
    await p3.mod.pesajetCollect({ amount: 1000, phone: '+256731234567', network: null, reference: 'r' });
    ck(!('provider' in p3.calls[0].body),
       'an unresolvable network omits `provider` rather than guessing one');
    ck(p3.mod.pesajetProviderFor(null, '+256731234567') === null,
       'and 073 is explicitly unresolvable, as PesaJet says');
    ck(p3.mod.pesajetProviderFor(null, '0771234567') === 'mtn' &&
       p3.mod.pesajetProviderFor(null, '0751234567') === 'airtel',
       'while a known prefix still resolves without a stored network');

    // The status read.
    const p4 = buildModule();
    p4.reply(() => ({ status: 200, body: { transactionId: 'txn_9', status: 'COMPLETED', reference: 'CHZ-1' } }));
    const t = await p4.mod.pesajetGetTx('txn_9');
    ck(p4.calls[0].url.endsWith('/payments/txn_9') && p4.calls[0].method === 'GET',
       'the status re-read is GET /payments/{transactionId}');
    ck(t.status === 'completed', 'and its status is lowercased for the shared sets');

    // ── 2/3. the status vocabulary ──────────────────────────────────────
    console.log('\n— three terminal statuses, and EXPIRED is not FAILED —');
    const L = p4.mod.pesajetStatusLabel;
    ck(L('COMPLETED') === 'success', 'COMPLETED -> success');
    ck(L('FAILED') === 'failed', 'FAILED -> failed');
    ck(L('EXPIRED') === 'failed', 'EXPIRED -> failed (it IS terminal)');
    ck(L('PENDING') === 'processing' && L('PROCESSING') === 'processing',
       'PENDING and PROCESSING are both still in flight');
    ck(L('') === '' && L('WEIRD') === '',
       'and an unrecognised status resolves to NOTHING -- never to success or failure');
    const expiredMsg = p4.mod.pesajetFailureMsg('EXPIRED');
    const failedMsg = p4.mod.pesajetFailureMsg('FAILED');
    ck(expiredMsg !== failedMsg, 'an expired prompt gets its own wording');
    ck(/timed out/i.test(expiredMsg) && /Nothing was taken/i.test(expiredMsg),
       'which says the prompt timed out and that nothing was taken');
    ck(failedMsg === 'FAILED', 'while a real failure keeps the standard message');

    // ── 4. busy is not refused ──────────────────────────────────────────
    console.log('\n— a busy gateway is not a refusal —');
    for (const [label, r] of [['a 500', { status: 500, body: { message: 'boom' } }],
                              ['a 429', { status: 429, body: {} }],
                              ['a dropped connection', { throws: 'ECONNRESET' }]]) {
      const p = buildModule();
      p.reply(() => r);
      const out = await p.mod.pesajetCollect({ amount: 1, phone: '+256771234567', reference: 'x' });
      ck(out.ok === false && out.providerDown === true,
         `${label} reports providerDown, so the caller leaves the row alone`);
      ck(p.mod.pesajetUserMsg(out, 'fallback') === 'BUSY',
         `  and reads to the member as "busy", not as a failure`);
    }
    {
      const p = buildModule();
      p.reply(() => ({ status: 400, body: { message: 'Insufficient balance', errorCode: 'E1' } }));
      const out = await p.mod.pesajetCollect({ amount: 1, phone: '+256771234567', reference: 'x' });
      ck(out.ok === false && !out.providerDown,
         'a 400 is a real refusal, NOT providerDown');
      ck(p.mod.pesajetUserMsg(out, 'fallback') === 'Insufficient balance',
         "and the gateway's own reason is what the member is told");
    }
    {
      // A transient 500 on the FIRST status attempt must not read as "not
      // paid" -- it retries, and a second-attempt success is the answer.
      const p = buildModule();
      let n = 0;
      p.reply(() => (++n === 1 ? { status: 503, body: {} }
                                : { status: 200, body: { status: 'COMPLETED' } }));
      const t2 = await p.mod.pesajetGetTx('txn_x');
      ck(t2.status === 'completed' && !t2.providerDown,
         'the status read retries once, so one blip is not mistaken for unpaid');
      const p2b = buildModule();
      p2b.reply(() => ({ status: 503, body: {} }));
      const t3 = await p2b.mod.pesajetGetTx('txn_x');
      ck(t3.providerDown === true && t3.status === '',
         'but a gateway that stays down reports providerDown with NO status');
      const p2c = buildModule();
      p2c.reply(() => ({ status: 404, body: { message: 'not found' } }));
      const t4 = await p2c.mod.pesajetGetTx('txn_x');
      ck(t4.providerDown === false && t4.status === '',
         'while a 404 is an answer, not an outage, and is not retried forever');
    }

    // ── 5. the webhook signature ────────────────────────────────────────
    console.log('\n— the webhook signature —');
    const p5 = buildModule({ secret: 'top-secret' });
    const payload = { event: 'payment.completed', transactionId: 'txn_1', amount: 30000,
                      reference: 'CHZ-1', status: 'COMPLETED', timestamp: 'now' };
    const good = crypto.createHmac('sha256', 'top-secret')
      .update(JSON.stringify(payload)).digest('hex');
    ck(p5.mod.pesajetVerifyWebhook(payload, good).verified === true,
       'a correct HMAC-SHA256 over the payload verifies');
    ck(p5.mod.pesajetVerifyWebhook({ ...payload, signature: good }, null).verified === true,
       'and so does one carried inside the body, with `signature` excluded from the digest');
    const forged = p5.mod.pesajetVerifyWebhook(payload, good.replace(/.$/, c => c === 'a' ? 'b' : 'a'));
    ck(forged.verified === false && forged.reason === 'mismatch',
       'a forged signature is a MISMATCH, which the routes refuse outright');
    ck(p5.mod.pesajetVerifyWebhook({ ...payload, amount: 999999 }, good).verified === false,
       'and tampering with the amount breaks it');
    const none = p5.mod.pesajetVerifyWebhook(payload, null);
    ck(none.verified === false && none.reason === 'no-signature',
       'a missing signature is distinguishable from a wrong one');
    const noSecret = buildModule({ secret: '' }).mod.pesajetVerifyWebhook(payload, good);
    ck(noSecret.verified === false && noSecret.reason === 'no-secret',
       'and with no secret configured it says so rather than pretending to verify');
    ck(noSecret.reason !== 'mismatch',
       "  -- and NOT as a mismatch, or an unconfigured secret would 401 every real webhook");

    finish();
  })().catch(e => { console.error(e); process.exit(1); });
}

function finish() {
  // ── the wiring, checked against the real source ─────────────────────────
  console.log('\n— wired into every path a provider has to reach —');
  const strip = t => t.replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  const S = strip(src);

  // The one chokepoint. If 'pesajet' is not a value normalizeProviderValue
  // recognises, every read of the setting silently falls back to MarzPay and
  // the gateway is simply never used -- with nothing anywhere saying so.
  const norm = new Function(strip(fnSource('normalizeProviderValue')) +
    '\nreturn normalizeProviderValue;')();
  ck(norm('pesajet') === 'pesajet', "normalizeProviderValue keeps 'pesajet'");
  ck(norm('marzpay') === 'marzpay' && norm('lipapay') === 'lipapay' &&
     norm('manual') === 'manual', 'and the three it already knew');
  ck(norm('automatic') === 'marzpay' && norm('nonsense') === 'marzpay' &&
     norm(undefined) === 'marzpay',
     "an unknown value still falls back to MarzPay, never to 'manual'");

  const autoProv = new Function(strip(fnSource('depositProvider')) +
    strip(fnSource('normalizeProviderValue')) +
    strip(fnSource('depositAutomaticProvider')) + '\nreturn depositAutomaticProvider;')();
  ck(autoProv({ depositMethod: 'pesajet' }) === 'pesajet',
     'PAY A resolves to PesaJet when it is picked');
  ck(autoProv({ depositMethod: 'manual' }) === 'marzpay',
     'and a legacy manual value still cannot leak through as an automatic gateway');

  const witProv = new Function(strip(fnSource('depositProvider')) +
    strip(fnSource('normalizeProviderValue')) +
    strip(fnSource('withdrawProvider')) + '\nreturn withdrawProvider;')();
  ck(witProv({ withdrawMethod: 'pesajet' }) === 'pesajet', 'payouts can be pinned to PesaJet');
  ck(witProv({ withdrawMethod: 'follow', depositMethod: 'pesajet' }) === 'pesajet',
     "and 'follow' follows it");

  // The enums, or the admin can never save the choice.
  ck(/'depositMethod' in updates && !\['marzpay', 'lipapay', 'pesajet'\]/.test(S),
     'depositMethod accepts pesajet at /admin/settings/update');
  ck(/'withdrawMethod' in updates && !\['follow', 'marzpay', 'lipapay', 'pesajet', 'manual'\]/.test(S),
     'and so does withdrawMethod');

  // Webhooks arrive with no Origin. Without the exemption the host guard
  // refuses them and money silently stops resolving.
  const guard = /const GUARD_EXEMPT = new Set\(\[([^\]]+)\]\)/.exec(S)[1];
  ck(guard.includes("'/deposit/pesajet/callback'"), 'the deposit callback is GUARD_EXEMPT');
  ck(guard.includes("'/withdraw/pesajet/callback'"), 'and so is the payout callback');

  // Both routes exist and both re-read before deciding. Checked INSIDE each
  // route body, not file-wide: a file-wide match would pass with the re-read
  // deleted, because the other gateways have their own.
  // The end marker of each slice must be a line of CODE, not a comment
  // banner: strip() has already removed the comments, so a banner anchor
  // returns -1, the slice runs to the end of the file, and an assertion then
  // passes on the OTHER gateway's copy of the same line. That is exactly how
  // the ping assertion below first passed against a route with no ping check
  // in it at all.
  const routeSlice = (route, end) => {
    const i = S.indexOf(route);
    if (i < 0) throw new Error('route not found: ' + route);
    const j = S.indexOf(end, i + route.length);
    if (j < 0) throw new Error('end marker not found after ' + route + ': ' + end);
    return S.slice(i, j);
  };
  for (const [route, end] of [["app.post('/deposit/pesajet/callback'", "app.post('/deposit/manual/init'"],
                              ["app.post('/withdraw/pesajet/callback'", "app.post('/withdraw/lipapay/callback'"]]) {
    const body = routeSlice(route, end);
    ck(body.includes('pesajetVerifyWebhook'), `${route} verifies the signature`);
    ck(/mismatch[\s\S]*?401/.test(body), '  and answers 401 to a forged one');
    ck(body.includes('pesajetGetTx'),
       '  and re-reads the transaction before deciding anything');
    ck(/event === 'ping'/.test(body), '  and answers a ping without touching money');
    ck(body.includes('providerDown'),
       '  and leaves the row alone when the gateway cannot be reached');
  }
  // The credit decision must come from the re-read, NOT from the body's
  // claimed status. If the body's status were trusted, anyone who can reach
  // the URL with a valid-looking payload could credit themselves.
  {
    const body = routeSlice("app.post('/deposit/pesajet/callback'", "app.post('/deposit/manual/init'");
    ck(!/creditDeposit\([\s\S]{0,80}body\./.test(body) && /realStatus === 'success'[\s\S]{0,40}creditDeposit/.test(body),
       'the credit is driven by the re-read, never by the webhook body');
    ck(!/body\.(status|amount)\b[\s\S]{0,200}creditDeposit/.test(body),
       "and the body's own status/amount never reach the credit");
    ck(/dep\.pesajetTxId/.test(body) && !/pesajetGetTx\(\s*(txId|body)/.test(body),
       'the id it re-reads is the one WE stored, not one the caller supplied');
  }
  // A 'sending' payout is ambiguous: a success may be recognised, a failure
  // may never be auto-refunded from an automated path.
  {
    const body = routeSlice("app.post('/withdraw/pesajet/callback'", "app.post('/withdraw/lipapay/callback'");
    ck(/realStatus === 'failed'[\s\S]{0,200}wit\.status === 'sending'[\s\S]{0,120}return/.test(body),
       "a 'sending' payout is never auto-declined and refunded -- admin only");
    ck(/declineWithdrawalAndRefund\([^)]*\['processing'\]/.test(body),
       "and the refund path is scoped to 'processing' alone");
  }
  // The payout branch: identifier written BEFORE the call, ambiguity never
  // reverted to pending, acceptance is not completion.
  {
    const i = S.indexOf("if (withdrawProvider(settNow) === 'pesajet')");
    const body = S.slice(i, S.indexOf("if (withdrawProvider(settNow) === 'lipapay')", i));
    ck(i > 0, 'processWithdrawalCore has a PesaJet branch');
    const iMark = body.indexOf("pesajetRef: sendingMarker");
    const iCall = body.indexOf('pesajetDisburse');
    ck(iMark > 0 && iCall > iMark,
       'the outbound reference is written BEFORE PesaJet is ever called');
    ck(/providerDown[\s\S]{0,400}code: 500/.test(body) &&
       !/providerDown[\s\S]{0,400}status: 'pending'/.test(body),
       "an unreachable gateway leaves it on 'sending', never back to pending");
    ck(/!pj\.ok[\s\S]{0,300}status: 'pending'/.test(body),
       'while a clean refusal DOES hand the row back to pending');
    ck(/status: 'processing'/.test(body) && !/status: 'processed'/.test(body),
       "acceptance lands on 'processing' -- PesaJet resolves asynchronously");
  }
  // The deposit branch: busy must not fail the deposit.
  {
    const i = S.indexOf("if (provider === 'pesajet')");
    const body = S.slice(i, S.indexOf("if (provider === 'lipapay')", i));
    ck(i > 0, '/deposit/marzpay has a PesaJet branch');
    ck(/if \(!pj\.providerDown\) await markDepositFailed/.test(body),
       'a BUSY gateway leaves the deposit pending; only a real refusal fails it');
    ck(/idempotencyKey: depRef\.id/.test(body),
       "the deposit's own id is the idempotency key, so a retry cannot double-prompt");
    ck(/status === 'initiating'[\s\S]{0,120}status: 'pending'/.test(body),
       'and a webhook that already credited this deposit is never reverted to pending');
  }
  // Both reconcilers, or a lost webhook never heals. This gateway needs it
  // most: its webhook URL is dashboard-configured, not sent per request.
  for (const [fn, field] of [['reconcilePendingDeposits', 'pesajetTxId'],
                             ['reconcilePendingWithdrawals', 'pesajetTxId']]) {
    const body = strip(fnSource(fn));
    ck(body.includes("'==', 'pesajet'") || body.includes(`where('${field}', '>', '')`),
       `${fn} sweeps PesaJet rows too`);
    ck(new RegExp(`where\\('${field}', '>', ''\\)`).test(body),
       `  and excludes rows with no ${field}, so dead rows cannot starve live ones`);
    ck(body.includes('pesajetGetTx'), '  re-reading each one independently');
  }
  {
    // Sliced from the START of the PesaJet query, not from the first mention
    // of pesajetTxId: the status comparison sits EARLIER on that same line,
    // so slicing from the field name steps straight over the thing being
    // checked and the assertion passed with the sweep widened to 'sending'.
    const w = strip(fnSource('reconcilePendingWithdrawals'));
    const i = w.indexOf("const pjSnap = await db.collection('withdrawals')");
    ck(i > 0, 'the payout sweep has a PesaJet query');
    const pjQuery = w.slice(i, w.indexOf('.get();', i));
    ck(pjQuery.includes("where('status', '==', 'processing')") &&
       !pjQuery.includes("'sending'"),
       "the payout sweep reads 'processing' only -- a 'sending' row is ambiguous and admin-only");
  }
  // Verify, or an admin is told "nothing was sent" about a payout that went.
  {
    const i = S.indexOf("app.post('/admin/withdraw/verify'");
    const body = S.slice(i, S.indexOf("app.post('/withdraw/marzpay/status'", i));
    ck(body.includes('if (w.pesajetRef) {'),
       'Verify recognises a PesaJet payout -- and its guard is live, not short-circuited');
    ck(/pesajetGetTx/.test(body), 'and asks PesaJet directly');
    ck(/does NOT mean nothing was sent/.test(body),
       'and never reports an unverifiable payout as "nothing was sent"');
  }

  // ── uniqueness, or one transaction could land twice ─────────────────────
  console.log('\n— the database guards —');
  for (const coll of ['pendingDeposits', 'withdrawals']) {
    const re = new RegExp(`\\['${coll}', \\{ pesajetTxId: 1 \\}, \\{ unique: true[^\\]]*`);
    const m = re.exec(dbSrc);
    ck(!!m, `${coll}.pesajetTxId has a unique index`);
    ck(m && /partialFilterExpression: \{ pesajetTxId: \{ \$type: 'string' \} \}/.test(m[0]),
       '  with the partial filter, without which every field-less document collides on null');
  }

  // ── the admin panel can actually pick it ────────────────────────────────
  console.log('\n— the admin panel —');
  ck(/function normalizeProv\(v\)\{ return \(v==='lipapay'\|\|v==='pesajet'\|\|v==='manual'\)/.test(adminSrc),
     "the panel's own normalizeProv knows 'pesajet' (it mirrors the server's)");
  ck(/pesajet:'PesaJet'/.test(adminSrc), 'and labels it PesaJet');
  ck(/name="depGateway"[^>]*value="pesajet"/.test(adminSrc), 'PAY A can be set to PesaJet');
  ck(/name="witMethod"[^>]*value="pesajet"/.test(adminSrc), 'and payouts can be pinned to it');
  // MarzPay's radio used to be "checked unless lipapay", which with a third
  // option would have shown TWO selected at once.
  ck(/value="marzpay" \$\{normalizeProv\(v\('depositMethod','marzpay'\)\)==='marzpay'\?'checked'/.test(adminSrc),
     "MarzPay's radio is checked on an exact match, not on \"not the other one\"");

  // ── the contract note is real, and matches ──────────────────────────────
  console.log('\n— the recorded contract —');
  ck(/@pesajet\/sdk@1\.0\.2/.test(contract), 'docs/pesajet-api.md names the SDK version it came from');
  ck(contract.includes('payments.pesajet.com/api/v1'), 'and the base URL the code uses');
  ck(contract.includes('X-API-Key'), 'and the auth header');
  ck(contract.includes('GET /payments/{transactionId}'), 'and the status endpoint');
  ck(/Not answered here/.test(contract),
     'and it lists what the SDK does NOT answer instead of guessing');
  ck(src.includes('docs/pesajet-api.md'),
     'and server.js points at it, so the provenance is not lost');

  console.log(bad ? `\n${bad} FAILED` : '\npesajet: all cases pass');
  process.exit(bad ? 1 : 0);
}
