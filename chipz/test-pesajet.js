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
    'PROVIDER_BUSY_MSG', 'DEPOSIT_FAILED_MSG', 'AbortSignal', 'URLSearchParams', `
    ${constSource('PESAJET_BASE')}
    ${constSource('PESAJET_KEY')}
    ${constSource('PESAJET_WEBHOOK_SECRET')}
    ${constSource('PESAJET_TIMEOUT')}
    ${constSource('PESAJET_READ_TIMEOUT')}
    ${fnSource('pesajetConfigured')}
    ${fnSource('pesajetPhone')}
    ${fnSource('pesajetProviderFor')}
    ${fnSource('_pesajetRequest')}
    ${fnSource('pesajetCreate')}
    ${fnSource('pesajetCollect')}
    ${fnSource('pesajetDisburse')}
    ${constSource('PESAJET_FIND_LIMIT')}
    ${constSource('PESAJET_FIND_PAGES')}
    ${fnSource('pesajetFindByReference')}
    ${fnSource('pesajetGetTx')}
    ${fnSource('pesajetStatusLabel')}
    ${fnSource('pesajetFailureMsg')}
    ${fnSource('pesajetUserMsg')}
    ${fnSource('pesajetVerifyWebhook')}
    return { pesajetConfigured, pesajetPhone, pesajetProviderFor, pesajetCreate,
             pesajetFindByReference,
             pesajetCollect, pesajetDisburse, pesajetGetTx, pesajetStatusLabel,
             pesajetFailureMsg, pesajetUserMsg, pesajetVerifyWebhook, PESAJET_BASE };
  `)(fakeFetch, crypto, Buffer,
     { env: { PESAJET_API_KEY: apiKey, PESAJET_WEBHOOK_SECRET: secret, PESAJET_BASE_URL: base } },
     { error(){}, warn(){}, log(){} },
     'BUSY', 'FAILED',
     { timeout: () => undefined }, URLSearchParams);
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
    // PesaJet's DASHBOARD says the digest is over the "raw request payload";
    // their own SDK computes it over JSON.stringify(payload minus signature).
    // Those are different bytes, only one is what their servers send, and
    // both are accepted -- so BOTH have to be proven to verify, and a wrong
    // signature still has to be refused.
    const rawSent = '{"event":"payment.completed","transactionId":"txn_1","amount":30000,"reference":"CHZ-1","status":"COMPLETED","timestamp":"now"}';
    const rawSig = crypto.createHmac('sha256', 'top-secret').update(rawSent).digest('hex');
    ck(p5.mod.pesajetVerifyWebhook(JSON.parse(rawSent), rawSig, Buffer.from(rawSent)).verified === true,
       'a digest over the RAW request payload verifies (what the dashboard states)');
    // That case alone does NOT prove the raw path is used: rawSent happens to
    // re-serialise to itself, so the fallback satisfies it too and deleting
    // the raw candidate went undetected. This body has SPACES, so
    // JSON.stringify(parse(it)) is a different byte string and only the raw
    // digest can match -- which is the real-world case, since PesaJet's
    // formatting is theirs to choose.
    const spaced = '{"event": "payment.completed", "reference": "CHZ-1", "amount": 30000}';
    const spacedSig = crypto.createHmac('sha256', 'top-secret').update(spaced).digest('hex');
    ck(JSON.stringify(JSON.parse(spaced)) !== spaced,
       '  (the fixture really does re-serialise to different bytes)');
    ck(p5.mod.pesajetVerifyWebhook(JSON.parse(spaced), spacedSig, Buffer.from(spaced)).verified === true,
       '  and a body whose formatting is NOT ours still verifies from the raw bytes');
    ck(p5.mod.pesajetVerifyWebhook(payload, good).verified === true,
       "and so does one over the re-serialised payload (what their SDK computes)");
    ck(p5.mod.pesajetVerifyWebhook(payload, good, Buffer.from('{"different":"bytes"}')).verified === true,
       '  -- the re-serialised form still verifies even when a raw body is present');
    ck(p5.mod.pesajetVerifyWebhook({ ...payload, signature: good }, null).verified === true,
       'a signature carried inside the body works, with `signature` excluded from the digest');
    const forged = p5.mod.pesajetVerifyWebhook(payload, good.replace(/.$/, c => c === 'a' ? 'b' : 'a'));
    ck(forged.verified === false && forged.reason === 'mismatch',
       'a forged signature is a MISMATCH, which the route refuses outright');
    // A real tamper changes the body AND the bytes it was parsed from -- they
    // always agree with each other, because one comes from the other. An
    // earlier version of this case mutated only the raw buffer and left the
    // parsed body intact, which verified (correctly) via the re-serialised
    // candidate and looked like a hole that was not there.
    const tampered = rawSent.replace('30000', '99999');
    ck(p5.mod.pesajetVerifyWebhook(JSON.parse(tampered), rawSig, Buffer.from(tampered)).verified === false,
       'a tampered body is refused -- neither candidate digest matches its signature');
    ck(p5.mod.pesajetVerifyWebhook({ ...payload, amount: 999999 }, good).verified === false,
       'tampering with the amount breaks it');
    const none = p5.mod.pesajetVerifyWebhook(payload, null);
    ck(none.verified === false && none.reason === 'no-signature',
       'a missing signature is distinguishable from a wrong one');
    const noSecret = buildModule({ secret: '' }).mod.pesajetVerifyWebhook(payload, good);
    ck(noSecret.verified === false && noSecret.reason === 'no-secret',
       'and with no secret configured it says so rather than pretending to verify');
    ck(noSecret.reason !== 'mismatch',
       "  -- and NOT as a mismatch, or an unconfigured secret would 401 every real webhook");

    await finish();
  })().catch(e => { console.error(e); process.exit(1); });
}

