#!/usr/bin/env node
/**
 * Manual deposits are human-verified, and the member's message reaches the
 * admin intact.
 *
 * Owner: "the manual payments, ie deposits, this time no use of forwarder sms
 * app, only the sent message from after refresh on manual payment page should
 * appear to admin panel in its full details so as admin verifies manually or
 * rejects."
 *
 * The important assertion here is that an UNPARSEABLE message is still
 * delivered in full. That route used to answer 400 and store nothing, so a
 * real payment whose SMS wording the parser does not recognise disappeared
 * with no way for the member to be paid. It is checked by RUNNING the real
 * handler against a stub database and reading what it wrote -- grepping for
 * the absence of a `return res.status(400)` would prove nothing about what
 * actually lands in the document.
 *
 * Also pinned: the route still never credits, the forwarder cannot credit
 * while manualSmsAutoCredit is off, and the referral link is the bare
 * /refCode= form with a host rewrite to match.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const mod = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');
const render = fs.readFileSync(path.join(HERE, 'render.yaml'), 'utf8');
const admin = fs.readFileSync(path.join(HERE, 'admin-src', 'index.html'), 'utf8');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const grab = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i === -1 || j === -1 || j <= i) throw new Error(`bad slice anchors: ${a} .. ${b}`);
  return src.slice(i, j);
};
// Pull one named function out by matching its braces, rather than slicing
// between two comment anchors. An anchor that has drifted returns -1 and the
// slice then silently swallows the rest of the file -- which is exactly how
// the first version of this test ended up redeclaring verifyAuth.
function fnSource(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
// Comments stripped before any "does the code do X" check. The paste-sms
// route's own comment explains that it never calls creditDeposit(), and a
// plain scan cannot tell that sentence from a call -- the same self-matching
// trap test-security-hardening.js documents.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ── the real paste-sms handler, on a stub database ──
console.log('— the member\'s message reaches review, whatever it says —');

const handlerBody = grab("app.post('/deposit/manual/paste-sms'", '// 1-minute sweep for manual orders');
check(handlerBody.length > 500, 'found the paste-sms route to run');

// Never credits. This is the invariant the whole flow rests on: the member
// supplies this text, so it can never be allowed to move a balance by itself.
check(!/creditDeposit\s*\(/.test(stripComments(handlerBody)),
  'the route never calls creditDeposit -- a member-supplied message cannot pay anyone');

const ORDER = { userId: 'u1', method: 'manual', status: 'pending', amount: 20000,
                assignedNumber: '0770000001' };
let written = null, replied = null, code = 200;

function run(text, order = ORDER) {
  written = null; replied = null; code = 200;
  const sandbox = {
    verifyAuth: async () => 'u1',
    cleanPhone: null, fmtUGX: null, parseMoMoSms: null, parseSentMoMoSms: null,
    FieldValue: { serverTimestamp: () => '<ts>' },
    console,
    db: { collection: () => ({ doc: () => ({
      get: async () => ({
        exists: !!order,
        data: () => order,
        ref: { update: async p => { written = p; } },
      }),
    }) }) },
  };
  const fn = new Function('sandbox', `
    const { verifyAuth, FieldValue, db, console } = sandbox;
    ${grab('function _smsAmount', 'function parseMoMoSms')}
    ${fnSource('fmtUGX')}
    ${fnSource('cleanPhone')}
    ${fnSource('parseMoMoSms')}
    ${fnSource('parseSentMoMoSms')}
    let handler;
    const app = { post: (_p, h) => { handler = h; } };
    ${handlerBody}
    return handler;
  `)(sandbox);

  const res = {
    status(c) { code = c; return res; },
    json(j) { replied = j; return res; },
  };
  return fn({ body: { depositId: 'dep1', text }, headers: {} }, res)
    .then(() => ({ written, replied, code }));
}

(async () => {
  // 1. A message the parser understands.
  const real = 'You have sent UGX 20,000 to JOHN DOE, 256770000001 on 2026-09-09 10:12:03, '
             + 'fee: 0. Reason: Deposit. New balance: 4,500. ID :302556677001.';
  const a = await run(real);
  check(a.code === 200 && a.written && a.written.status === 'review',
    'a readable payment message queues the order for review');
  check(!!a.written && a.written.pastedSms === real,
    'and stores the message itself, not a summary of it');
  check(!!a.written && a.written.pastedSmsParsed === true, 'flagged as machine-readable');
  check(!!a.written && a.written.pastedSmsAmountMatches === true,
    'with the amount cross-checked against the order');

  // 2. THE ROUND'S POINT: something the parser cannot read at all.
  const junk = 'i have sent the 20000 already from my MTN please check and confirm asap';
  const b = await run(junk);
  check(b.code === 200, `an unreadable message is accepted, not refused (got ${b.code})`);
  check(!!b.written && b.written.status === 'review',
    'it still reaches the admin as Needs Review');
  check(!!b.written && b.written.pastedSms === junk,
    'stored verbatim, exactly as the member typed it');
  check(!!b.written && b.written.pastedSmsParsed === false,
    'and marked as NOT machine-read, so the admin knows to read it themselves');
  check(!!b.written && /could not read/i.test(b.written.reviewReason || ''),
    'the review note says so in words');

  // 3. Empty is still refused -- accepting everything is not the same as
  //    accepting nothing.
  const c = await run('   ');
  check(c.code === 400, `an empty submission is still refused (got ${c.code})`);
  check(c.written === null, 'and writes nothing');

  // 4. A long message is not truncated below what an operator SMS needs.
  const long = 'x'.repeat(1500) + ' ID :302999';
  const d = await run(long);
  check(!!d.written && d.written.pastedSms.length >= 1500,
    `a long message survives (kept ${d.written ? d.written.pastedSms.length : 0} chars)`);

  // ── the forwarder cannot credit on its own ──
  console.log('\n— no use of the forwarder app —');
  check(/manualSmsAutoCredit:\s*false/.test(src),
    'automatic crediting from forwarded SMS defaults to OFF');
  // Comments stripped: the gate's own comment names the setting, so an
  // unstripped scan finds the SENTENCE and reports the gate present even
  // after the code has been removed. Verified by deleting the gate -- this
  // check went green until the strip was added.
  const fwd = stripComments(grab("app.post('/deposit/manual/sms-forwarder'", "app.post('/deposit/manual/paste-sms'"));
  const gateAt = fwd.indexOf('manualSmsAutoCredit');
  const creditAt = fwd.indexOf('await creditDeposit(match)');
  check(gateAt !== -1, 'the forwarder route checks that setting');
  check(gateAt !== -1 && creditAt !== -1 && gateAt < creditAt,
    'and checks it BEFORE crediting, not after');
  check(/status:\s*'review'/.test(fwd.slice(gateAt, creditAt)),
    'a held match is queued for review rather than dropped');
  check(/pastedSms:/.test(fwd.slice(gateAt, creditAt)),
    'with the forwarded message attached, so the admin sees the same evidence');

  // ── the admin panel actually shows it ──
  console.log('\n— the admin panel shows the message in full —');
  check(/pastedSms/.test(admin), 'the deposits table renders the pasted message');
  check(/white-space:pre-wrap/.test(admin),
    'as pre-wrapped text, so line breaks in an SMS survive');
  check(!/pastedSms[^\n]*slice\(/.test(admin),
    'and is not truncated -- the transaction id sits at the END of an operator SMS');
  check(/esc\(d\.pastedSms\)/.test(admin),
    'escaped: it is member-supplied text going into innerHTML');
  check(/data-mreject/.test(admin) && /data-force/.test(admin),
    'with both Approve and Reject available on a review row');

  // ── the referral link ──
  console.log('\n— the invite link is /refCode= and nothing else —');
  const linkLine = (mod.match(/const link = code \?[^\n]*/) || [''])[0];
  check(/\/refCode=\$\{encodeURIComponent\(code\)\}/.test(linkLine),
    `the link is <origin>/refCode=<code>  --  ${linkLine.trim()}`);
  check(!/#pages\/register/.test(linkLine) && !/\?ref=/.test(linkLine),
    'with none of the older wording left in it');
  check(/\/refCode=\(\[\^\/\?#\]\+\)/.test(mod),
    'and the app reads that code back off the path');
  // Links already sent to real people must keep working.
  check(/search\.get\('ref'\)/.test(mod), 'the old ?ref= form still works');
  check(/location\.hash/.test(mod), 'and the old #...?ref= form still works');

  check(/type:\s*rewrite/.test(render) && /source:\s*\/refCode=\*/.test(render),
    'the host rewrites /refCode=* to index.html, or every invite would 404');
  check(!/source:\s*\/\*\s*$/m.test(render),
    'and it is scoped to that path, not a blanket /* rewrite');

  console.log(failed ? `\n${failed} FAILED` : '\nmanual review + refCode: all cases pass');
  process.exit(failed ? 1 : 0);
})();