// async because the PesaJet-summary section below RUNS the real route handler.
async function finish() {
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
  ck(guard.includes("'/pesajet/webhook'"), 'the webhook is GUARD_EXEMPT');

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
  // ONE endpoint, because PesaJet's dashboard has ONE "Webhook Destination
  // URL" field. Two routes could not both be registered there, and the half
  // that went unregistered would fail INVISIBLY -- the reconciler would
  // quietly cover for it, so nothing would ever look wrong.
  ck(!src.includes('/deposit/pesajet/callback') && !src.includes('/withdraw/pesajet/callback'),
     'there are no per-direction PesaJet callbacks (the dashboard takes one URL)');
  const hook = routeSlice("app.post('/pesajet/webhook'", "app.post('/withdraw/lipapay/callback'");
  ck(hook.includes('pesajetVerifyWebhook'), 'the one webhook verifies the signature');
  ck(/mismatch[\s\S]*?401/.test(hook), '  and answers 401 to a forged one');
  ck(hook.includes('req.rawBody'),
     '  over the RAW request payload, which is what PesaJet says it signs');
  ck(hook.includes('pesajetGetTx'), '  and re-reads before deciding anything');
  ck(/event === 'ping'/.test(hook), '  and answers a ping without touching money');
  ck(hook.includes('providerDown'),
     '  and leaves the row alone when the gateway cannot be reached');
  ck(hook.includes("collection('pendingDeposits')") && hook.includes("collection('withdrawals')"),
     '  and dispatches to BOTH a deposit and a payout from the one endpoint');
  // 200 within 30 seconds is PesaJet's own requirement, and the re-read can
  // outlast it (two attempts, 30s timeout each). So the ack goes first.
  const iAck = hook.indexOf('res.status(200).json({ received: true })');
  const iWork = hook.indexOf('pesajetGetTx');
  ck(iAck > 0 && iWork > iAck,
     "  the 200 is sent BEFORE the re-read -- PesaJet requires it within 30 seconds");
  // The raw body has to actually be captured, or the dashboard's own digest
  // can never match.
  ck(/RAW_BODY_ROUTES = new Set\(\['\/pesajet\/webhook'\]\)/.test(src),
     'the webhook path is in RAW_BODY_ROUTES');
  ck(/verify: keepRawBody/.test(src) && /req\.rawBody = buf/.test(src),
     'and the parser keeps the raw buffer for it');
  // The credit decision must come from the re-read, NOT from the body's
  // claimed status. If the body's status were trusted, anyone who can reach
  // the URL with a valid-looking payload could credit themselves.
  {
    const body = hook;
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
    const body = hook;
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

  // ── how fast a payment resolves ─────────────────────────────────────────
  // Owner: "callback speed is low, so try to make the system solid and faster
  // validation on payments, and sometimes a prompt may come when the screen is
  // just redirecting to payment page, so it is slow to redirect."
  //
  // These are the three places the waiting actually was. Pinned as NUMBERS
  // read out of the sources, because every one of them is a value somebody
  // could quietly restore to a "safer"-looking default.
  console.log('\n— how fast a payment resolves —');
  const app = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  const num = (text, re, what) => {
    const m = re.exec(text);
    if (!m) throw new Error('not found: ' + what);
    return Number(m[1]);
  };
  // 1. A status read is polled every couple of seconds. The SDK's blanket 30s
  //    default is the wrong shape for that: one slow read stalls the poll
  //    behind it, and with a retry the worst case was a full minute of a
  //    screen saying nothing.
  const readMs = num(src, /const PESAJET_READ_TIMEOUT = (\d+);/, 'PESAJET_READ_TIMEOUT');
  const createMs = num(src, /const PESAJET_TIMEOUT = (\d+);/, 'PESAJET_TIMEOUT');
  ck(readMs <= 10000, `a status read gives up after ${readMs}ms, not the SDK's 30000`);
  ck(readMs < createMs, `and sooner than a create (${readMs}ms vs ${createMs}ms)`);
  ck(/timeoutMs: PESAJET_READ_TIMEOUT/.test(strip(fnSource('pesajetGetTx'))),
     'and pesajetGetTx actually uses it');
  // 2. On the path a member is watching, the retry only doubles the silence --
  //    their next poll is the retry.
  {
    const body = S.slice(S.indexOf("if (dep.provider === 'pesajet')"));
    ck(/pesajetGetTx\(dep\.pesajetTxId, \{ attempts: 1 \}\)/.test(body.slice(0, 900)),
       "the member's own status poll makes ONE attempt");
    ck(/\{ attempts = 2 \}/.test(fnSource('pesajetGetTx')),
       'while the webhook and reconciler keep the second attempt, where nobody is watching');
  }
  // 3. The redirect. The member stares at "Redirecting to payment..." until
  //    the response lands, so nothing that the next screen does not need may
  //    sit in front of it.
  {
    const dep = S.slice(S.indexOf("app.post('/deposit/marzpay'"), S.indexOf('_creditingDeposits'));
    const iResp = dep.indexOf("res.json({ status: 'success', depositId: depRef.id");
    const iLedger = dep.indexOf("db.collection('transactions').add({");
    const iDepSet = dep.indexOf('await depRef.set({');
    ck(iDepSet > 0 && iResp > iDepSet, 'the deposit row is written before the member is answered');
    ck(iLedger > iResp,
       'but the Records ledger row is NOT -- it no longer sits in front of the redirect');
  }
  // 4. The client poll: the first check used to be a flat 3s after the screen
  //    opened, which is the whole of "it is slow" for a member who approved
  //    the prompt at once.
  {
    const first = num(app, /var DEP_POLL_FIRST_MS = (\d+);/, 'DEP_POLL_FIRST_MS');
    const every = num(app, /var DEP_POLL_EVERY_MS = (\d+);/, 'DEP_POLL_EVERY_MS');
    ck(first <= 1500, `the first status check is ${first}ms after the screen opens`);
    ck(every <= 2500, `and later ones every ${every}ms, PesaJet's own SDK cadence`);
    const loop = app.slice(app.indexOf('async function pollDepositStatus'));
    const ticks = num(loop, /for \(let i = 0; i < (\d+); i\+\+\)/, 'poll tick count');
    const budget = first + (ticks - 1) * every;
    ck(budget >= 55000,
       `and the giving-up budget is still about a minute (${Math.round(budget / 1000)}s) -- ` +
       'faster polling must not mean giving up on a payment sooner');
  }
  // 5. Retrying a create must not raise a second prompt. Their REST example
  //    puts the key in the BODY and their SDK puts it in a HEADER; which one
  //    is honoured is documented nowhere, and guessing wrong costs a
  //    duplicate payment.
  ck(/payload\.idempotencyKey = idempotencyKey/.test(fnSource('pesajetCreate')),
     'the idempotency key is sent in the body (their REST example)');
  ck(/headers\['Idempotency-Key'\] = idempotencyKey/.test(fnSource('_pesajetRequest')),
     'and as a header (their SDK) -- both, because a wrong guess is a double payment');

  // ── the live docs, and the three things they corrected ──────────────────
  console.log('\n— read against pay.pesajet.com/docs —');
  await (async () => {
    // 1. THE ERROR BODY IS NESTED. Their docs show
    //    { error: { code, message, details, timestamp, requestId } }; the SDK's
    //    own type is flat. Reading the documented shape the flat way hands the
    //    error OBJECT to a member, who sees "[object Object]" on a failed
    //    recharge.
    const p = buildModule();
    p.reply(() => ({ status: 400, body: { error: {
      code: 'VALIDATION_ERROR', message: 'Invalid phone number format',
      details: { phoneNumber: 'Use +256 format' }, requestId: 'req_123456' } } }));
    const r = await p.mod.pesajetCollect({ amount: 1000, phone: '0771234567',
      network: 'MTN', reference: 'CHZ-E1' });
    ck(r.data.message === 'Invalid phone number format',
       'a nested error body is flattened to a plain message');
    ck(r.data.errorCode === 'VALIDATION_ERROR', 'and its code is carried across');
    ck(r.data.requestId === 'req_123456',
       "and the requestId, which their own error table says to log");
    const shown = p.mod.pesajetUserMsg(r, 'fallback');
    ck(typeof shown === 'string' && !/\[object/.test(shown),
       `what reaches a member is a sentence, never an object (${shown})`);
    ck(shown === 'Invalid phone number format', 'and it is their own message');
    // The flat shape has to keep working -- it is what the SDK types promise.
    const p2 = buildModule();
    p2.reply(() => ({ status: 400, body: { message: 'Insufficient balance' } }));
    const r2 = await p2.mod.pesajetCollect({ amount: 1, phone: '0771234567', network: 'MTN', reference: 'x' });
    ck(p2.mod.pesajetUserMsg(r2, 'fallback') === 'Insufficient balance',
       'and the flat shape the SDK documents still works');

    // 2. A 409 IS NOT A REFUSAL. Their error table: "Reuse the original
    //    response for an idempotency conflict." The transaction already
    //    exists, so failing the deposit here would tell a member their
    //    recharge failed while the prompt was ringing on their phone.
    const p3 = buildModule();
    p3.reply((n, url) => n === 1
      ? { status: 409, body: { error: { code: 'CONFLICT', message: 'Duplicate request' } } }
      : { status: 200, body: { data: [
          { transactionId: 'txn_other', reference: 'SOMEONE-ELSE', status: 'COMPLETED' },
          { transactionId: 'txn_mine', reference: 'CHZ-409', status: 'PENDING' }] } });
    const r3 = await p3.mod.pesajetCollect({ amount: 30000, phone: '0771234567',
      network: 'MTN', reference: 'CHZ-409', idempotencyKey: 'dep-409' });
    ck(r3.ok === true && r3.recovered === true,
       'a 409 recovers the existing transaction instead of failing the payment');
    ck(r3.data.transactionId === 'txn_mine',
       '  and it is OUR reference that is matched, not whatever came first');
    ck(p3.calls[1].url.includes('/payments?'),
       '  looked up through the documented list endpoint');

    // A 409 we cannot resolve must read as IN FLIGHT, never as refused --
    // that is the difference between "leave it pending" and "tell them it
    // failed" / "hand a payout back for a retry that pays twice".
    const p4 = buildModule();
    p4.reply((n) => n === 1
      ? { status: 409, body: { error: { code: 'CONFLICT', message: 'Duplicate' } } }
      : { status: 200, body: { data: [] } });
    const r4 = await p4.mod.pesajetCollect({ amount: 1, phone: '0771234567', network: 'MTN', reference: 'CHZ-410' });
    ck(r4.ok === false && r4.providerDown === true,
       'an unrecoverable 409 is treated as in flight, not as a refusal');

    // 3. THE LIST ENDPOINT, which is what makes a lost transaction id
    //    recoverable at all.
    const p5 = buildModule();
    p5.reply(() => ({ status: 200, body: { data: [{ transactionId: 't1', reference: 'R1', status: 'COMPLETED' }] } }));
    const f1 = await p5.mod.pesajetFindByReference('R1', { sinceMs: Date.UTC(2026, 0, 1) });
    ck(f1.found && f1.transactionId === 't1' && f1.status === 'completed',
       'a transaction is found by our own reference');
    const q = p5.calls[0].url;
    ck(/[?&]page=1/.test(q) && /[?&]limit=/.test(q) && /[?&]startDate=/.test(q),
       'using only page, limit and startDate -- parameters their reference lists');
    ck(!/reference=/.test(q),
       'and NOT a reference= filter, which their endpoint does not document');

    const p6 = buildModule();
    p6.reply(() => ({ status: 200, body: { data: [] } }));
    const f2 = await p6.mod.pesajetFindByReference('NOPE', { sinceMs: Date.now() });
    ck(f2.found === false && f2.complete === true,
       'a short page means the window really was scanned to its end');

    // The list envelope is NOT documented, only its parameters are. An
    // unrecognised shape must never read as "no rows" -- that reading is what
    // licenses failing a deposit, so it has to be distinguishable.
    const p7 = buildModule();
    p7.reply(() => ({ status: 200, body: { ok: true, weird: 'shape' } }));
    const f3 = await p7.mod.pesajetFindByReference('R1', { sinceMs: Date.now() });
    ck(f3.unreadable === true && f3.complete === false,
       'an unrecognised list envelope is unreadable, never evidence of absence');

    const p8 = buildModule();
    p8.reply(() => ({ status: 503, body: {} }));
    const f4 = await p8.mod.pesajetFindByReference('R1', { sinceMs: Date.now() });
    ck(f4.providerDown === true && f4.complete === false,
       'and a gateway blip is not evidence of absence either');
  })();

  // The reconciler must only conclude "this never happened" from a scan that
  // reached the end of its window. Checked inside the sweep, because the
  // other two gateways carry similar-looking lines.
  {
    const at = src.indexOf('const pjLostSnap =');
    ck(at !== -1, 'the reconciler sweeps PesaJet deposits that never got an id');
    const sweep = src.slice(at, src.indexOf('\n    // Deposits stuck', at));
    ck(/if \(hit\.providerDown \|\| hit\.unreadable\) continue;/.test(sweep),
       '  a blip or an unreadable reply leaves the row pending');
    ck(/if \(hit\.complete\) await markDepositFailed/.test(sweep),
       '  and a deposit is only failed on a window scanned to its end');
    ck(/orderBy\('createdAt', 'desc'\)/.test(sweep),
       '  newest first, so recoverable rows are not starved by old ones');
  }

  // ── what has gone through PesaJet (NOT a balance) ───────────────────────
  // PesaJet publish no balance endpoint in either official SDK, so the card
  // reports Chipz's own records. Two things therefore have to hold, and the
  // second matters more than the arithmetic: the figures must come from our
  // own collections, and nothing may present them as the float in PesaJet's
  // account.
  console.log('\n— what has gone through PesaJet —');
  {
    const at = src.indexOf("app.get('/admin/pesajet/summary'");
    ck(at !== -1, 'GET /admin/pesajet/summary exists');
    const end = src.indexOf('\n});', at);
    const route = src.slice(at, end + 4);

    // It must not invent a PesaJet path. Their SDK has create / read /
    // preview and nothing else; a guessed /balance or /wallet against a money
    // provider is API surface made up out of nothing.
    ck(!/_pesajetRequest|pesajetGetTx|pesajetCreate/.test(route),
       'it calls PesaJet not at all -- there is no balance endpoint to call');
    ck(!/\/balance|\/wallet|\/float/.test(route),
       'and invents no PesaJet path of its own');
    ck(/pendingDeposits'\)\s*\.where\('provider', '==', 'pesajet'\)/.test(route),
       "it reads our own PesaJet deposits");
    ck(/withdrawals'\)\s*\.where\('pesajetRef', '>', ''\)/.test(route),
       'and our own PesaJet payouts');
    ck(/not the float in their account/.test(route),
       'and the reply says in words that this is not their float');


    // Run it. A text match cannot tell "collected" apart from "created", and
    // getting that wrong overstates money received.
    const rows = {
      pendingDeposits: [
        // credited, Uganda
        { id: 'd1', provider: 'pesajet', userId: 'u1', status: 'success', creditedAt: 1, amount: 30000 },
        // credited, Kenya -- and displayAmount is what the member was charged
        { id: 'd2', provider: 'pesajet', userId: 'u2', status: 'success', creditedAt: 1, amount: 900, displayAmount: 900 },
        // still in flight, Uganda
        { id: 'd3', provider: 'pesajet', userId: 'u1', status: 'pending', amount: 50000 },
        // failed -- neither collected nor pending
        { id: 'd4', provider: 'pesajet', userId: 'u1', status: 'failed', amount: 70000 },
        // claimed but the wallet write never finished: NOT collected
        { id: 'd5', provider: 'pesajet', userId: 'u1', status: 'matched', amount: 11000 },
      ],
      withdrawals: [
        { id: 'w1', pesajetRef: 'r1', userId: 'u1', status: 'processed', amount: 20000, net: 17000 },
        { id: 'w2', pesajetRef: 'r2', userId: 'u1', status: 'processing', amount: 10000, net: 8500 },
        { id: 'w3', pesajetRef: 'r3', userId: 'u2', status: 'rejected', amount: 5000, net: 4250 },
      ],
    };
    const snap = list => ({ size: list.length, docs: list.map(r => ({ id: r.id, data: () => ({ ...r }) })) });
    const q = name => ({ where: () => q(name), limit: () => q(name), get: async () => snap(rows[name]) });
    let settings = { depositMethod: 'pesajet', withdrawMethod: 'marzpay' };
    let scanCap = 200000;
    const scope = {
      db: { collection: name => q(name) },
      verifyAdmin: () => true,
      getSettings: async () => settings,
      adminUserRegions: async () => ({ u1: 'ug', u2: 'ke' }),
      rowRegionKey: (row, map) => row.regionKey || map[row.userId] || 'ug',
      regionByKey: k => ({ ug: { currency: 'UGX' }, ke: { currency: 'KES' } })[k],
      // The real one: status alone is not enough, because claim-before-credit
      // can leave 'matched' with the wallet write unfinished.
      depositFullyCredited: r => r.status === 'success' && !!r.creditedAt,
      depositProvider: s => s.depositMethod,
      withdrawProvider: s => s.withdrawMethod,
      pesajetConfigured: () => true,
      finiteMoney: n => (Number.isFinite(Number(n)) ? Number(n) : 0),
      round2: n => Math.round(n * 100) / 100,
      console,
    };
    const run = async wanted => {
      let handler = null;
      const app = { get: (_p, fn) => { handler = fn; } };
      const names = Object.keys(scope);
      new Function('app', 'adminRegionFilter', 'PESAJET_SUMMARY_SCAN', ...names, route)(
        app, () => wanted, scanCap, ...names.map(n => scope[n]));
      let out = null;
      await handler({ query: {} }, { json: o => (out = o), status: () => ({ json: o => (out = o) }) });
      return out;
    };
    const all = await run(null);
    const ug = all.regions.find(r => r.regionKey === 'ug');
    const ke = all.regions.find(r => r.regionKey === 'ke');
    ck(ug && ug.collected === 30000 && ug.collectedCount === 1,
       'only a deposit that really landed counts as collected');
    ck(ug && ug.pendingIn === 50000 && ug.pendingInCount === 1,
       'one still in flight, counted separately');
    ck(ug && ug.paidOut === 17000 && ug.paidOutCount === 1,
       'a payout counts what the member received (net), once processed');
    ck(ug && ug.pendingOut === 8500 && ug.pendingOutCount === 1,
       "and a payout still sending is 'still sending', not paid");
    ck(ug && ug.net === 13000, 'net is collected minus paid out');
    ck(ke && ke.collected === 900 && ke.currency === 'KES',
       "another country is its own bucket, in its own currency");
    ck(all.regions.length === 2, 'and nothing is summed across currencies');
    ck(all.selected === true,
       'selected says the gateway really is in the payment path');
    ck(/not the float/.test(all.note || ''),
       'the reply itself carries the caveat, so a raw reader is not misled either');

    const kenyaOnly = await run('ke');
    ck(kenyaOnly.regions.length === 1 && kenyaOnly.regions[0].regionKey === 'ke',
       'the country switch narrows it to one country');

    // 'selected' decides whether the card is ever shown, so it has to follow
    // the real settings rather than being pinned on.
    settings = { depositMethod: 'marzpay', withdrawMethod: 'marzpay' };
    ck((await run(null)).selected === false,
       'and says NOT selected when neither path uses PesaJet');
    settings = { depositMethod: 'marzpay', withdrawMethod: 'pesajet' };
    ck((await run(null)).selected === true, 'payouts alone count as selected');
    settings = { depositMethod: 'pesajet', withdrawMethod: 'marzpay' };

    // Reaching the cut-short case at all is why the scan ceiling is a named
    // constant: with it shrunk to 2 the flag must be true, and must STAY true
    // when the view is narrowed to a country holding fewer rows than the cap.
    // Judging it on the filtered rows instead would call a partial total
    // complete, which is the lie the flag exists to prevent.
    scanCap = 2;
    ck((await run(null)).truncated === true,
       'a read that hits the scan ceiling is reported as incomplete');
    ck((await run('ke')).truncated === true,
       '  and still incomplete when narrowed to one small country');
    scanCap = 200000;
    ck((await run(null)).truncated === false,
       'while a read well inside the ceiling is reported complete');

    // ── the card's own words ──────────────────────────────────────────────
    const cardAt = adminSrc.indexOf('id="pesajetCard"');
    ck(cardAt !== -1, "the panel has the card");
    const cardEnd = adminSrc.indexOf('</div>', adminSrc.indexOf('id="pesajetSummary"'));
    const card = adminSrc.slice(cardAt - 200, cardEnd);
    ck(!/balance/i.test(card.replace(/does not publish a balance endpoint/i, '')),
       'and never calls this figure a balance');
    ck(/not the float in their account/.test(card),
       'it says outright that it is not the float in PesaJet\'s account');
    // Matched on the div itself, not on the surrounding text: the comment
    // above it explains that the card is hidden, and a loose match would be
    // satisfied by that explanation with the class deleted. Sixth instance of
    // that trap in this project.
    ck(/<div class="panel-card hidden" id="pesajetCard">/.test(adminSrc),
       'and it ships hidden, so an operator who does not use PesaJet never meets it');

    // ── every word on it can be translated ────────────────────────────────
    // The coverage sweep renders eight of these; the empty-summary and
    // failed-read branches cannot be on screen at the same time as the rest,
    // so the rows for them are checked from the other direction here: each
    // must still occur VERBATIM in the panel. A row whose key has drifted
    // from the string it is supposed to match is silently no translation at
    // all, and nothing at runtime says so.
    const rowsPy = fs.readFileSync(__dirname + '/admin-rows-7.py', 'utf8');
    const keys = [...rowsPy.matchAll(/^    \['((?:[^'\\]|\\.)*)',$/gm)]
      .map(m => m[1].replace(/\\'/g, "'"));
    ck(keys.length >= 10, `admin-rows-7.py carries the card's strings (${keys.length})`);
    //
    // THE TABLE ITSELF HAS TO BE CUT OUT FIRST, and leaving it in made this
    // whole check vacuous on its first run: build-admin-rows.py writes every
    // English key into ADMIN_LANG_ROWS in this same file, so "the key appears
    // in admin-src" was satisfied by the row rather than by the card, and a
    // key that matched nothing on screen still passed.
    const cut = s => {
      for (const name of ['ADMIN_LANG_ROWS', 'ADMIN_LANG_PATTERNS']) {
        const a = s.indexOf('const ' + name + ' = [');
        const b = s.indexOf('\n];', a);
        if (a === -1 || b === -1) throw new Error('could not find ' + name);
        s = s.slice(0, a) + s.slice(b + 3);
      }
      return s;
    };
    const panelText = cut(adminSrc).replace(/&mdash;/g, '—').replace(/&middot;/g, '·');
    ck(!panelText.includes("['Dashboard'"), 'the string table is cut out before looking');
    // A template's figures are spliced in at render time, so it is matched by
    // its literal halves -- everything either side of a {0}/{1}.
    for (const k of keys) {
      const shown = k.length > 46 ? k.slice(0, 46) + '…' : k;
      const parts = k.split(/\{\d\}/).map(p => p.trim()).filter(p => p.length > 2);
      ck(parts.length > 0 && parts.every(p => panelText.includes(p)),
         `"${shown}" is really on the card`);
    }
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
